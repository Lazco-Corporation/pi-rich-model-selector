import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

export interface StoreData {
  version: number;
  starred: string[];
  /** Models kept out of the list. A star always wins over a hide. */
  hidden: string[];
  /** Hide the built-in /model entry from the slash command menu. */
  hideBuiltinModelCommand: boolean;
}

/** The fields a write may own. `version` is constant, so it never merges. */
type MergeableField = "starred" | "hidden" | "hideBuiltinModelCommand";

const CURRENT_VERSION = 1;

function emptyData(): StoreData {
  return {
    version: CURRENT_VERSION,
    starred: [],
    hidden: [],
    hideBuiltinModelCommand: false,
  };
}

function parseData(raw: string): StoreData {
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as Partial<StoreData>;
  return {
    version: CURRENT_VERSION,
    starred: Array.isArray(parsed.starred) ? parsed.starred.filter((key) => typeof key === "string") : [],
    hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((key) => typeof key === "string") : [],
    hideBuiltinModelCommand: parsed.hideBuiltinModelCommand === true,
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
  /**
   * Fields this process changed since the last write. A write applies only
   * these onto the file as it is on disk right now, so a change another pi
   * process or a hand edit made to a different field survives.
   */
  private readonly modifiedFields = new Set<MergeableField>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      this.data = parseData(readFileSync(this.filePath, "utf8"));
    } catch {
      this.data = emptyData();
    }
  }

  /**
   * Re-read the file, keeping changes this process has not written yet.
   *
   * A long-lived session holds its copy for hours. In that time the user may
   * edit the file by hand, or another pi session may star a model. Without this
   * the session keeps showing its old copy.
   */
  reload(): void {
    // A pending debounced change is not on disk yet, so it would be lost.
    this.flush();
    this.load();
  }

  /**
   * Write through a temporary file so a crash cannot leave a half-written file.
   *
   * The file on disk is the base, not the copy this process loaded at start.
   * Writing the whole in-memory copy back would drop every change made after
   * that load. The temporary file carries the process id, so two pi processes
   * cannot write the same temporary file at once.
   */
  private writeNow(): void {
    const directory = dirname(this.filePath);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });

    let merged = emptyData();
    if (existsSync(this.filePath)) {
      try {
        merged = parseData(readFileSync(this.filePath, "utf8"));
      } catch {
        // An unreadable file cannot be merged. This process owns the result.
        merged = emptyData();
      }
    }
    for (const field of this.modifiedFields) {
      if (field === "hideBuiltinModelCommand") merged.hideBuiltinModelCommand = this.data.hideBuiltinModelCommand;
      else merged[field] = [...this.data[field]];
    }

    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The file may not exist, which is fine.
      }
      throw error;
    }
    // Nothing can run between the read above and this line, because every call
    // here is synchronous. So the merged result is the whole truth now.
    this.data = merged;
    this.modifiedFields.clear();
  }

  private scheduleSave(field: MergeableField): void {
    this.modifiedFields.add(field);
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
      this.scheduleSave("starred");
      return false;
    }
    this.data.starred.push(key);
    // A starred model must stay visible, so a star clears the hide.
    if (this.unhide(key)) this.scheduleSave("hidden");
    this.scheduleSave("starred");
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
      this.scheduleSave("hidden");
      return false;
    }
    const starIndex = this.data.starred.indexOf(key);
    if (starIndex >= 0) {
      this.data.starred.splice(starIndex, 1);
      this.scheduleSave("starred");
    }
    this.data.hidden.push(key);
    this.scheduleSave("hidden");
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
    this.scheduleSave("hidden");
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
    this.scheduleSave("starred");
    return true;
  }

  /** Drop stars and hides whose model is gone from the catalog. */
  prune(availableKeys: Set<string>): void {
    const keptStars = this.data.starred.filter((key) => availableKeys.has(key));
    const keptHidden = this.data.hidden.filter((key) => availableKeys.has(key));
    if (keptStars.length === this.data.starred.length && keptHidden.length === this.data.hidden.length) return;
    if (keptStars.length !== this.data.starred.length) this.scheduleSave("starred");
    if (keptHidden.length !== this.data.hidden.length) this.scheduleSave("hidden");
    this.data.starred = keptStars;
    this.data.hidden = keptHidden;
  }

  getHideBuiltinModelCommand(): boolean {
    return this.data.hideBuiltinModelCommand;
  }

  setHideBuiltinModelCommand(value: boolean): void {
    this.data.hideBuiltinModelCommand = value;
    this.scheduleSave("hideBuiltinModelCommand");
  }
}

