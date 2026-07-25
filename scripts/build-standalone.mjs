/**
 * Step 9: standalone single-file HTML build.
 *
 * Bundles src/shell/main.ts with esbuild and inlines the result into one
 * HTML file with zero external requests: no font links, no script tags
 * pointing anywhere, no CDN. The site typography (Chakra Petch, IBM Plex
 * Mono, Saira — latin subsets vendored in src/fonts/, same set as the
 * FortiGate CLI reference standalone) is embedded as base64 @font-face
 * rules, so the offline build matches the site exactly.
 * Output: dist/subnet-workbench.html.
 */

import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Fonts embedded into the standalone (kaseykubiak.com typography, latin subsets).
const FONTS = [
  { file: "chakra-petch-latin-600-normal.woff2", family: "Chakra Petch", weight: 600 },
  { file: "chakra-petch-latin-700-normal.woff2", family: "Chakra Petch", weight: 700 },
  { file: "ibm-plex-mono-latin-400-normal.woff2", family: "IBM Plex Mono", weight: 400 },
  { file: "ibm-plex-mono-latin-600-normal.woff2", family: "IBM Plex Mono", weight: 600 },
  { file: "saira-latin-300-normal.woff2", family: "Saira", weight: 300 },
  { file: "saira-latin-400-normal.woff2", family: "Saira", weight: 400 },
  { file: "saira-latin-600-normal.woff2", family: "Saira", weight: 600 },
];

let fontCss = "";
for (const f of FONTS) {
  const buf = await readFile(join(root, "src", "fonts", f.file));
  fontCss +=
    `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;` +
    `src:url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2');}\n`;
}

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
${fontCss}  /* Light Tennessee palette (Direction E), mirrored from the site's
     globals.css :root so the offline build matches kaseykubiak.com token
     for token. Site fonts are embedded above as base64: this file makes
     zero network requests by design. */
  :root {
    /* Tennessee core */
    --color-orange: #ff8200; --color-orange-deep: #e07200;
    --color-smokey: #4b4b4b; --color-smokey-light: #6e6e6e;
    --color-ink: #2a2a2a; --color-line: #e4e1dc; --color-text-inverse: #ffffff;
    /* Backgrounds */
    --color-void: #ffffff; --color-deep: #f7f6f4; --color-panel: #f1efec; --color-warm: #e9e6e1;
    /* Legacy aliases, so older selectors resolve exactly as they do on the site */
    --color-blue: var(--color-orange); --color-glow: var(--color-orange-deep);
    --color-bright: var(--color-ink); --color-ice: var(--color-smokey-light);
    --color-teal: var(--color-orange); --color-amber: var(--color-orange-deep);
    --color-white: var(--color-ink); --color-mid: var(--color-smokey); --color-dim: #9a9a9a;
    --bord: var(--color-line); --bord-teal: rgba(255,130,0,0.45); --bord-subtle: rgba(75,75,75,0.12);
    /* Tool chrome */
    --tool-cmd-bg: #161310; --tool-cmd-text: #f4ede3;
    --tool-bord-strong: rgba(255,130,0,0.5); --tool-accent-dim: rgba(224,114,0,0.75);
    --tool-row-hover: rgba(255,130,0,0.06); --tool-row-sel: rgba(255,130,0,0.1);
    --tool-danger: #d64550; --tool-danger-bg: rgba(214,69,80,0.08); --tool-warn-bg: rgba(224,114,0,0.08);
    --tool-rail: linear-gradient(90deg, transparent, var(--color-orange) 20%, var(--color-orange-deep) 80%, transparent);
    --font-display: 'Chakra Petch', 'Segoe UI', system-ui, sans-serif;
    --font-mono: 'IBM Plex Mono', 'Cascadia Code', Consolas, Menlo, monospace;
    --font-body: 'Saira', 'Segoe UI', system-ui, sans-serif;
  }
  body { margin: 0; background: var(--color-void); padding: 40px 20px; }
  .swb-page { max-width: 1500px; margin: 0 auto; }
  .swb-eyebrow { font-family: var(--font-mono); font-size: 0.62rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--color-orange-deep); margin-bottom: 6px; }
  .swb-eyebrow::before { content: "// "; color: var(--color-orange); }
  .swb-title { font-family: var(--font-display); font-size: 1.3rem; letter-spacing: 0.04em; color: var(--color-ink); margin: 0 0 4px; }
  .swb-tagline { font-family: var(--font-body); font-size: 0.78rem; color: var(--color-smokey); margin: 0 0 20px; }
  .swb-colophon { font-family: var(--font-mono); font-size: 0.56rem; letter-spacing: 0.14em; color: var(--color-smokey-light); margin-top: 18px; }
  .swb-colophon a { color: var(--color-orange-deep); text-decoration: none; }
  @media (max-width: 768px) { body { padding: 20px 10px; } }
</style>
</head>
<body>
  <div class="swb-page">
    <div class="swb-eyebrow">Subnet Workbench</div>
    <h1 class="swb-title">Visual IPv4 planning</h1>
    <p class="swb-tagline">Calculate &middot; Overlap &middot; VLSM &middot; Vendor Syntax &mdash; offline standalone build</p>
    <div id="subnet-workbench"></div>
    <div class="swb-colophon">Kasey Kubiak &middot; kaseykubiak.com/resources/subnet-workbench &middot; single-file build, works offline</div>
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
