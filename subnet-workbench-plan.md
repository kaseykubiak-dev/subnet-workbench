# Subnet Workbench — v1 Plan

> Name confirmed 2026-07-22. See Open Questions (all four resolved).

## Goal

Build a visual-first IPv4 network planning tool for kaseykubiak.com that makes subnetting legible — solving real planning problems (overlap detection, VLSM allocation, vendor config output) rather than re-implementing the commodity subnet calculator.

## Context

Kasey Kubiak is a Network Support Engineer working daily in multi-vendor managed services (FortiGate, Cisco, Meraki). This is the follow-on project to the FortiGate CLI Reference Tool and reuses its architecture: a page in the existing Next.js site, static client-side data, no backend, plus a self-contained single-file HTML build for offline and distributable use.

The differentiator is deliberate. A plain subnet calculator is the most saturated tool category in networking and demonstrates nothing. This tool is scoped instead around the problems that are genuinely underserved — overlap detection across a list of sites, VLSM planning with waste visibility, and multi-vendor syntax output — with single-subnet calculation included as a mode that falls out of the same engine for free.

Visual-first is the core identity, not decoration. Every mode has a hero visual. There is no deadline pressure on this project.

## Process Overview

1. Build and unit-test the IPv4 math engine with no UI at all
2. Build the forgiving input parser
3. Build Calculate mode (text output first)
4. Build Overlap mode (text output first)
5. Build VLSM mode (text output first)
6. Build the vendor syntax template layer
7. Layer the four hero visuals onto proven, settled data
8. Build the page shell — mode tabs, hand-off between modes, shareable link
9. Build the standalone single-file HTML export
10. Write the portfolio case study page

## Detailed Steps

### Step 1: IPv4 math engine

**What happens:** Pure logic module. Addresses represented internally as a numeric type; parsing and formatting live strictly at the edges. Core operations: address ↔ number conversion, network/broadcast derivation, usable range, mask ↔ prefix ↔ wildcard conversion, host counts, containment and intersection tests.

**Input:** Nothing. This step has no dependencies.

**Output:** A tested module with no UI and no rendering.

**Decisions:** Numeric representation is non-negotiable — no repeated string manipulation on dotted quads. This is what keeps a future IPv6 change bounded (swap to BigInt, write new formatters) rather than a rewrite. This is *not* a request to build an IPv6 abstraction layer now; it is a data-type choice that is correct for IPv4 on its own merits.

**Notes:** Ship this before any rendering exists. If the visuals are built against unproven math, every arithmetic bug will present as a rendering bug and get debugged through an SVG layer. Ugly-but-correct for a week is the right trade.

### Step 2: Input parser

**What happens:** Forgiving line-based parser, one subnet per line, accepting these forms interchangeably:

- `10.0.0.0/24` — CIDR
- `10.0.0.0 255.255.255.0` — mask notation, as FortiGate presents it
- `10.0.0.0/255.255.255.0` — the slash-mask hybrid seen in configs
- `Site A: 10.0.0.0/24` or `10.0.0.0/24 Site A` — optional label, either side

**Input:** Raw pasted text.

**Output:** Normalized subnet objects with optional labels, plus a list of per-line parse errors.

**Decisions:** Bad lines are flagged inline and the rest of the run proceeds. One typo in a fifty-line paste must never wipe out the whole result.

**Notes:** Labels are optional but should be prominent in the UI. "These two overlap" is a far weaker output than "Knoxville branch overlaps Nashville DC" — the labeled version is the one that settles an argument on a bridge call.

### Step 3: Calculate mode

**What happens:** Single subnet in, full derivation out: network, broadcast, first/last usable, host count, mask, wildcard mask, prefix.

**Input:** One parsed subnet.

**Output:** A result object.

**Decisions:** `/31` and `/32` are handled explicitly and correctly. A `/31` has no broadcast address and two usable addresses per RFC 3021; a `/32` is a host route. Both are routine in this environment — tunnel interfaces, loopbacks, point-to-point links. Reporting "0 usable hosts" is wrong and would immediately discredit the tool with its target audience.

**Notes:** This is the default landing mode. Lowest-commitment entry point, and its bit-boundary visual is the best advertisement for everything else on the page.

### Step 4: Overlap mode

**What happens:** Pairwise comparison across a list of subnets, with each conflict classified into one of three relationships:

- **Identical** — the same subnet twice. Usually copy-paste error, or two sites genuinely built the same.
- **Containment** — one fully inside the other. Often intentional (summary route, supernet). Warning, not error.
- **Partial overlap** — they intersect but neither contains the other. Almost always a real bug. Flagged loudest.

**Input:** A parsed list of labeled subnets.

**Output:** Conflict rows showing both labels, both subnets, the relationship type, and the actual overlapping range. Sorted worst-first.

