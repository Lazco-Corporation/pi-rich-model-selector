// Runs a TypeScript script under node through jiti, the loader pi itself uses
// for extensions. Bun strips types on its own, but pi runs on node, so a
// timing taken here is the timing the user gets.
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
await jiti.import(process.argv[2]);
