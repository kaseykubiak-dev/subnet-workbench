/**
 * Step 9: standalone single-file HTML build.
 *
 * Bundles src/shell/main.ts with esbuild and inlines the result into one
 * HTML file with zero external requests: no font links, no script tags
 * pointing anywhere, no CDN. Fonts fall back to system stacks via the
 * same CSS variables the site build uses, so the shell CSS needs no
 * changes. Output: dist/subnet-workbench.html.
 */

import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  entryPoints: [join(root, "src/shell/main.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  write: false,
});

const js = result.outputFiles[0].text;
if (js.includes("</script")) {
  // Guard against accidental script-tag breakout in the inlined payload.
  throw new Error("bundle contains </script — refusing to inline");
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Subnet Workbench</title>
<style>
  /* V6A palette, self-contained. Font variables fall back to system
     stacks: this file makes zero network requests by design. */
  :root {
    --color-void: #020509; --color-deep: #040a14; --color-panel: #030812;
    --color-blue: #0044dd; --color-glow: #1155ff; --color-bright: #4da6ff; --color-ice: #b0d8ff;
    --color-teal: #00ffcc; --color-amber: #ffaa00;
    --color-white: #eef6ff; --color-mid: #9dbcdf; --color-dim: #7fa6cd;
    --bord: rgba(77,166,255,0.28); --bord-teal: rgba(0,255,204,0.36);
    --font-display: 'Chakra Petch', 'Segoe UI', system-ui, sans-serif;
    --font-mono: 'IBM Plex Mono', 'Cascadia Code', Consolas, Menlo, monospace;
    --font-body: 'Saira', 'Segoe UI', system-ui, sans-serif;
  }
  body { margin: 0; background: var(--color-void); padding: 40px 20px; }
  .swb-page { max-width: 1100px; margin: 0 auto; }
  .swb-eyebrow { font-family: var(--font-mono); font-size: 0.62rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--color-teal); margin-bottom: 6px; }
  .swb-eyebrow::before { content: "// "; color: var(--color-amber); }
  .swb-title { font-family: var(--font-display); font-size: 1.3rem; letter-spacing: 0.04em; color: var(--color-white); margin: 0 0 4px; }
  .swb-tagline { font-family: var(--font-body); font-size: 0.78rem; color: var(--color-mid); margin: 0 0 20px; }
  .swb-colophon { font-family: var(--font-mono); font-size: 0.56rem; letter-spacing: 0.14em; color: var(--color-dim); margin-top: 18px; }
  .swb-colophon a { color: var(--color-bright); text-decoration: none; }
  @media (max-width: 768px) { body { padding: 20px 10px; } }
</style>
</head>
<body>
  <div class="swb-page">
    <div class="swb-eyebrow">Subnet Workbench</div>
    <h1 class="swb-title">Visual IPv4 planning</h1>
    <p class="swb-tagline">Calculate &middot; Overlap &middot; VLSM &middot; Vendor Syntax &mdash; offline standalone build</p>
    <div id="subnet-workbench"></div>
    <div class="swb-colophon">Kasey Kubiak &middot; kaseykubiak.com/tools/subnet-workbench &middot; single-file build, works offline</div>
  </div>
<script>
${js}</script>
</body>
</html>
`;

await mkdir(join(root, "dist"), { recursive: true });
const out = join(root, "dist", "subnet-workbench.html");
await writeFile(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)}kb)`);
