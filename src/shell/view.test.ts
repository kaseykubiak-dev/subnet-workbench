import { describe, expect, it } from "vitest";

import {
  SHELL_CSS,
  handoffLine,
  renderFooter,
  renderInputPanel,
  renderOutput,
  renderShell,
  renderTabs,
} from "./view";
import { initialState } from "./state";
import type { ShellState } from "./state";
import { ipToNumber } from "../engine/ipv4";

function withState(overrides: Partial<ShellState>): ShellState {
  return { ...initialState, ...overrides };
}

function ip(s: string): number {
  const n = ipToNumber(s);
  if (n === null) throw new Error(`bad fixture ip: ${s}`);
  return n;
}

describe("handoffLine", () => {
  it("keeps the label when present", () => {
    expect(
      handoffLine({
        raw: "Site A: 10.0.0.5/24",
        label: "Site A",
        address: ip("10.0.0.5"),
        network: ip("10.0.0.0"),
        prefix: 24,
        lineNumber: 1,
      })
    ).toBe("Site A: 10.0.0.0/24");
  });

  it("emits bare CIDR without a label", () => {
    expect(
      handoffLine({
        raw: "10.0.0.0/24",
        address: ip("10.0.0.0"),
        network: ip("10.0.0.0"),
        prefix: 24,
        lineNumber: 1,
      })
    ).toBe("10.0.0.0/24");
  });
});

describe("renderTabs", () => {
  it("renders all four modes with exactly one active", () => {
    const html = renderTabs(withState({ mode: "vlsm" }));
    expect(html.match(/data-action="set-mode"/g)).toHaveLength(4);
    expect(html.match(/swb-active/g)).toHaveLength(1);
    expect(html).toContain('data-mode="vlsm"');
    expect(html).toContain("Vendor Syntax");
  });
});

