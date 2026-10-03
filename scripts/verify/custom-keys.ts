/**
 * Drives the real picker through the custom key binds, and checks the store
 * keeps them across a reload and a second process.
 *
 * Run: node scripts/run-node-bench.mjs "$PWD/scripts/verify/custom-keys.ts"
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
// The package exports the type only, so the real class comes by path.
import { KeybindingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { isValidKeyId } from "../../src/keys.ts";
import { RichModelPicker } from "../../src/picker.ts";
import { DEFAULT_CUSTOM_KEYS, ModelThinkingStore, StarStore } from "../../src/store.ts";

const makeModel = (provider: string, id: string): Model<any> =>
  ({
    id,
    name: id.toUpperCase(),
    provider,
    api: "x",
    baseUrl: "",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 100,
  }) as Model<any>;

const models = [makeModel("alpha", "a1"), makeModel("alpha", "a2"), makeModel("beta", "b1")];
const registry = {
  getAvailable: () => [...models],
  refresh: async () => ({ aborted: false, errors: new Map() }),
  hasConfiguredAuth: () => true,
  isUsingOAuth: () => false,
  getProviderDisplayName: (provider: string) => provider,
};
const theme = { fg: (_color: string, text: string) => text };
const scratch = mkdtempSync(join(tmpdir(), "rich-model-selector-keys-"));
const filePath = join(scratch, "rich-model-selector.json");
const store = new StarStore(filePath);
const thinkingStore = new ModelThinkingStore(scratch, scratch);
const WIDTH = 200;

// Terminal sequences for the keys under test.
const KEY = {
  down: "\x1b[B",
  ctrlR: "\x12",
  ctrlX: "\x18",
  altS: "\x1bs",
};

function makePicker(): RichModelPicker {
  return new RichModelPicker({
    tui: { requestRender: () => undefined } as never,
    theme,
    keybindings: new KeybindingsManager(),
    store,
    thinkingStore,
    defaultThinkingLevel: "medium",
    registry: registry as never,
    currentModel: models[0],
    defaultModel: undefined,
    contextTokens: null,
    onSelect: () => undefined,
    onCancel: () => undefined,
    onSetDefaultModel: async () => undefined,
  });
}

const ROW = /^ [→ ] [★·✗] \S/;
const leftRows = (picker: RichModelPicker) =>
  picker
    .render(WIDTH)
    .map((line) => line.split("│")[1] ?? "")
    .filter((line) => ROW.test(line));
const hintLine = (picker: RichModelPicker) => picker.render(WIDTH)[0] ?? "";
const moveCursorTo = (picker: RichModelPicker, id: string) => {
  for (let step = 0; step < 10; step++) {
    const rows = leftRows(picker);
    const index = rows.findIndex((row) => row.startsWith(" →"));
    if (rows[index]?.includes(` ${id} `)) return;
    picker.handleInput(KEY.down);
  }
};

let failures = 0;
function expect(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
}

// A fresh file holds the defaults, and the hint names them.
expect("default keys", store.getKeys(), DEFAULT_CUSTOM_KEYS);
expect("default star is ctrl+r", DEFAULT_CUSTOM_KEYS.star, "ctrl+r");
let picker = makePicker();
expect("hint: default star key", hintLine(picker).includes("Ctrl+R star"), true);

// The default star key stars, and the old Ctrl+T is now plain filter text.
moveCursorTo(picker, "a2");
picker.handleInput(KEY.ctrlR);
expect("Ctrl+R stars a2", store.isStarred("alpha/a2"), true);
picker.dispose();

// A rebind moves the action, and the hint follows it.
store.setKey("star", "alt+s");
store.flush();
picker = makePicker();
// Alt prints as Option on macOS, so match the shared tail only.
expect("hint: rebound star key", hintLine(picker).includes("S star"), true);
expect("hint: old star key gone", hintLine(picker).includes("Ctrl+R"), false);
moveCursorTo(picker, "b1");
picker.handleInput(KEY.ctrlR);
expect("old star key no longer stars", store.isStarred("beta/b1"), false);
picker.handleInput(KEY.altS);
expect("rebound star key stars", store.isStarred("beta/b1"), true);
picker.dispose();

// The hide key rebinds the same way.
store.setKey("hide", "alt+s");
store.flush();
expect("hide rebound", store.getKeys().hide, "alt+s");

// Resetting hands one action back to its default and keeps the others.
store.resetKey("hide");
store.flush();
expect("hide back to default", store.getKeys().hide, DEFAULT_CUSTOM_KEYS.hide);
expect("star bind kept", store.getKeys().star, "alt+s");

// The binds survive a reload and a second process on the same file.
store.flush();
const second = new StarStore(filePath);
expect("second process reads the star bind", second.getKeys().star, "alt+s");
expect("second process keeps the default hide", second.getKeys().hide, DEFAULT_CUSTOM_KEYS.hide);

// A hand edit with a partial keys object fills the rest with defaults.
writeFileSync(filePath, JSON.stringify({ version: 1, starred: [], hidden: [], hideBuiltinModelCommand: false, keys: { star: "ctrl+q" } }));
const edited = new StarStore(filePath);
expect("hand edit star wins", edited.getKeys().star, "ctrl+q");
expect("hand edit hide falls back", edited.getKeys().hide, DEFAULT_CUSTOM_KEYS.hide);
expect("hand edit file still parses", JSON.parse(readFileSync(filePath, "utf8")).keys.star, "ctrl+q");

// Only key ids pi reads are accepted.
expect("ctrl+r valid", isValidKeyId("ctrl+r"), true);
expect("Ctrl+R valid", isValidKeyId("Ctrl+R"), true);
expect("shift+left valid", isValidKeyId("shift+left"), true);
expect("f2 valid", isValidKeyId("f2"), true);
expect("space valid", isValidKeyId("space"), true);
expect("empty invalid", isValidKeyId(""), false);
expect("unknown modifier invalid", isValidKeyId("meta+x"), false);
expect("repeated modifier invalid", isValidKeyId("ctrl+ctrl+x"), false);
expect("unknown base invalid", isValidKeyId("ctrl+foo"), false);

rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
