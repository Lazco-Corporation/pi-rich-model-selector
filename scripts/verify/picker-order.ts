/**
 * Drives the exported picker through every action that changes the list, and
 * checks the order, the cursor, and the column alignment after each one.
 *
 * Run: node scripts/run-node-bench.mjs "$PWD/scripts/verify/picker-order.ts"
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
// The package exports the type only, so the real class comes by path.
import { KeybindingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { supportedThinkingLevels } from "../../src/model-facts.ts";
import { RichModelPicker } from "../../src/picker.ts";
import { ModelThinkingStore, StarStore } from "../../src/store.ts";

const makeModel = (provider: string, id: string, reasoning = true, extra: Partial<Model<any>> = {}): Model<any> =>
  ({
    id,
    name: id.toUpperCase(),
    provider,
    api: "x",
    baseUrl: "",
    reasoning,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 100,
    ...extra,
  }) as Model<any>;

const models = [
  makeModel("zeta", "z1"),
  makeModel("alpha", "a2"),
  makeModel("alpha", "a1"),
  makeModel("beta", "b1", false),
  makeModel("beta", "b-longer-name-here", true, { thinkingLevelMap: { xhigh: "x", max: "m" } } as Partial<Model<any>>),
  makeModel("gamma", "g1"),
  makeModel("gamma", "g2"),
];
const registry = {
  getAvailable: () => [...models],
  refresh: async () => ({ aborted: false, errors: new Map() }),
  hasConfiguredAuth: () => true,
  isUsingOAuth: () => false,
  getProviderDisplayName: (provider: string) => provider,
};
const theme = { fg: (_color: string, text: string) => text };
const scratch = mkdtempSync(join(tmpdir(), "rich-model-selector-verify-"));
const store = new StarStore(join(scratch, "rich-model-selector.json"));
const thinkingStore = new ModelThinkingStore(scratch, scratch);
store.toggleStar("gamma/g2");
store.toggleStar("alpha/a1");
store.flush();
const WIDTH = 200;
const defaultCalls: (string | undefined)[][] = [];

function makePicker(initialSearch?: string, keybindings = new KeybindingsManager()): RichModelPicker {
  return new RichModelPicker({
    tui: { requestRender: () => undefined } as never,
    theme,
    keybindings,
    store,
    thinkingStore,
    defaultThinkingLevel: "medium",
    registry: registry as never,
    currentModel: models[0],
    defaultModel: initialSearch ? undefined : { provider: "gamma", id: "g1" },
    contextTokens: null,
    initialSearch,
    onSelect: () => undefined,
    onCancel: () => undefined,
    onSetDefaultModel: async (provider, id) => {
      defaultCalls.push([provider, id]);
      return undefined;
    },
  });
}

// Terminal sequences for the keys under test.
const KEY = {
  tab: "\t",
  shiftTab: "\x1b[Z",
  down: "\x1b[B",
  shiftLeft: "\x1b[1;2D",
  shiftRight: "\x1b[1;2C",
  altUp: "\x1b[1;3A",
  ctrlUp: "\x1b[1;5A",
  pageUp: "\x1b[5~",
  pageDown: "\x1b[6~",
  backspace: "\x7f",
  ctrlA: "\x01",
  ctrlD: "\x04",
  ctrlE: "\x05",
  ctrlS: "\x13",
  ctrlT: "\x14",
  ctrlX: "\x18",
  f2: "\x1bOQ",
};

let picker = makePicker();
const ROW = /^ [→ ] [★·✗] \S/;
const leftRows = () => picker.render(WIDTH).map((line) => line.split("│")[1] ?? "").filter((line) => ROW.test(line));
const ids = () => leftRows().map((row) => row.replace(/^ [→ ] [★·✗] /, "").trim().split(/\s+/)[0]);
const cursorIndex = () => leftRows().findIndex((row) => row.startsWith(" →"));
const rowOf = (id: string) => leftRows().find((row) => row.includes(` ${id} `)) ?? "";
const contextColumns = () => new Set(leftRows().map((row) => row.indexOf(" 200K"))).size;
const moveCursorTo = (id: string) => {
  for (let step = 0; step < 20 && ids()[cursorIndex()] !== id; step++) picker.handleInput(KEY.down);
};
// The box draws its cursor in inverse video, so drop the color codes.
const searchText = () =>
  (picker.render(WIDTH).find((line) => line.startsWith("│ >"))?.split("│")[1] ?? "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/^ > ?/, "")
    .trimEnd();
const hintLine = () => picker.render(WIDTH)[0] ?? "";
const statusLine = () => picker.render(WIDTH).find((line) => line.includes("thinking level")) ?? "";

let failures = 0;
function expect(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
}

// The model in use is not starred, so the picker opens on "all", cursor on it.
expect("all view order", ids(), ["g2", "a1", "z1", "g1", "a2", "b-longer-name-here", "b1"]);
expect("cursor on current", cursorIndex(), 2);
expect("context column aligned", contextColumns(), 1);
expect("b1 shows '-'", / - /.test(rowOf("b1").replace(/\s+/g, " ")), true);
expect("z1 inherits", rowOf("z1").includes("medium ·"), true);
// The hint names the keys pi binds by default.
expect("hint: level keys", hintLine().includes("Shift+Tab/←/→ thinking"), true);
expect("hint: star key", hintLine().includes("Ctrl+T star"), true);
expect("hint: default key", hintLine().includes("Ctrl+S default"), true);
expect("hint: hide key", hintLine().includes("Ctrl+X hide"), true);
expect("hint: view key", hintLine().includes("· Tab hidden"), true);

// A search keeps the sorted relative order.
picker.handleInput("g");
expect("search g keeps order", ids(), ["g2", "g1", "b-longer-name-here"]);
picker.handleInput(KEY.backspace);
expect("clear search restores", ids().length, 7);

// The search box keeps its own editing keys.
for (const char of "abc") picker.handleInput(char);
picker.handleInput(KEY.ctrlA);
picker.handleInput(KEY.ctrlD);
expect("Ctrl+D deletes forward in the search box", searchText(), "bc");
picker.handleInput(KEY.ctrlE);
picker.handleInput("x");
expect("Ctrl+E jumps to the end of the search box", searchText(), "bcx");
for (let index = 0; index < 3; index++) picker.handleInput(KEY.backspace);
expect("search box cleared", ids().length, 7);

// Page keys stop at the ends instead of wrapping.
moveCursorTo("g2");
picker.handleInput(KEY.pageDown);
expect("PageDown stops at the last row", cursorIndex(), 6);
picker.handleInput(KEY.pageUp);
expect("PageUp stops at the first row", cursorIndex(), 0);

// A star moves the row to the end of the star list, and the cursor follows.
moveCursorTo("a2");
picker.handleInput(KEY.ctrlT);
expect("after star a2", ids(), ["g2", "a1", "a2", "z1", "g1", "b-longer-name-here", "b1"]);
expect("cursor followed a2", cursorIndex(), 2);

// Tab: all -> hidden (empty) -> starred. Reorder there.
picker.handleInput(KEY.tab);
picker.handleInput(KEY.tab);
expect("starred view", ids(), ["g2", "a1", "a2"]);
moveCursorTo("a2");
picker.handleInput(KEY.ctrlUp);
expect("Ctrl+Up no longer reorders", ids(), ["g2", "a1", "a2"]);
picker.handleInput(KEY.altUp);
expect("Alt+Up reorders a2 up", ids(), ["g2", "a2", "a1"]);
expect("cursor followed reorder", cursorIndex(), 1);

// Hide, then restore.
picker.handleInput(KEY.tab);
expect("all view after reorder", ids(), ["g2", "a2", "a1", "z1", "g1", "b-longer-name-here", "b1"]);
moveCursorTo("b1");
picker.handleInput(KEY.ctrlX);
expect("all view without b1", ids().includes("b1"), false);
picker.handleInput(KEY.tab);
expect("hidden view", ids(), ["b1"]);
expect("hint: restore key", hintLine().includes("Ctrl+X restore"), true);
picker.handleInput(KEY.ctrlX);
picker.handleInput(KEY.tab);
picker.handleInput(KEY.tab);
expect("b1 restored", ids().includes("b1"), true);

// Ctrl+S sets the startup default, as in pi's own picker, and clears it again.
moveCursorTo("z1");
picker.handleInput(KEY.ctrlS);
await new Promise((resolve) => setTimeout(resolve, 0));
expect("Ctrl+S sets the default", defaultCalls.at(-1), ["zeta", "z1"]);
expect("row marks the default", rowOf("z1").includes("·default"), true);
moveCursorTo("z1");
picker.handleInput(KEY.ctrlS);
await new Promise((resolve) => setTimeout(resolve, 0));
expect("Ctrl+S again clears it", defaultCalls.at(-1), [undefined, undefined]);

// Shift+Tab steps the level. A level change re-sizes the column, and the
// columns still line up.
moveCursorTo("b-longer-name-here");
picker.handleInput(KEY.shiftTab);
picker.handleInput(KEY.shiftTab);
expect("Shift+Tab keeps the view", ids().includes("b-longer-name-here"), true);
expect("pinned xhigh, no dot", rowOf("b-longer-name-here").includes("xhigh ·"), false);
expect("pinned xhigh present", rowOf("b-longer-name-here").includes(" xhigh"), true);
expect("columns aligned after level change", contextColumns(), 1);
// The level wraps, so the rest of one full cycle lands back on the default.
const levels = supportedThinkingLevels(models[4]!);
for (let step = 2; step < levels.length; step++) picker.handleInput(KEY.shiftTab);
expect("back to inherited", rowOf("b-longer-name-here").includes("medium ·"), true);

// Shift+Left and Shift+Right step one level either way and stop at the ends.
picker.handleInput(KEY.shiftLeft);
expect("Shift+Left steps down", rowOf("b-longer-name-here").includes(" low "), true);
picker.handleInput(KEY.shiftRight);
expect("Shift+Right steps back up", rowOf("b-longer-name-here").includes("medium ·"), true);
for (let step = 0; step < levels.length; step++) picker.handleInput(KEY.shiftLeft);
expect("Shift+Left stops at the lowest level", rowOf("b-longer-name-here").includes(` ${levels[0]} `), true);
expect("the stop says so", statusLine().includes("lowest thinking level"), true);
for (let step = 0; step < levels.length; step++) picker.handleInput(KEY.shiftRight);
expect("Shift+Right stops at the highest level", rowOf("b-longer-name-here").includes(` ${levels.at(-1)} `), true);
expect("the stop says so", statusLine().includes("highest thinking level"), true);
while (!rowOf("b-longer-name-here").includes("medium ·")) picker.handleInput(KEY.shiftLeft);
picker.dispose();
await thinkingStore.flush();

// A key rebound in keybindings.json moves the action, and the hint follows.
picker = makePicker(undefined, new KeybindingsManager({ "app.thinking.cycle": "f2", "tui.input.tab": "ctrl+o" }));
expect("hint: rebound level key", hintLine().includes("F2/Shift+←/Shift+→ thinking"), true);
expect("hint: rebound view key", hintLine().includes("Ctrl+O hidden"), true);
moveCursorTo("b-longer-name-here");
picker.handleInput(KEY.shiftTab);
expect("the old level key does nothing", rowOf("b-longer-name-here").includes("medium ·"), true);
picker.handleInput(KEY.f2);
expect("the rebound level key steps", rowOf("b-longer-name-here").includes(" high "), true);
picker.handleInput(KEY.shiftLeft);
picker.handleInput(KEY.tab);
expect("the old view key does nothing", hintLine().includes("Ctrl+O hidden"), true);
picker.handleInput("\x0f");
expect("the rebound view key changes the view", hintLine().includes("Ctrl+O starred"), true);
picker.dispose();
await thinkingStore.flush();

// A search from the command line widens from starred to all.
picker = makePicker("b1");
expect("initialSearch widens to all", ids(), ["b1"]);
picker.dispose();

rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
