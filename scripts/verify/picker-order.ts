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

function makePicker(initialSearch?: string): RichModelPicker {
  return new RichModelPicker({
    tui: { requestRender: () => undefined } as never,
    theme,
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
    onSetDefaultModel: async () => undefined,
  });
}

let picker = makePicker();
const ROW = /^ [→ ] [★·✗] \S/;
const leftRows = () => picker.render(WIDTH).map((line) => line.split("│")[1] ?? "").filter((line) => ROW.test(line));
const ids = () => leftRows().map((row) => row.replace(/^ [→ ] [★·✗] /, "").trim().split(/\s+/)[0]);
const cursorIndex = () => leftRows().findIndex((row) => row.startsWith(" →"));
const rowOf = (id: string) => leftRows().find((row) => row.includes(` ${id} `)) ?? "";
const contextColumns = () => new Set(leftRows().map((row) => row.indexOf(" 200K"))).size;
const moveCursorTo = (id: string) => {
  for (let step = 0; step < 20 && ids()[cursorIndex()] !== id; step++) picker.handleInput("\x1b[B");
};

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

// A search keeps the sorted relative order.
picker.handleInput("g");
expect("search g keeps order", ids(), ["g2", "g1", "b-longer-name-here"]);
picker.handleInput("\x7f");
expect("clear search restores", ids().length, 7);

// A star moves the row to the end of the star list, and the cursor follows.
moveCursorTo("a2");
picker.handleInput("\x13");
expect("after star a2", ids(), ["g2", "a1", "a2", "z1", "g1", "b-longer-name-here", "b1"]);
expect("cursor followed a2", cursorIndex(), 2);

// Tab: all -> hidden (empty) -> starred. Reorder there.
picker.handleInput("\t");
picker.handleInput("\t");
expect("starred view", ids(), ["g2", "a1", "a2"]);
moveCursorTo("a2");
picker.handleInput("\x1b[1;5A");
expect("reorder a2 up", ids(), ["g2", "a2", "a1"]);
expect("cursor followed reorder", cursorIndex(), 1);

// Hide, then restore.
picker.handleInput("\t");
expect("all view after reorder", ids(), ["g2", "a2", "a1", "z1", "g1", "b-longer-name-here", "b1"]);
moveCursorTo("b1");
picker.handleInput("\x05");
expect("all view without b1", ids().includes("b1"), false);
picker.handleInput("\t");
expect("hidden view", ids(), ["b1"]);
picker.handleInput("\x05");
picker.handleInput("\t");
picker.handleInput("\t");
expect("b1 restored", ids().includes("b1"), true);

// A level change re-sizes the column, and the columns still line up.
moveCursorTo("b-longer-name-here");
picker.handleInput("\x1b[C");
picker.handleInput("\x1b[C");
expect("pinned xhigh, no dot", rowOf("b-longer-name-here").includes("xhigh ·"), false);
expect("pinned xhigh present", rowOf("b-longer-name-here").includes(" xhigh"), true);
expect("columns aligned after level change", contextColumns(), 1);
picker.handleInput("\x1b[D");
picker.handleInput("\x1b[D");
expect("back to inherited", rowOf("b-longer-name-here").includes("medium ·"), true);
picker.dispose();
await thinkingStore.flush();

// A search from the command line widens from starred to all.
picker = makePicker("b1");
expect("initialSearch widens to all", ids(), ["b1"]);
picker.dispose();

rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
