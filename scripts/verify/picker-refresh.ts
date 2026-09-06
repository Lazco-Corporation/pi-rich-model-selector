/**
 * Checks the catalog refresh: it carries an abort signal, it stops when the
 * picker closes, it gives up after the bound, and a refresh that lands
 * re-sorts the list and keeps the cursor on the same model.
 *
 * Run: node scripts/run-node-bench.mjs "$PWD/scripts/verify/picker-refresh.ts"
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { RichModelPicker } from "../../src/picker.ts";
import { ModelThinkingStore, StarStore } from "../../src/store.ts";

// Shrink the wall clock so the 15 s bound fires in a fraction of a second.
const realSetTimeout = globalThis.setTimeout;
(globalThis as { setTimeout: unknown }).setTimeout = (handler: () => void, delay?: number) =>
  realSetTimeout(handler, delay === 15_000 ? 50 : delay);
const sleep = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

const makeModel = (provider: string, id: string): Model<any> =>
  ({
    id,
    name: id,
    provider,
    api: "x",
    baseUrl: "",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 100,
  }) as Model<any>;

let models = [makeModel("p", "one"), makeModel("p", "two")];
let observedSignal: AbortSignal | undefined;
let settled = "";
let resolveRefresh: () => void = () => undefined;
const registry = {
  getAvailable: () => [...models],
  refresh: (options?: { signal?: AbortSignal }) =>
    new Promise<void>((resolve, reject) => {
      observedSignal = options?.signal;
      resolveRefresh = resolve;
      observedSignal?.addEventListener("abort", () => {
        settled = "aborted";
        reject(new DOMException("aborted", "AbortError"));
      });
    }),
  hasConfiguredAuth: () => true,
  isUsingOAuth: () => false,
  getProviderDisplayName: (provider: string) => provider,
};
const theme = { fg: (_color: string, text: string) => text };
const scratch = mkdtempSync(join(tmpdir(), "rich-model-selector-verify-"));
const store = new StarStore(join(scratch, "rich-model-selector.json"));
const thinkingStore = new ModelThinkingStore(scratch, scratch);
let renders = 0;
const WIDTH = 200;

function makePicker(): RichModelPicker {
  settled = "";
  observedSignal = undefined;
  return new RichModelPicker({
    tui: { requestRender: () => { renders += 1; } } as never,
    theme,
    store,
    thinkingStore,
    defaultThinkingLevel: "medium",
    registry: registry as never,
    currentModel: models[1],
    defaultModel: undefined,
    contextTokens: null,
    onSelect: () => undefined,
    onCancel: () => undefined,
    onSetDefaultModel: async () => undefined,
  });
}
const ROW = /^ [→ ] [★·✗] \S/;
const rows = (picker: RichModelPicker) =>
  picker.render(WIDTH).map((line) => line.split("│")[1] ?? "").filter((line) => ROW.test(line));
const ids = (picker: RichModelPicker) => rows(picker).map((row) => row.replace(/^ [→ ] [★·✗] /, "").trim().split(/\s+/)[0]);
const cursor = (picker: RichModelPicker) => rows(picker).findIndex((row) => row.startsWith(" →"));

let failures = 0;
function expect(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
}

// 1. Close aborts the refresh, and nothing redraws after close.
let picker = makePicker();
picker.render(WIDTH);
await sleep(5);
expect("refresh gets a signal", observedSignal instanceof AbortSignal, true);
expect("not aborted while open", observedSignal?.aborted, false);
renders = 0;
picker.handleInput("\x1b");
await sleep(5);
expect("aborted on close", observedSignal?.aborted, true);
expect("refresh settled as aborted", settled, "aborted");
expect("no render after close", renders, 0);

// 2. The bound aborts a refresh that never answers, and the picker still works.
picker = makePicker();
picker.render(WIDTH);
await sleep(150);
expect("bound aborts a stuck refresh", settled, "aborted");
picker.handleInput("\x1b[B");
expect("picker still works after the bound", ids(picker).length, 2);
picker.dispose();

// 3. A refresh that lands re-sorts, keeps the cursor, and redraws once.
picker = makePicker();
picker.render(WIDTH);
expect("before refresh", ids(picker), ["two", "one"]);
models = [makeModel("p", "one"), makeModel("p", "three"), makeModel("p", "two"), makeModel("a", "alpha")];
renders = 0;
resolveRefresh();
await sleep(5);
expect("after refresh", ids(picker), ["two", "alpha", "one", "three"]);
expect("cursor stays on the same model", ids(picker)[cursor(picker)], "two");
expect("one redraw", renders, 1);
picker.dispose();

// 4. No timer holds the process open.
const resources = (process as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo?.() ?? [];
expect("no timer left behind", resources.filter((name) => name === "Timeout").length, 0);

rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