/**
 * Open settings.json, apply one change, and write it back.
 *
 * Pi owns settings.json, so pi writes it. `SettingsManager` takes a real file
 * lock, re-reads the file inside that lock, and writes back only the fields
 * this call changed. That gives three things a hand-rolled writer does not:
 *
 * 1. Two pi processes cannot lose each other's change (issue #4).
 * 2. A field the user edited by hand survives, because the merge base is the
 *    file on disk, not a copy this process read earlier.
 * 3. A field pi itself wrote survives, for the same reason.
 *
 * The manager is built per call and thrown away. It must never be cached: a
 * cached one holds an old copy of the file, which is the bug this avoids.
 */
async function updateSettings(cwd: string, agentDir: string, mutate: (settings: SettingsManager) => void): Promise<void> {
  const manager = SettingsManager.create(cwd, agentDir);
  mutate(manager);
  await manager.flush();
  // A queued write reports failure here instead of throwing, and a settings.json
  // that does not parse makes the manager skip the write. Both must be loud.
  const errors = manager.drainErrors();
  const failure = errors[0];
  if (failure) throw failure.error;
}

/**
 * Read the model pi starts with. Reads the file every call, so it shows a hand
 * edit or another session's change instead of a copy from session start.
 */
export function readDefaultModel(cwd: string, agentDir: string): { provider: string; id: string } | undefined {
  // Global scope only. Ctrl+D writes the global file, so reading the merged
  // global-plus-project view would show a default this picker cannot clear.
  const settings = SettingsManager.create(cwd, agentDir).getGlobalSettings();
  if (!settings.defaultModel) return undefined;
  return { provider: settings.defaultProvider ?? "", id: settings.defaultModel };
}

/**
 * Write `defaultProvider` and `defaultModel` into settings.json. A call with an
 * undefined provider or id clears both fields, and pi falls back to its
 * built-in per-provider defaults on the next start.
 */
export async function writeDefaultModel(
  cwd: string,
  agentDir: string,
  provider: string | undefined,
  modelId: string | undefined,
): Promise<void> {
  await updateSettings(cwd, agentDir, (settings) => {
    // undefined removes the field: `JSON.stringify` drops an undefined value,
    // and pi's own optional setters, such as `setShellPath`, take undefined the
    // same way. Only these two setters miss it in their type.
    const clearable = settings as SettingsManager & {
      setDefaultProvider(value: string | undefined): void;
      setDefaultModel(value: string | undefined): void;
    };
    if (provider && modelId) settings.setDefaultModelAndProvider(provider, modelId);
    else {
      clearable.setDefaultProvider(undefined);
      clearable.setDefaultModel(undefined);
    }
  });
}

/** True when settings.json currently scopes pi to a model list. */
export function hasEnabledModels(cwd: string, agentDir: string): boolean {
  const patterns = SettingsManager.create(cwd, agentDir).getGlobalSettings().enabledModels;
  return Array.isArray(patterns) && patterns.length > 0;
}

/** Write `enabledModels` into settings.json. An empty list removes the field. */
export async function writeEnabledModels(cwd: string, agentDir: string, patterns: string[]): Promise<void> {
  await updateSettings(cwd, agentDir, (settings) => {
    settings.setEnabledModels(patterns.length > 0 ? patterns : undefined);
  });
}