**Decisions:** The all-clear state must be unmistakable — "no conflicts across 23 subnets." That is frequently the answer the user is hoping for and it should not look like an empty results table.

**Notes:** This is the headline feature and the most underserved problem in the category. Overlapping addressing across sites is one of the most common reasons IPsec tunnels and SD-WAN overlays break.

### Step 5: VLSM mode

**What happens:** Supernet plus a list of requirements (label, host count) in; allocation plan out.

**Input:** One supernet and a requirement list, e.g. `Knoxville branch, 200 hosts`.

**Output:** Allocation table (label, assigned subnet, usable range, actual vs requested capacity), plus an explicit waste summary — allocated, stranded by rounding, and free.

**Decisions:**
- Allocation strategy is largest-first: sort requirements descending, round each up to the next power of two, allocate from the top of the block down. Standard, minimizes fragmentation, needs nothing clever. Not user-tunable.
- A growth headroom setting (global percentage or multiplier) inflates each requirement before fitting. Roughly four lines of code, and it is the difference between a packing algorithm and a planning tool — nobody sizes a site for exactly today's host count.
- On failure, state the shortfall explicitly — "needs a /21, you gave it a /22" — never silently truncate.

**Explicitly out of scope for v1:** multiple or discontiguous supernets · manual prefix override per requirement · reserved or excluded ranges inside the supernet · hierarchical allocation (regions containing sites containing VLANs) · drag-to-reorder or manual reassignment.

**Notes:** This is the scope risk in the project. Each excluded item is individually reasonable and collectively they are a six-month build. Hierarchical allocation is the most tempting and the most expensive — it doubles the data model. Manual prefix override ("this site must be a /24 regardless of host count") is the most defensible real-world omission and the likeliest v2 addition.

### Step 6: Vendor syntax layer

**What happens:** A template layer, not a feature. Any subnet the tool produces — from any mode — can be rendered as config text, driven by a small template data file.

**Input:** Any result subnet.

**Output:** Config text with a copy button.

**Decisions:**
- Platforms: **FortiOS, Cisco IOS, pfSense.** FortiOS is the daily-work platform and the CLI Reference Tool's audience. Cisco IOS carries the wildcard mask conversion, the single most-fumbled thing in this space. pfSense rounds out the multi-vendor story and matches the home lab.
- **Meraki is excluded**, deliberately. It has essentially no config CLI for this; including it would mean printing dashboard field values, which is not syntax and would read as padding.
- Output types: interface address assignment · static route · firewall/network address object · ACL or policy entry.

**Notes:** Because this is template-driven, swapping pfSense for Palo Alto later is a data-file edit, not a refactor — both could ship with a picker. Adding any vendor is a data change, never a code change. Same architecture instinct as the CLI Reference Tool dataset.

### Step 7: The four hero visuals

**What happens:** Visuals are layered onto settled, proven data — one per mode.

- **Bit boundary view** (Calculate) — all 32 bits laid out, network and host portions in different colors, the prefix boundary drawn through them. The single image that makes subnetting click. Must render the `/31` and `/32` degenerate cases honestly rather than hiding them.
- **Interactive prefix slider** (Calculate) — drag /24 → /25 → /26 and watch the space split live. The "oh, *that's* what a mask does" moment. No known competitor does this.
- **Address-space map** (Overlap) — subnets positioned along the space with collisions highlighted.
- **Allocation diagram** (VLSM) — the supernet as a block carved into child allocations, with stranded space shown explicitly.

**Input:** Verified output from Steps 3–5.

**Output:** SVG rendering.

**Decisions:** Address-space map scaling needs solving on paper before it is coded. A linear scale renders a /30 as a subpixel when a /8 is in the same list. **Recommended approach: group subnets by nearest common parent, render each group as its own row scaled to that group, with a zoom-to-range control.** This is preferred over a log scale, which makes visual area meaningless and reads as arbitrary. Grouping also mirrors how people actually think about their space — per-site blocks.

**Notes:** Visuals are v1 core, but they are not v1 first. See Step 1.

**Treatments chosen 2026-07-22** (from `mockups/hero-visuals-mockups.html`, kept for revisiting):
- Bit boundary view → **1A Ribbon**: one 32-bit row with octet gaps, amber boundary line
- Prefix slider → **2A Splitting Bar**: slider over a single address bar, dashed ghost lines for the next split
- Address-space map → **3B Spans**: one thin row per subnet under group headers, amber hatch band through conflict columns
- VLSM diagram → **4B Block Ledger**: proportional flex cards with per-card utilization bars and a waste ledger

### Step 8: Page shell

**What happens:** Single page with four visible mode tabs — Calculate / Overlap / VLSM / Vendor Syntax. Not a dropdown: visible options double as a statement of what the tool can do, the same reasoning applied to the CLI Reference Tool's category filter.

**Input:** Steps 3–7.

**Output:** The working site page.

