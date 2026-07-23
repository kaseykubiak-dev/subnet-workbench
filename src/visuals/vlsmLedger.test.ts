import { describe, expect, it } from "vitest";

import { parseSubnetLine, type ParsedSubnet } from "../engine/parse";
import { allocateVlsm, parseRequirementList } from "../modes/vlsm";
import { VLSM_LEDGER_CSS, renderVlsmLedger } from "./vlsmLedger";

const supernet = (line: string): ParsedSubnet => {
  const r = parseSubnetLine(line);
  if ("message" in r) throw new Error(`bad test supernet: ${r.message}`);
  return r;
};

const run = (net: string, reqText: string) =>
  allocateVlsm(supernet(net), parseRequirementList(reqText).requirements, {});

describe("renderVlsmLedger", () => {
  const html = renderVlsmLedger(run("10.0.0.0/24", "Eng, 100\nSales, 50"));

  it("renders one proportional card per allocation", () => {
    expect(html).toContain(`data-block="10.0.0.0/25"`);
    expect(html).toContain(`data-block="10.0.0.128/26"`);
    expect(html).toContain(`style="flex-grow:128"`);
    expect(html).toContain(`style="flex-grow:64"`);
  });

  it("shows requirement labels and per-card capacity", () => {
    expect(html).toContain(">Eng</div>");
    expect(html).toContain(">Sales</div>");
    expect(html).toContain("100 of 126 hosts");
    expect(html).toContain("50 of 62 hosts");
  });

  it("draws the utilization bar as a percentage width", () => {
    expect(html).toContain(`width:79%`); // Eng: 100/126
    expect(html).toContain(`width:81%`); // Sales: 50/62
  });

  it("renders the trailing free-space card", () => {
    expect(html).toContain(`data-block="free"`);
    expect(html).toContain("from 10.0.0.192");
    expect(html).toContain("64 addresses");
  });

  it("closes with the waste ledger line", () => {
    expect(html).toContain("Allocated 192 of 256 addresses");
    expect(html).toContain("free 64 addresses");
  });

  it("omits the free card on an exact fit", () => {
    const packed = renderVlsmLedger(run("10.0.0.0/24", "A, 100\nB, 100"));
    expect(packed).not.toContain(`data-block="free"`);
  });

  it("renders unallocated requirements as amber rows", () => {
    const short = renderVlsmLedger(run("10.0.0.0/25", "Big, 100\nHuge, 100"));
    expect(short).toContain(`data-role="unallocated"`);
    expect(short).toContain("needs a /25");
  });

  it("notes /31 and /32 assignments on the card", () => {
    const p2p = renderVlsmLedger(run("10.0.0.0/29", "Link, 2"));
    expect(p2p).toContain("RFC 3021");
  });

  it("renders the empty state", () => {
    const empty = renderVlsmLedger(run("10.0.0.0/24", ""));
    expect(empty).toContain("swb-ledger-empty");
  });

  it("escapes user labels", () => {
    const evil = renderVlsmLedger(run("10.0.0.0/24", "Eng & Dev <x>, 50"));
    expect(evil).toContain("Eng &amp; Dev &lt;x&gt;");
    expect(evil).not.toContain("<x>");
  });

  it("caps utilization at 100 percent", () => {
    expect(html).not.toMatch(/width:1[0-9]{2,}%/);
  });
});

describe("VLSM_LEDGER_CSS", () => {
  it("styles the ledger classes with brand variables", () => {
    expect(VLSM_LEDGER_CSS).toContain(".swb-ledger");
    expect(VLSM_LEDGER_CSS).toContain("--color-teal");
    expect(VLSM_LEDGER_CSS).toContain(".swb-unallocated");
  });
});