describe("renderInputPanel", () => {
  it("calculate: exposes the field and a clear button", () => {
    const html = renderInputPanel(withState({ calculateInput: "10.0.0.0/24" }));
    expect(html).toContain('data-field="calculateInput"');
    expect(html).toContain(">10.0.0.0/24</textarea>");
    expect(html).toContain('data-action="clear-mode"');
  });

  it("vlsm: supernet, requirements, and headroom fields", () => {
    const html = renderInputPanel(withState({ mode: "vlsm", vlsmHeadroom: 30 }));
    expect(html).toContain('data-field="vlsmSupernetInput"');
    expect(html).toContain('data-field="vlsmRequirementsInput"');
    expect(html).toContain('data-field="vlsmHeadroom"');
    expect(html).toContain('value="30"');
  });

  it("vendor: select marks the active vendor", () => {
    const html = renderInputPanel(withState({ mode: "vendor", vendorId: "pfsense" }));
    expect(html).toContain('data-field="vendorId"');
    expect(html).toContain('value="pfsense" selected');
    expect(html).not.toContain('value="fortios" selected');
  });

  it("escapes hostile textarea content", () => {
    const html = renderInputPanel(
      withState({ overlapInput: "<script>alert(1)</script>", mode: "overlap" })
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderOutput / calculate", () => {
  it("shows a schematic hint when empty", () => {
    const html = renderOutput(initialState);
    expect(html).toContain("swb-hint");
    expect(html).toContain("<svg");
    expect(html).not.toContain("data-visual");
  });

  it("renders ribbon, split slider, text, and hand-off buttons", () => {
    const html = renderOutput(withState({ calculateInput: "Lab: 192.168.1.10/26" }));
    expect(html).toContain('data-visual="bit-ribbon"');
    expect(html).toContain('data-field="splitTarget"');
    expect(html).toContain('min="26"');
    expect(html).toContain('id="swb-split-val"');
    expect(html).toContain('id="swb-split-visual"');
    expect(html).toContain('data-action="handoff-overlap"');
    expect(html).toContain('data-line="Lab: 192.168.1.0/26"');
    // VLSM hand-off strips the label: supernets are bare CIDR
    expect(html).toContain('data-action="handoff-vlsm" data-line="192.168.1.0/26"');
    expect(html).toContain('data-action="handoff-vendor"');
  });

  it("disables the slider at /32", () => {
    const html = renderOutput(withState({ calculateInput: "10.0.0.1/32" }));
    expect(html).toMatch(/data-field="splitTarget"[^>]*disabled/);
  });

  it("surfaces parse errors alongside good lines", () => {
    const html = renderOutput(withState({ calculateInput: "banana\n10.0.0.0/24" }));
    expect(html).toContain("swb-error");
    expect(html).toContain('data-visual="bit-ribbon"');
  });
});

describe("renderOutput / overlap", () => {
  it("shows a hint when empty", () => {
    const html = renderOutput(withState({ mode: "overlap" }));
    expect(html).toContain("swb-hint");
  });

  it("renders the space map and the vendor hand-off", () => {
    const html = renderOutput(
      withState({ mode: "overlap", overlapInput: "A: 10.0.0.0/16\nB: 10.0.32.0/20" })
    );
    expect(html).toContain('data-visual="space-map"');
    expect(html).toContain('data-action="overlap-to-vendor"');
  });
});

describe("renderOutput / vlsm", () => {
  it("merges supernet and requirement errors into one block", () => {
    const html = renderOutput(
      withState({
        mode: "vlsm",
        vlsmSupernetInput: "banana",
        vlsmRequirementsInput: "Sales, pear hosts",
      })
    );
    const errorCount = html.match(/class="swb-error"/g);
    expect(errorCount).toHaveLength(2);
    expect(html).toContain("swb-hint");
  });

  it("renders the ledger and the vendor hand-off when allocations exist", () => {
    const html = renderOutput(
      withState({
        mode: "vlsm",
        vlsmSupernetInput: "10.0.0.0/24",
        vlsmRequirementsInput: "Engineering, 100",
      })
    );
    expect(html).toContain("swb-ledger");
    expect(html).toContain('data-action="vlsm-to-vendor"');
  });

  it("shows one hint, not two empty messages, with supernet but no requirements", () => {
    const html = renderOutput(
      withState({ mode: "vlsm", vlsmSupernetInput: "10.0.0.0/16" })
    );
    expect(html).toContain("swb-hint");
    expect(html).toContain("Waiting on requirements");
    expect(html).not.toContain("Nothing to allocate");
    expect(html).not.toContain("swb-ledger");
  });

  it("omits the hand-off when nothing was allocated", () => {
    const html = renderOutput(
      withState({
        mode: "vlsm",
        vlsmSupernetInput: "10.0.0.0/30",
        vlsmRequirementsInput: "Huge, 5000",
      })
    );
    expect(html).not.toContain('data-action="vlsm-to-vendor"');
  });
});

describe("renderOutput / vendor", () => {
  it("shows a hint when empty", () => {
    const html = renderOutput(withState({ mode: "vendor" }));
    expect(html).toContain("swb-hint");
  });

  it("renders code blocks with matching copy targets", () => {
    const html = renderOutput(withState({ mode: "vendor", vendorInput: "10.0.0.0/26" }));
    expect(html).toContain('data-action="copy-block"');
    expect(html).toContain('data-copy-target="swb-code-0-0"');
    expect(html).toContain('id="swb-code-0-0"');
  });

  it("gives every subnet its own section head", () => {
    const html = renderOutput(
      withState({ mode: "vendor", vendorInput: "A: 10.0.0.0/26\nB: 10.1.0.0/26" })
    );
    expect(html.match(/swb-subhead/g)).toHaveLength(2);
    expect(html).toContain('id="swb-code-1-0"');
  });

  it("escapes hostile labels in section heads", () => {
    const html = renderOutput(
      withState({ mode: "vendor", vendorInput: "<img onerror=x>: 10.0.0.0/26" })
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("renderFooter", () => {
  it("pluralizes the held count", () => {
    expect(renderFooter(initialState)).toContain("0 SUBNETS HELD");
    expect(renderFooter(withState({ overlapInput: "10.0.0.0/24" }))).toContain(
      "1 SUBNET HELD"
    );
  });

  it("names the mode and offers the share button", () => {
    const html = renderFooter(withState({ mode: "overlap" }));
    expect(html).toContain("OVERLAP");
    expect(html).toContain('data-action="copy-share"');
  });
});

describe("renderShell", () => {
  it("emits all four region ids", () => {
    const html = renderShell(initialState);
    for (const id of ["swb-tabs", "swb-input", "swb-output", "swb-footer"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("frames the app with four corner brackets", () => {
    const html = renderShell(initialState);
    expect(html.match(/swb-corner/g)).toHaveLength(4);
    for (const c of ["swb-c-tl", "swb-c-tr", "swb-c-bl", "swb-c-br"]) {
      expect(html).toContain(c);
    }
  });
});

describe("SHELL_CSS", () => {
  it("bundles the ledger styles and uses variable fallbacks", () => {
    expect(SHELL_CSS).toContain(".swb-ledger");
    expect(SHELL_CSS).toContain("var(--color-teal, #00ffcc)");
    expect(SHELL_CSS).not.toContain("rgba(var(");
  });
});
