/**
 * Sync the workbench source into the personal site.
 *
 * Copies src/{engine,modes,cloud,vendor,visuals,shell} (minus tests and the
 * vanilla entry point) into the Next.js site at
 * Personal-Website/kasey-kubiak/src/lib/subnet-workbench/. This repo is
 * the source of truth; the site copy is generated. Run after any change
 * here that the site page should pick up.
 */

import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target =
  process.argv[2] ??
  join(root, "..", "Personal-Website", "kasey-kubiak", "src", "lib", "subnet-workbench");

const DIRS = ["engine", "modes", "cloud", "vendor", "visuals", "shell"];
const EXCLUDE = (name) => name.endsWith(".test.ts") || name === "main.ts";

// A missing directory here is worse than a broken build, because a stale
// generated copy still compiles: the site keeps serving the previous version
// while this script reports success. Every src/ directory the shell can
// import must be listed above.
const present = new Set(
  (await readdir(join(root, "src"), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
);
// src/fonts holds the woff2 files the standalone build base64-embeds. The
// site loads its own webfonts, so copying them would be dead weight.
const DELIBERATELY_SKIPPED = ["fonts"];
const missing = [...present].filter(
  (d) => !DIRS.includes(d) && !DELIBERATELY_SKIPPED.includes(d)
);
if (missing.length > 0) {
  throw new Error(
    `src/ has directories the sync does not copy: ${missing.join(", ")}. ` +
      "Add them to DIRS, or exclude them deliberately."
  );
}

await rm(target, { recursive: true, force: true });
let copied = 0;
for (const dir of DIRS) {
  const src = join(root, "src", dir);
  const dest = join(target, dir);
  await mkdir(dest, { recursive: true });
  for (const name of await readdir(src)) {
    if (EXCLUDE(name)) continue;
    await cp(join(src, name), join(dest, name));
    copied += 1;
  }
}

await writeFile(
  join(target, "README.md"),
  "# Subnet Workbench (generated copy)\n\n" +
    "Do not edit. Source of truth: `Claude-Projects/Subnet-Workbench`.\n" +
    "Regenerate with `npm run sync:site` in that repo.\n"
);

console.log(`synced ${copied} files -> ${target}`);
