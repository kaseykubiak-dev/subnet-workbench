/**
 * Sync the workbench source into the personal site.
 *
 * Copies src/{engine,modes,vendor,visuals,shell} (minus tests and the
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

const DIRS = ["engine", "modes", "vendor", "visuals", "shell"];
const EXCLUDE = (name) => name.endsWith(".test.ts") || name === "main.ts";

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
