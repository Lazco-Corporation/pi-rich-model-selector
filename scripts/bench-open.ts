/**
 * Times the file reads that openPicker in index.ts does before the picker
 * appears. These run against the real pi agent directory, read-only.
 *
 * Run: node scripts/run-node-bench.mjs "$PWD/scripts/bench-open.ts"
 */
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ModelThinkingStore, readDefaultModel, StarStore } from "../src/store.ts";

const agentDir = getAgentDir();
const cwd = process.cwd();

function measure(label: string, iterations: number, action: () => void): void {
  action();
  const start = performance.now();
  for (let index = 0; index < iterations; index++) action();
  const perOp = (performance.now() - start) / iterations;
  console.log(`${label.padEnd(48)} ${perOp.toFixed(3).padStart(9)} ms/op`);
}

const starStore = new StarStore(join(agentDir, "rich-model-selector.json"));
const thinkingStore = new ModelThinkingStore(cwd, agentDir);

measure("StarStore.reload()", 50, () => starStore.reload());
measure("StarStore.reloadIfChanged()", 200, () => starStore.reloadIfChanged());
measure("ModelThinkingStore.reload() (levels + default)", 50, () => thinkingStore.reload());
measure("readDefaultModel()", 50, () => readDefaultModel(cwd, agentDir));
measure("openPicker file reads, all together", 50, () => {
  starStore.reload();
  thinkingStore.reload();
  thinkingStore.getDefaultLevel();
  readDefaultModel(cwd, agentDir);
});
