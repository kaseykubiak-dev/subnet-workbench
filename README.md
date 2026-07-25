# Subnet Workbench

A visual-first IPv4 planning tool. Paste in the subnets you're actually working with, and get back a bit-level breakdown, a conflict report, a VLSM allocation plan, or vendor-ready config text.

Most subnet calculators answer one question at a time and answer it in a table. This one is built around the questions that come up in real work: does this new block collide with anything already deployed, how do I carve a /22 into the six VLANs I was handed, and what does that look like in FortiOS. Every mode renders an SVG diagram alongside the text, because the bit boundary is the thing people get wrong and a table doesn't show it.

Live at [kaseykubiak.com/resources/subnet-workbench](https://kaseykubiak.com/resources/subnet-workbench).

## The four modes

**Calculate** takes a single subnet and derives the network address, broadcast, usable range, mask, wildcard mask, and host count. The bit ribbon shows where the prefix boundary actually falls, and a split slider previews what the block looks like carved into any smaller prefix. /31 and /32 are handled per RFC 3021 rather than being reported as having zero usable hosts.

**Overlap** compares every subnet in a pasted list against every other one and classifies each conflict as identical, containment, or partial. Results are sorted worst-first with both labels, both subnets, and the actual overlapping range. The all-clear state says "No conflicts across N subnets" explicitly, since that's usually the answer you're hoping for and it shouldn't look like an empty results table.

**VLSM** takes one supernet plus a list of requirements (label, host count) and returns an allocation plan. Sizing is largest-first from the bottom of the supernet upward, with an optional headroom percentage applied to every request. When something doesn't fit, the shortfall is explicit: each unfit requirement names the prefix it needs, and the summary names the supernet prefix the whole set would have required. The ledger separates allocated space from stranded space (usable addresses inside a block beyond what was requested, the cost of power-of-two rounding) from free space.

**Vendor Syntax** renders any subnet as config text for FortiOS, Cisco IOS, or pfSense: interface config, static route, address object, and policy. Things the tool can't know (interface names, next hops) are left as `<angle>` placeholders rather than guessed at. Cisco IOS carries the wildcard-mask conversion, which is the most-fumbled thing in this space.

## Input format

Line-based, one subnet per line, with several notations accepted interchangeably:

```
10.0.0.0/24                    CIDR
10.0.0.0 255.255.255.0         mask notation (FortiGate style)
10.0.0.0/255.255.255.0         slash-mask hybrid seen in configs
Site A: 10.0.0.0/24            leading label (colon required)
10.0.0.0/24 Site A             trailing label
```

Bad lines get a per-line error and the run proceeds, so one typo in a fifty-line paste doesn't wipe out the whole result. Blank lines and comments (`#` or `//`) are skipped.

Share links are opt-in. State is encoded as base64url JSON in the URL fragment only when you click the share button, never synced live to the address bar, because these payloads contain customer addressing and nobody wants that landing in browser history by accident.

## Architecture

The core is framework-agnostic TypeScript with no runtime dependencies. Everything under `src/engine`, `src/modes`, `src/vendor`, and `src/visuals` is pure functions: state in, markup strings out. Nothing touches the DOM directly and nothing imports React.

That's deliberate, because the same code runs in three places. `src/shell` wraps it in a vanilla-JS app for local development, `scripts/build-standalone.mjs` bakes it into a single offline HTML file, and `scripts/sync-to-site.mjs` copies it into the Next.js site as a vendored library.

```
src/engine     IPv4 math and the input parser
src/modes      Calculate, Overlap, VLSM (text output)
src/vendor     Config templates (pure data) and the renderer
src/visuals    SVG diagram renderers, shared color and font tokens
src/shell      State, view, share encoding, DOM wiring
```

Colors are emitted as `var(--color-x, #fallback)` so the visuals inherit the site's Light Tennessee palette when those CSS variables exist and still render correctly standalone.

## Relationship to kaseykubiak.com

**This repo is the source of truth.** The site's copy at `Personal-Website/kasey-kubiak/src/lib/subnet-workbench/` is generated, and `scripts/sync-to-site.mjs` deletes the target directory before regenerating it.

That means any change made on the site side alone will be silently reverted the next time the sync runs. Fix things here and re-sync; don't patch the vendored copy. `src/shell/view.test.ts` includes a regression test asserting the retired dark-theme hex values are absent from `SHELL_CSS`, since a palette drift there is exactly the kind of thing that would quietly revert production.

## Development

Requires Node 20 or newer (developed on 24.x).

```bash
npm install
npm test              # vitest run, 230 tests across 14 files
npm run typecheck     # tsc --noEmit
npm run build:web     # bundle src/shell/main.ts to dist/app.js
npm run build:standalone
npm run sync:site
```

Open `index.html` directly for the dev harness after `npm run build:web`. It carries the same design tokens as the live site, so what you see there is what ships.

`npm run build:standalone` produces `dist/subnet-workbench.html`, a single file with the fonts base64-embedded and zero network requests. It works offline, which is the point: it can go on a laptop that's plugged into a customer network with no internet.

`npm run sync:site` accepts an optional target path as its first argument if the site repo isn't a sibling directory.

## Testing

Tests live next to the code they cover. The engine and mode tests are the ones that matter most, since a wrong broadcast address is a real outage and a wrong allocation plan wastes a day. Visual tests assert on rendered markup (block coordinates, label escaping, percentage widths) rather than screenshots, which keeps them fast and meaningful.
