import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";

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

/** How long before a lock left by a dead process may be taken over. */
const STALE_LOCK_MS = 2000;

/** Debounce for a normal save, and the wait before a failed save retries. */
const SAVE_DELAY_MS = 150;
const SAVE_RETRY_DELAY_MS = 250;

/**
 * How many times a save may retry. Only a busy lock is worth retrying, and the
 * lock frees itself after STALE_LOCK_MS, so this covers that wait with room to
 * spare. A bound matters: without one, a disk that never accepts a write would
 * retry for as long as pi runs.
 */
const MAX_SAVE_RETRIES = 8;

/**
 * Errors worth a retry. Both mean another process holds the lock right now, so
 * waiting is likely to help. Anything else, such as a read-only disk or a
 * permissions fault, would fail the same way every time.
 */
function isLockContention(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  return code === "ELOCKED" || code === "ECOMPROMISED";
}

function emptyData(): StoreData {
  return {
    version: CURRENT_VERSION,
    starred: [],
    hidden: [],
    hideBuiltinModelCommand: false,
  };
}

/**
 * A short string that changes when the file changes.
 *
 * The inode is in it on purpose. A write swaps the file through rename, so the
 * inode is new every time. That catches a second write inside the same clock
 * tick, which a timestamp alone would miss.
 */
function fileRevision(path: string): string | undefined {
  try {
    const stats = statSync(path, { bigint: true });
    return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
  } catch {
    return undefined;
  }
}

/**
 * Run one read-merge-write while holding the star file lock.
 *
 * Without the lock, two pi processes read the same file, each merges its own
 * field onto that copy, and the later rename drops the other one's field. The
 * merge alone is not enough: it narrows the loss to the gap between the read
 * and the rename, but the gap is still there.
 *
 * The same lock library pi uses for settings.json. A crashed holder frees the
 * lock through the library's stale timeout, so a dead process cannot wedge the
 * picker.
 */
