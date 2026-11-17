// Builds tracker/src -> dist/tracker.js (shopper-facing) and dist/probe.js (screenshot worker).
import { build, type BuildOptions } from "esbuild";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LIMIT_GZIP = 4096;
const common: BuildOptions = { bundle: true, minify: true, format: "iife", target: ["es2018"], legalComments: "none" };

await build({ ...common, entryPoints: ["tracker/src/index.ts"], outfile: "dist/tracker.js" });
await build({ ...common, entryPoints: ["tracker/src/probe.ts"], outfile: "dist/probe.js" });

const js = readFileSync("dist/tracker.js");
const gz = gzipSync(js, { level: 9 }).length;
console.log(`dist/tracker.js  ${js.length} B  (${gz} B gzipped, limit ${LIMIT_GZIP})`);
if (gz > LIMIT_GZIP) {
  console.error("tracker.js is over the gzip budget");
  process.exit(1);
}
