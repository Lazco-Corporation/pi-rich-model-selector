import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface StoreData {
  version: number;
  starred: string[];
  /** Models kept out of the list. A star always wins over a hide. */
  hidden: string[];
  syncEnabledModels: boolean;
  /** Hide the built-in /model entry from the slash command menu. */
  hideBuiltinModelCommand: boolean;
}

const CURRENT_VERSION = 1;

function emptyData(): StoreData {
  return {
    version: CURRENT_VERSION,
    starred: [],
    hidden: [],
    syncEnabledModels: false,
    hideBuiltinModelCommand: false,
  };
}

export function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

/**
 * Star state and star order live in one ordered array. A second order field would
 * be a second source of truth, and the two could drift apart.
 */
export class StarStore {
  private data: StoreData = emptyData();
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StoreData>;
      this.data = {
        version: CURRENT_VERSION,
        starred: Array.isArray(parsed.starred) ? parsed.starred.filter((key) => typeof key === "string") : [],
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((key) => typeof key === "string") : [],
        syncEnabledModels: parsed.syncEnabledModels === true,
        hideBuiltinModelCommand: parsed.hideBuiltinModelCommand === true,
      };
    } catch {
      this.data = emptyData();
    }
  }

  /** Write through a temporary file so a crash cannot leave a half-written file. */
  private writeNow(): void {
    const directory = dirname(this.filePath);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      try {
        this.writeNow();
      } catch {
        // A failed star write must never break the picker.
      }
    }, 150);
  }

  flush(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    try {
      this.writeNow();
    } catch {
      // Same reason as scheduleSave.
    }
  }

  getStarred(): string[] {
    return [...this.data.starred];
  }

  isStarred(key: string): boolean {
    return this.data.starred.includes(key);
  }

  /** Returns the star position, or -1. Used to sort the list. */
  starRank(key: string): number {
    return this.data.starred.indexOf(key);
  }

  toggleStar(key: string): boolean {
    const index = this.data.starred.indexOf(key);
    if (index >= 0) {
      this.data.starred.splice(index, 1);
      this.scheduleSave();
      return false;
    }
    this.data.starred.push(key);
    // A starred model must stay visible, so a star clears the hide.
    this.unhide(key);
    this.scheduleSave();
    return true;
  }

  isHidden(key: string): boolean {
    return this.data.hidden.includes(key);
  }

  getHidden(): string[] {
    return [...this.data.hidden];
  }

  /** Returns the new hidden state. Hiding a starred model also drops the star. */
  toggleHidden(key: string): boolean {
    if (this.unhide(key)) {
      this.scheduleSave();
      return false;
    }
    const starIndex = this.data.starred.indexOf(key);
    if (starIndex >= 0) this.data.starred.splice(starIndex, 1);
    this.data.hidden.push(key);
    this.scheduleSave();
    return true;
  }

  private unhide(key: string): boolean {
    const index = this.data.hidden.indexOf(key);
    if (index < 0) return false;
    this.data.hidden.splice(index, 1);
    return true;
  }

  unhideAll(): number {
    const count = this.data.hidden.length;
    if (count === 0) return 0;
    this.data.hidden = [];
    this.scheduleSave();
    return count;
  }

  /** Move a starred model up or down. Returns true if the order changed. */
  move(key: string, direction: -1 | 1): boolean {
    const index = this.data.starred.indexOf(key);
    if (index < 0) return false;
    const target = index + direction;
    if (target < 0 || target >= this.data.starred.length) return false;
    const [entry] = this.data.starred.splice(index, 1);
    if (entry === undefined) return false;
    this.data.starred.splice(target, 0, entry);
    this.scheduleSave();
    return true;
  }

  /** Drop stars and hides whose model is gone from the catalog. */
  prune(availableKeys: Set<string>): void {
    const keptStars = this.data.starred.filter((key) => availableKeys.has(key));
    const keptHidden = this.data.hidden.filter((key) => availableKeys.has(key));
    if (keptStars.length === this.data.starred.length && keptHidden.length === this.data.hidden.length) return;
    this.data.starred = keptStars;
    this.data.hidden = keptHidden;
    this.scheduleSave();
  }

  getSyncEnabledModels(): boolean {
    return this.data.syncEnabledModels;
  }

  setSyncEnabledModels(value: boolean): void {
    this.data.syncEnabledModels = value;
    this.scheduleSave();
  }

  getHideBuiltinModelCommand(): boolean {
    return this.data.hideBuiltinModelCommand;
  }

  setHideBuiltinModelCommand(value: boolean): void {
    this.data.hideBuiltinModelCommand = value;
    this.scheduleSave();
  }
}

/**
 * Read settings.json, apply one mutation, and write the result back.
 *
 * The write goes through a process-specific temporary file, so two pi
 * processes cannot write the same temporary file at once. Synchronous calls in
 * one process cannot interleave, so the process id is enough to name the file.
 * The file gets the same private mode as the store file: settings.json holds
 * user-specific data, and a file created with default permissions would be
 * readable by other users on the machine.
 */
function updateSettings(agentDir: string, mutate: (settings: Record<string, unknown>) => void): void {
  const settingsPath = join(agentDir, "settings.json");
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Could not read settings.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  mutate(settings);
  const temporaryPath = `${settingsPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, settingsPath);
  } catch (error) {
    // A failed rename would otherwise leave a settings snapshot behind. The
    // pid in the name makes every process leave its own stray file, so the
    // cleanup must run here, not on the next write.
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The file may not exist, which is fine.
    }
    throw error;
  }
}

/**
 * Write `defaultProvider` and `defaultModel` into settings.json.
 *
 * Pi merges settings per field when it saves, so this value survives a later pi
 * write. A call with an undefined provider or id clears both fields, and pi
 * falls back to its built-in per-provider defaults on the next start.
 */
export function writeDefaultModel(agentDir: string, provider: string | undefined, modelId: string | undefined): void {
  if (!(provider && modelId) && !existsSync(join(agentDir, "settings.json"))) return;
  updateSettings(agentDir, (settings) => {
    if (provider && modelId) {
      settings.defaultProvider = provider;
      settings.defaultModel = modelId;
    } else {
      delete settings.defaultProvider;
      delete settings.defaultModel;
    }
  });
}

/**
 * Write `enabledModels` into settings.json. Pi merges settings per field when it
 * saves, so this value survives a later pi write.
 */
export function writeEnabledModels(agentDir: string, patterns: string[]): void {
  updateSettings(agentDir, (settings) => {
    if (patterns.length > 0) settings.enabledModels = patterns;
    else delete settings.enabledModels;
  });
}