function withFileLock<T>(path: string, operation: () => T): T {
  const maxAttempts = 10;
  const retryDelayMs = 20;
  let release: (() => void) | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // realpath: false, because the file may not exist yet.
      //
      // stale: a holder that crashed leaves its lock behind. The library's
      // default frees it after 10 seconds, which is longer than a session that
      // is quitting will wait. A star write takes microseconds, so 2 seconds is
      // still far longer than any live holder needs.
      release = lockfile.lockSync(path, { realpath: false, stale: STALE_LOCK_MS });
      break;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ELOCKED" || attempt === maxAttempts) throw error;
      const start = Date.now();
      while (Date.now() - start < retryDelayMs) {
        // Sleep in place. Every caller here is synchronous.
      }
    }
  }
  try {
    return operation();
  } finally {
    release?.();
  }
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
  /** The revision this copy came from. Undefined when the file was missing. */
  private revision: string | undefined;
  /** Retries left for the change now waiting. */
  private retriesLeft = MAX_SAVE_RETRIES;
  /** Set when a write failed for a reason no retry can fix. */
  private writeFailure: unknown;

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    // Read the revision first. A write that lands between the read below and
    // the stat would then leave a revision older than the data, and the next
    // check would re-read. The other order could skip that change instead.
    const revision = fileRevision(this.filePath);
    try {
      // A missing file means the user deleted it to start over. Keeping the
      // copy in memory would put every star back on the next write.
      this.data = existsSync(this.filePath) ? parseData(readFileSync(this.filePath, "utf8")) : emptyData();
    } catch {
      this.data = emptyData();
    }
    this.revision = revision;
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
    // A failed write keeps that change in memory, so re-reading now would
    // throw the user's work away. Keep it, and let the next write retry.
    if (!this.flush()) return;
    this.load();
  }

  /**
   * Re-read only when the file changed since this copy was made.
   *
   * For callers that run often, such as the autocomplete provider on every
   * keystroke. A stat is far cheaper than a read plus a JSON parse, and the
   * file changes almost never.
   */
  reloadIfChanged(): void {
    if (fileRevision(this.filePath) === this.revision) return;
    this.reload();
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

    withFileLock(this.filePath, () => {
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
      // The toggles decide star against hide on fresh data, so the common path
      // never reaches here in conflict. Three cases still can: a change of ours
      // waiting while another session writes the opposite choice, and a file
      // edited by hand to hold both. A model in both lists would show as
      // starred and hidden at once, so one list must give way.
      //
      // The list this process did not just change is the one that gives way,
      // because the other list holds what the user asked for most recently.
      const ourStarred = this.modifiedFields.has("starred");
      const ourHidden = this.modifiedFields.has("hidden");
      if (ourHidden && !ourStarred) merged.starred = merged.starred.filter((key) => !merged.hidden.includes(key));
      else merged.hidden = merged.hidden.filter((key) => !merged.starred.includes(key));

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
      // Nothing can run between the read above and this line, because every
      // call here is synchronous and the lock is held. So the merged result is
      // the whole truth now.
      this.data = merged;
      this.modifiedFields.clear();
      // An earlier failure is history once a write lands. Keeping it would
      // report "could not save" after the save worked, which would send the
      // user to redo work the file already holds.
      this.writeFailure = undefined;
      // This process wrote the file, so its own write must not look like an
      // outside change to reloadIfChanged.
      this.revision = fileRevision(this.filePath);
    });
  }

  private scheduleSave(field: MergeableField): void {
    this.modifiedFields.add(field);
    // A fresh change deserves a fresh set of retries, even if an earlier one
    // used them all up.
    this.retriesLeft = MAX_SAVE_RETRIES;
    this.armSaveTimer(SAVE_DELAY_MS);
  }

  private armSaveTimer(delayMs: number): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const timer = setTimeout(() => {
      this.saveTimer = undefined;
      try {
        this.writeNow();
      } catch (error) {
        // A failed write must never break the picker. A busy lock frees itself,
        // so waiting helps. A broken disk does not, and retrying it would spin
        // for as long as pi runs. writeNow keeps modifiedFields either way, so
        // the change is still in memory and the next change writes it too.
        if (isLockContention(error) && this.retriesLeft > 0) {
          this.retriesLeft -= 1;
          this.armSaveTimer(SAVE_RETRY_DELAY_MS);
          return;
        }
        this.writeFailure = error;
      }
    }, delayMs);
    // A pending retry must never hold pi open on the way out.
    timer.unref?.();
    this.saveTimer = timer;
  }

  /**
   * The error from the last write that could not be retried away, if any.
   * Reading it clears it, so one failure is reported once.
   */
  takeWriteFailure(): unknown {
    const failure = this.writeFailure;
    this.writeFailure = undefined;
    return failure;
  }

  /**
   * Write any pending change now. Returns false when the change is still only
   * in memory, so the caller knows the file does not hold it yet.
   *
   * A cleared timer does not mean the file is current: a write that failed
   * leaves no timer and an unsaved change. So the answer comes from the
   * modified field set, not from the timer. A failed write keeps that set, so
   * this retries on the next call instead of dropping the user's work.
   */
  flush(): boolean {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (this.modifiedFields.size === 0) return true;
    try {
      this.writeNow();
    } catch (error) {
      // writeNow keeps modifiedFields on failure. Clearing the timer above
      // would leave nothing to write it, so arm a retry when one can help.
      // Without this a failed flush parks the change until the user acts again.
      if (isLockContention(error) && this.retriesLeft > 0) {
        this.retriesLeft -= 1;
        this.armSaveTimer(SAVE_RETRY_DELAY_MS);
      } else {
        this.writeFailure = error;
      }
    }
    return this.modifiedFields.size === 0;
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
    // A star clears a hide, so this decision spans both lists. Another session
    // may have hidden this model since the picker opened. Deciding against the
    // copy in memory would drop that hide, or drop this star.
    this.reloadIfChanged();
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
    // Same reason as toggleStar: a hide clears a star.
    this.reloadIfChanged();
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
