/**
 * Checks that the session runs at the thinking level the picker shows.
 *
 * Pi picks the level on a model switch from its own copy of settings.json,
 * read when the session started. The picker writes the file through a
 * separate SettingsManager, so that copy goes stale. The fake pi here keeps
 * the same stale copy and the same order of lookups, and the real extension
 * has to correct it.
 *
 * Run: node scripts/run-node-bench.mjs "$PWD/scripts/verify/thinking-apply.ts"
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
// The package exports the type only, so the real class comes by path.
import { KeybindingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import type { RichModelPicker } from "../../src/picker.ts";

const scratch = mkdtempSync(join(tmpdir(), "rich-model-selector-verify-"));
const agentDir = join(scratch, "agent");
const cwd = join(scratch, "project");
mkdirSync(agentDir);
mkdirSync(cwd);
const settingsPath = join(agentDir, "settings.json");
writeFileSync(settingsPath, JSON.stringify({ defaultThinkingLevel: "medium" }));
// Set before the extension loads, so every path it builds lands in scratch.
process.env.PI_CODING_AGENT_DIR = agentDir;
const { default: registerExtension } = await import("../../src/index.ts");

const makeModel = (id: string): Model<any> =>
  ({
    id,
    name: id,
    provider: "p",
    api: "x",
    baseUrl: "",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 100,
  }) as Model<any>;
const [alpha, beta, gamma] = [makeModel("alpha"), makeModel("beta"), makeModel("gamma")] as [
  Model<any>,
  Model<any>,
  Model<any>,
];
const registry = {
  getAvailable: () => [alpha, beta, gamma],
  refresh: async () => ({ aborted: false, errors: new Map() }),
  hasConfiguredAuth: () => true,
  isUsingOAuth: () => false,
  getProviderDisplayName: (provider: string) => provider,
};

type Handler = (event: unknown, ctx: unknown) => unknown;
const handlers = new Map<string, Handler[]>();
const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
const session = { model: alpha, level: "medium" as ModelThinkingLevel };
let scopedModels: { model: Model<any>; thinkingLevel?: ModelThinkingLevel }[] = [];
let staleSettings: { defaultThinkingLevel?: ModelThinkingLevel; modelThinkingLevels?: Record<string, ModelThinkingLevel> } =
  {};

/** Pi reads settings.json once, when the session starts. */
function startSession(): void {
  staleSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
}

/** Pi's own order on a switch, read from its stale copy. */
function piLevelForSwitch(model: Model<any>, explicitLevel?: ModelThinkingLevel): ModelThinkingLevel {
  return (
    explicitLevel ??
    staleSettings.modelThinkingLevels?.[`${model.provider}/${model.id}`] ??
    staleSettings.defaultThinkingLevel ??
    session.level
  );
}

async function emit(type: string, event: object): Promise<void> {
  for (const handler of handlers.get(type) ?? []) await handler({ type, ...event }, makeContext([]));
}

const pi = {
  on: (type: string, handler: Handler) => handlers.set(type, [...(handlers.get(type) ?? []), handler]),
  registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) =>
    commands.set(name, options),
  registerShortcut: () => undefined,
  getThinkingLevel: () => session.level,
  setThinkingLevel: (level: ModelThinkingLevel) => {
    session.level = level;
  },
  setModel: async (model: Model<any>) => {
    const previousModel = session.model;
    session.level = piLevelForSwitch(model);
    session.model = model;
    if (previousModel !== model) await emit("model_select", { model, previousModel, source: "set" });
    return true;
  },
};

/** Pi's Ctrl+P. */
async function cycleTo(model: Model<any>, explicitLevel?: ModelThinkingLevel): Promise<void> {
  const previousModel = session.model;
  session.level = piLevelForSwitch(model, explicitLevel);
  session.model = model;
  await emit("model_select", { model, previousModel, source: "cycle" });
}

let lastFrame: string[] = [];
function makeContext(keys: string[]) {
  return {
    mode: "tui",
    cwd,
    model: session.model,
    scopedModels,
    modelRegistry: registry,
    getContextUsage: () => undefined,
    ui: {
      notify: () => undefined,
      custom: (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => unknown) =>
        new Promise((resolve) => {
          const picker = factory(
            { requestRender: () => undefined },
            { fg: (_color: string, text: string) => text },
            new KeybindingsManager(),
            resolve,
          ) as RichModelPicker;
          lastFrame = picker.render(200);
          for (const key of keys) picker.handleInput(key);
        }),
    },
  };
}

/** Opens the picker the way `/models <search>` does, and presses the keys. */
async function openPicker(search: string, keys: string[]): Promise<void> {
  await commands.get("models")?.handler(search, makeContext(keys));
}

const SHIFT_TAB = "\x1b[Z";
const ENTER = "\r";
const ESCAPE = "\x1b";
const rowOf = (id: string) => lastFrame.find((line) => line.includes(` ${id} `))?.split("│")[1]?.trim() ?? "";

let failures = 0;
function expect(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
}

registerExtension(pi as never);
startSession();

// Enter on a model whose level changed in this picker.
await openPicker("beta", [SHIFT_TAB, ENTER]);
expect("Enter switches the model", session.model.id, "beta");
expect("Enter applies the level set in the picker", session.level, "high");

// Esc after a change to the model in use.
await openPicker("beta", [SHIFT_TAB, ESCAPE]);
expect("Esc applies a change to the model in use", session.level, "off");

// Esc with nothing changed keeps a level set for this session only.
pi.setThinkingLevel("low");
await openPicker("", [ESCAPE]);
expect("Esc keeps a session-only level", session.level, "low");

// Ctrl+P to a model whose level changed in the picker.
await openPicker("alpha", [SHIFT_TAB, ESCAPE]);
await cycleTo(alpha);
expect("Ctrl+P applies the level set in the picker", session.level, "high");

// A level in enabledModels comes first in pi's order.
scopedModels = [{ model: beta, thinkingLevel: "minimal" }];
await cycleTo(beta, "minimal");
expect("Ctrl+P keeps an enabledModels level", session.level, "minimal");
scopedModels = [];

// With no global default, pi keeps the level the session runs at.
const withoutDefault = JSON.parse(readFileSync(settingsPath, "utf8"));
delete withoutDefault.defaultThinkingLevel;
writeFileSync(settingsPath, JSON.stringify(withoutDefault));
startSession();
pi.setThinkingLevel("low");
await openPicker("gamma", [ENTER]);
expect("row shows the level a switch keeps", rowOf("gamma").includes("low ·"), true);
expect("Enter keeps the session level", session.level, "low");

rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
