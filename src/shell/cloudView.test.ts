import { describe, expect, it } from "vitest";

import {
  CLOUD_CSS,
  renderCloudBlock,
  renderCloudFacts,
  renderPlatformSelect,
} from "./cloudView";
import { initialState } from "./state";
import type { ShellState } from "./state";
import { parseSubnetList } from "../engine/parse";
import type { ParsedSubnet } from "../engine/parse";

function withState(overrides: Partial<ShellState>): ShellState {
  return { ...initialState, ...overrides };
}

/** Parse one line into the subnet the view actually receives. */
function subnet(line: string): ParsedSubnet {
  const s = parseSubnetList(line).subnets[0];
  if (s === undefined) throw new Error(`bad fixture: ${line}`);
  return s;
}

describe("renderPlatformSelect", () => {
  it("offers every platform and marks the active one", () => {
    const html = renderPlatformSelect(withState({ platform: "azure" }));
    expect(html).toContain('data-field="platform"');
    expect(html.match(/<option /g)).toHaveLength(3);
    expect(html).toContain('value="azure" selected');
    expect(html).not.toContain('value="aws" selected');
    expect(html).not.toContain('value="none" selected');
  });

  it("renders at platform none, because it is the way into cloud mode", () => {
    const html = renderPlatformSelect(initialState);
    expect(html).toContain('value="none" selected');
  });
});

describe("renderCloudFacts", () => {
  it("renders nothing on-prem", () => {
    expect(renderCloudFacts(initialState)).toBe("");
  });

  it("leads with the reserved count and its breakdown on Azure", () => {
    const html = renderCloudFacts(withState({ platform: "azure" }));
    expect(html).toContain("Azure constraints");
    expect(html).toContain("Reserved per subnet");
    expect(html).toContain("Azure DNS");
    // Azure's smallest legal subnet is /29, which leaves 3 usable.
    expect(html).toContain("/2 to /29");
    expect(html).toContain("3 usable at the small end");
  });

  it("says immutable for AWS, which is the expensive thing to learn late", () => {
    const html = renderCloudFacts(withState({ platform: "aws" }));
    expect(html).toContain("Immutable");
    expect(html).toContain("delete and recreate");
    expect(html).not.toContain("Resizable");
  });
});

describe("renderCloudBlock", () => {
  it("renders nothing on-prem, so pre-cloud behavior is untouched", () => {
    expect(renderCloudBlock(initialState, subnet("10.0.0.0/24"))).toBe("");
  });

  it("shows the reserved math, not the RFC math", () => {
    const html = renderCloudBlock(withState({ platform: "azure" }), subnet("10.0.0.0/28"));
    // 16 total, 5 reserved, 11 usable — not the RFC 14.
    expect(html).toContain("11 / 16");
    expect(html).toContain("Azure reserves 5");
    expect(html).not.toContain("14 / 16");
  });

  it("uses the label as the subnet name and blocks an undersized GatewaySubnet", () => {
    const html = renderCloudBlock(
      withState({ platform: "azure" }),
      subnet("GatewaySubnet: 10.0.0.0/28")
    );
    expect(html).toContain("swb-verdict");
    expect(html).not.toContain("swb-verdict-ok");
    expect(html).toContain("Azure will reject this: 1 blocking issue.");
    expect(html).toContain("swb-f-err");
    expect(html).toContain("swb-sev-error");
    expect(html).toContain("GatewaySubnet requires /27 or larger");
  });

  it("passes a correctly sized GatewaySubnet while still surfacing its warnings", () => {
    const html = renderCloudBlock(
      withState({ platform: "azure" }),
      subnet("GatewaySubnet: 10.0.0.0/27")
    );
    expect(html).toContain("swb-verdict-ok");
    expect(html).toContain("things to look at");
    expect(html).not.toContain("swb-sev-error");
    expect(html).toContain("does not support NSGs");
  });

  it("reads clean for an ordinary unnamed subnet", () => {
    const html = renderCloudBlock(withState({ platform: "azure" }), subnet("10.0.0.0/24"));
    expect(html).toContain("Deployable on Azure.");
    expect(html).not.toContain("things to look at");
    expect(html).not.toContain("swb-sev-warning");
  });

  it("catches the capitalization near-miss as a warning, not silence", () => {
    const html = renderCloudBlock(
      withState({ platform: "azure" }),
      subnet("Gatewaysubnet: 10.0.0.0/27")
    );
    expect(html).toContain("differs only by capitalization");
    expect(html).toContain("swb-sev-warning");
  });

  it("tucks info findings behind a disclosure so the error stays on top", () => {
    const html = renderCloudBlock(
      withState({ platform: "azure" }),
      subnet("GatewaySubnet: 10.0.0.0/28")
    );
    expect(html).toContain("<details class=\"swb-context\">");
    expect(html).toContain("context notes");
    // The blocking finding is outside the details element.
    const detailsAt = html.indexOf("swb-context");
    expect(html.indexOf("swb-f-err")).toBeLessThan(detailsAt);
  });

  it("flags a prefix outside the platform's legal range", () => {
    const html = renderCloudBlock(withState({ platform: "azure" }), subnet("10.0.0.0/31"));
    expect(html).toContain("swb-sev-error");
    expect(html).toContain("Azure permits subnets from /2 to /29");
  });

  it("separates thousands so large blocks stay readable", () => {
    const html = renderCloudBlock(withState({ platform: "aws" }), subnet("10.0.0.0/16"));
    expect(html).toContain("65,531 / 65,536");
  });

  it("escapes a hostile label rather than emitting it", () => {
    const html = renderCloudBlock(
      withState({ platform: "azure" }),
      subnet("<img onerror=x>: 10.0.0.0/24")
    );
    expect(html).not.toContain("<img");
  });
});

describe("CLOUD_CSS", () => {
  it("uses Light Tennessee variables with fallbacks, never the retired palette", () => {
    expect(CLOUD_CSS).toContain("var(--tool-danger, #d64550)");
    expect(CLOUD_CSS).toContain("var(--color-orange-deep, #e07200)");
    for (const retired of ["#00ffcc", "#040a14", "#eef6ff", "#ffaa00", "#4da6ff"]) {
      expect(CLOUD_CSS).not.toContain(retired);
    }
  });

  it("styles a class for every severity the validator can emit", () => {
    for (const severity of ["error", "warning", "info"]) {
      expect(CLOUD_CSS).toContain(`.swb-sev-${severity}`);
    }
  });
});
