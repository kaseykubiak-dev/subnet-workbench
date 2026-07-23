/**
 * Hero visual 4B "Block Ledger": the VLSM allocation diagram.
 *
 * A horizontal track of flex cards, one per allocation, each sized
 * proportionally to its block (flex-grow = blockSize) with a per-card
 * utilization bar (requested hosts vs block capacity). Free space renders
 * as a trailing dashed card; unallocated requirements render as amber rows
 * beneath the track; the waste ledger line closes the visual.
 *
 * Pure function: VlsmResult in, HTML string out. The stylesheet ships as
 * VLSM_LEDGER_CSS so the page shell and the standalone build can each embed
 * it once.
 */

import { numberToIp } from "../engine/ipv4";
import type { VlsmResult } from "../modes/vlsm";
import { allocationCidr, requirementName } from "../modes/vlsm";
import { esc } from "./svg";

const fmt = (n: number): string => n.toLocaleString("en-US");

/** Stylesheet for the ledger. Embed once wherever the ledger renders. */
export const VLSM_LEDGER_CSS = `
.swb-ledger { font-family: var(--font-mono, 'IBM Plex Mono', monospace); }
.swb-ledger-track { display: flex; gap: 4px; align-items: stretch; min-height: 84px; }
.swb-block {
  flex-basis: 0; min-width: 56px; padding: 8px 10px; overflow: hidden;
  background: rgba(0, 255, 204, 0.06);
  border: 1px solid var(--bord-teal, rgba(0, 255, 204, 0.36));
}
.swb-block-label {
  color: var(--color-white, #eef6ff); font-size: 0.7rem;
  letter-spacing: 0.08em; text-transform: uppercase;
  white-space: nowrap; text-overflow: ellipsis; overflow: hidden;
}
.swb-block-cidr { color: var(--color-teal, #00ffcc); font-size: 0.66rem; margin-top: 2px; white-space: nowrap; }
.swb-util { height: 4px; margin-top: 8px; background: rgba(102, 153, 204, 0.2); }
.swb-util-fill { height: 100%; background: var(--color-teal, #00ffcc); }
.swb-block-meta { color: var(--color-mid, #6699cc); font-size: 0.6rem; margin-top: 6px; white-space: nowrap; }
.swb-block.swb-free {
  background: transparent;
  border: 1px dashed var(--bord, rgba(77, 166, 255, 0.28));
}
.swb-free .swb-block-label { color: var(--color-dim, #4477aa); }
.swb-free .swb-block-cidr { color: var(--color-dim, #4477aa); }
.swb-unallocated {
  margin-top: 10px; padding: 6px 10px; font-size: 0.66rem;
  color: var(--color-amber, #ffaa00);
  border-left: 2px solid var(--color-amber, #ffaa00);
  background: rgba(255, 170, 0, 0.06);
}
.swb-ledger-summary { margin-top: 12px; font-size: 0.66rem; color: var(--color-mid, #6699cc); letter-spacing: 0.06em; }
.swb-ledger-empty { font-size: 0.7rem; color: var(--color-dim, #4477aa); }
`.trim();

/** Render the block ledger for a VLSM result. */
export function renderVlsmLedger(result: VlsmResult): string {
  if (result.status === "empty") {
    return `<div class="swb-ledger" data-visual="vlsm-ledger"><p class="swb-ledger-empty">${esc(
      result.summary
    )}</p></div>`;
  }

  const cards: string[] = [];
  for (const a of result.allocations) {
    const pct = Math.min(
      100,
      Math.round((a.inflatedHosts / Math.max(1, a.capacity)) * 100)
    );
    const name = requirementName(a.requirement);
    const meta =
      a.note !== undefined
        ? `${fmt(a.inflatedHosts)} of ${fmt(a.capacity)} · ${a.note}`
        : `${fmt(a.inflatedHosts)} of ${fmt(a.capacity)} hosts`;
    cards.push(
      `<div class="swb-block" style="flex-grow:${a.blockSize}" data-block="${esc(
        allocationCidr(a)
      )}">` +
        `<div class="swb-block-label">${esc(name)}</div>` +
        `<div class="swb-block-cidr">${esc(allocationCidr(a))}</div>` +
        `<div class="swb-util"><div class="swb-util-fill" style="width:${pct}%"></div></div>` +
        `<div class="swb-block-meta">${esc(meta)}</div>` +
        `</div>`
    );
  }

  // Trailing free-space card (skip when the supernet is packed exactly).
  const free = result.waste.freeAddresses;
  if (free > 0) {
    const freeStart = numberToIp(
      (result.supernet.network + result.waste.allocatedAddresses) >>> 0
    );
    cards.push(
      `<div class="swb-block swb-free" style="flex-grow:${free}" data-block="free">` +
        `<div class="swb-block-label">Free</div>` +
        `<div class="swb-block-cidr">from ${esc(freeStart)}</div>` +
        `<div class="swb-block-meta">${fmt(free)} addresses</div>` +
        `</div>`
    );
  }

  const rows: string[] = [
    `<div class="swb-ledger-track">${cards.join("")}</div>`,
  ];

  for (const u of result.unallocated) {
    rows.push(
      `<div class="swb-unallocated" data-role="unallocated">UNALLOCATED · ${esc(
        requirementName(u.requirement)
      )} needs a /${u.neededPrefix} (${fmt(u.inflatedHosts)} hosts)</div>`
    );
  }

  rows.push(
    `<div class="swb-ledger-summary">Allocated ${fmt(
      result.waste.allocatedAddresses
    )} of ${fmt(result.waste.supernetSize)} addresses · stranded ${fmt(
      result.waste.strandedHosts
    )} usable hosts · free ${fmt(free)} addresses</div>`
  );

  return `<div class="swb-ledger" data-visual="vlsm-ledger">${rows.join("")}</div>`;
}
