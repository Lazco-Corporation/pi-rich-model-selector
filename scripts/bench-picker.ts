/**
 * Drives the real RichModelPicker over the whole built-in model catalog and
 * reports how long each user action takes.
 *
 * Run: bun scripts/bench-picker.ts
 *
 * There is no test runner in this repo, so this is the one way to see a
 * regression in the hot paths: open, key press, cursor move, render.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { RichModelPicker } from "../src/picker.ts";
import { ModelThinkingStore, modelKey, StarStore } from "../src/store.ts";

const generated = (await import("../node_modules/@earendil-works/pi-ai/dist/models.generated.js")) as {
  MODELS: Record<string, Record<string, Model<any>>>;
};

const models: Model<any>[] = [];
for (const providerModels of Object.values(generated.MODELS)) {
  for (const model of Object.values(providerModels)) models.push(model);
}

const configured = new Set(["anthropic", "openai", "google", "openrouter", "amazon-bedrock"]);
const registry = {
  getAvailable: () => [...models],
  refresh: async () => ({ aborted: false, errors: new Map() }),
  hasConfiguredAuth: (model: Model<any>) => configured.has(model.provider),
  isUsingOAuth: (model: Model<any>) => model.provider === "anthropic",
  getProviderDisplayName: (provider: string) => provider,
};

const theme = {
  fg: (color: string, text: string) => {
    if (color === "thinkingMax") throw new Error("missing color");
    return `\x1b[38;5;${(color.length * 7) % 255}m${text}\x1b[39m`;
  },
};

let renderRequests = 0;
const tui = {
  requestRender: () => {
    renderRequests += 1;
  },
};

const scratch = mkdtempSync(join(tmpdir(), "rich-model-selector-bench-"));
const store = new StarStore(join(scratch, "rich-model-selector.json"));
const thinkingStore = new ModelThinkingStore(scratch, scratch);

// A handful of stars and a hidden model, so every branch of the sort runs.
for (const model of models.slice(0, 6)) store.toggleStar(modelKey(model.provider, model.id));
store.toggleHidden(modelKey(models[40]!.provider, models[40]!.id));
store.flush();

const WIDTH = 160;

function measure(label: string, iterations: number, action: () => void): number {
  // Warm up once so JIT and caches do not count against the first run.
  action();
  const start = performance.now();
  for (let index = 0; index < iterations; index++) action();
  const elapsed = performance.now() - start;
  const perOp = elapsed / iterations;
  console.log(`${label.padEnd(40)} ${perOp.toFixed(3).padStart(9)} ms/op  (${iterations} ops)`);
  return perOp;
}

function makePicker(initialSearch?: string): RichModelPicker {
  return new RichModelPicker({
    tui: tui as never,
    theme,
    store,
    thinkingStore,
    defaultThinkingLevel: "medium",
    registry: registry as never,
    currentModel: models[100],
    defaultModel: { provider: models[200]!.provider, id: models[200]!.id },
    contextTokens: 12345,
    initialSearch,
    onSelect: () => undefined,
    onCancel: () => undefined,
    onSetDefaultModel: async () => undefined,
  });
}

console.log(`models: ${models.length}, width: ${WIDTH}\n`);

const results: Record<string, number> = {};

results.open = measure("open picker (construct + first render)", 20, () => {
  const picker = makePicker();
  picker.render(WIDTH);
  picker.dispose();
});

const picker = makePicker();
picker.render(WIDTH);
// Tab to the "all" view, where the list is longest.
picker.handleInput("\t");
picker.render(WIDTH);

results.cursor = measure("cursor down + render", 200, () => {
  picker.handleInput("\x1b[B");
  picker.render(WIDTH);
});

results.typeChar = measure("type one search char + render", 100, () => {
  picker.handleInput("\x7f");
  picker.render(WIDTH);
  picker.handleInput("c");
  picker.render(WIDTH);
});

results.typeQuery = measure("type 'claude' then clear + render", 30, () => {
  for (const char of "claude") {
    picker.handleInput(char);
    picker.render(WIDTH);
  }
  for (let index = 0; index < 6; index++) {
    picker.handleInput("\x7f");
    picker.render(WIDTH);
  }
});

results.tab = measure("tab through 3 views + render", 100, () => {
  picker.handleInput("\t");
  picker.render(WIDTH);
  picker.handleInput("\t");
  picker.render(WIDTH);
  picker.handleInput("\t");
  picker.render(WIDTH);
});

results.star = measure("toggle star twice + render", 100, () => {
  picker.handleInput("\x13");
  picker.render(WIDTH);
  picker.handleInput("\x13");
  picker.render(WIDTH);
});

results.thinking = measure("thinking level right then left + render", 100, () => {
  picker.handleInput("\x1b[C");
  picker.render(WIDTH);
  picker.handleInput("\x1b[D");
  picker.render(WIDTH);
});

results.resize = measure("render at alternating widths", 100, () => {
  picker.render(WIDTH);
  picker.render(80);
});

results.rerender = measure("render with nothing changed", 500, () => {
  picker.render(WIDTH);
});

picker.dispose();
store.flush();
await thinkingStore.flush();
rmSync(scratch, { recursive: true, force: true });

console.log(`\nrender requests from refreshCatalog: ${renderRequests}`);
console.log(JSON.stringify(results));