**Decisions:**
- Calculate is the default mode.
- **Hand-off between modes is what makes this a toolkit rather than four calculators.** A calculated subnet can be pushed into the overlap list; a VLSM allocation can be rendered as vendor syntax in one click. Without hand-off, this is four tools sharing a URL.
- Shareable links are **opt-in only** — an explicit "copy shareable link" button, never live URL sync as you type. The deliberate action is the safeguard.

**Notes:** The shareable-link restraint is a real concern, not a theoretical one. That link contains customer addressing, and once encoded it propagates into ticket systems, chat logs, and browser history whether or not anyone intended it. This also partly justifies the offline standalone build.

**Shell treatment chosen 2026-07-22** (from `mockups/page-shell-mockups.html`, kept for revisiting): **Variant A "Command Deck"**, taken whole. Nav-style parallelogram tabs across the top; two-column workspace (input pinned left, visual + results right); hand-off as a button row under the results; opt-in "Copy shareable link" in a persistent footer status bar alongside mode/held-subnet status.

### Step 9: Standalone single-file HTML build

**What happens:** Generated from the same source at build time — offline, zero-dependency, distributable, no external requests.

**Input:** The completed tool.

**Output:** One HTML file that can be handed to a colleague.

**Decisions:** **Full feature parity, including the interactive visuals.** The tool is entirely client-side JS and SVG already, so single-file packaging is a bundling concern rather than a capability one. A reduced text-only fallback would create two diverging codebases and would strip the visuals precisely when someone needs them most — working offline, on a customer site, without the web app available.

**Notes:** Directly mirrors the CLI Reference Tool's standalone approach.

### Step 10: Portfolio case study

**What happens:** A case study page on kaseykubiak.com covering the problem, the reasoning behind the scope decisions, and the visuals.

**Notes:** The interesting story here is not the subnet math — it is the decision to build a planning tool instead of another calculator, and the visual-first approach to a category that has always been text tables.

## Edge Cases and Failure Modes

- **`/31` and `/32`** — handled explicitly per RFC 3021; never report "0 usable hosts"
- **Malformed input lines** — flagged inline, run proceeds with valid lines
- **Mixed prefix sizes in the address-space map** — resolved by grouping under nearest common parent
- **VLSM requirements exceeding the supernet** — explicit shortfall message naming the prefix actually needed
- **Empty or single-entry overlap list** — clear, non-error empty state
- **Very large paste lists** — pairwise comparison is O(n²); fine at realistic sizes, but confirm behavior in the thousands before shipping
- **Private vs public address ranges** — consider an RFC 1918 indicator; cheap, and useful context in results
- **Customer data leakage via shareable links** — mitigated by opt-in-only encoding

## Dependencies and Requirements

- Existing Next.js site and V6A Hybrid design system (Chakra Petch, IBM Plex Mono, Saira; teal/cyan on void)
- Existing static-data / client-side-only pattern from the CLI Reference Tool
- Existing single-file HTML build tooling from the CLI Reference Tool
- Unit test setup for the math engine — the one genuinely new requirement
- Stable ID scheme in the CLI Reference Tool dataset, *only if* the cross-link is pursued

## Open Questions

**RESOLVED 2026-07-22: Kasey confirmed all four recommendations as written.** Name is "Subnet Workbench"; address-space map uses group-by-nearest-common-parent with zoom; standalone build has full parity including interactive visuals; CLIFS cross-link stays in scope, built last, dropped if it adds friction.

Four calls were made during plan write-up rather than confirmed in the interview. Each was a recommendation; all four are now confirmed decisions.

1. **Naming.** "Subnet Workbench" is the recommendation: "workbench" conveys a multi-tool for working engineers rather than a toy calculator, while "subnet" preserves discoverability. Alternates: "Subnet Studio," "Address Space." Following the CLI Reference Tool precedent, carrying a descriptive placeholder and naming it later is also perfectly valid.
2. **Address-space map scaling** — group-by-nearest-common-parent with zoom, over log scale. See Step 7.
3. **Standalone build parity** — full parity including interactive visuals. See Step 9.
4. **CLI Reference Tool cross-link** — in scope but built last, only if a stable ID scheme falls out naturally. Clicking an emitted FortiOS command would land on its reference entry. Two tools that feed each other reads as a deliberate toolkit rather than a pile of weekend projects. Drop entirely if it adds friction.

## Success Criteria

- A network engineer can paste a messy list of subnets from a real customer environment and get a correct, readable conflict report in under a minute
- The `/31` and `/32` cases are correct — the credibility test with the target audience
- Someone who does not understand subnetting can drag the prefix slider and come away understanding what a mask does
- The standalone file works with no network connection and can be handed to a colleague
- VLSM shipped without absorbing the whole project
- The case study is a stronger portfolio piece than "I built a subnet calculator" would have been
