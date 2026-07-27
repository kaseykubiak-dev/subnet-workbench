import { describe, expect, it } from "vitest";

import { OVERLAP_CSS, renderOverlapInputs, renderOverlapOutput } from "./overlapView";
import { initialState } from "./state";
import type { ShellState } from "./state";

function withState(overrides: Partial<ShellState>): ShellState {
  return { ...initialState, mode: "overlap", ...overrides };
}

/**
 * Knoxville contains Nashville (warning); DC-Core and DC-Core-B are identical
 * (error); Chattanooga and Guest-WiFi are clean. Entry indices 0..5 map to
 * parse line numbers 1..6.
 */
const FIXTURE = [
  "Knoxville: 10.10.0.0/16",
  "Nashville: 10.10.32.0/20",
  "Chattanooga: 10.20.0.0/16",
  "DC-Core: 10.30.0.0/24",
  "DC-Core-B: 10.30.0.0/24",
  "Guest-WiFi: 192.168.50.0/24",
].join("\n");

const CLEAN = "A: 10.0.0.0/24\nB: 10.0.1.0/24\nC: 10.0.2.0/24";

describe("renderOverlapInputs: the verdict roster", () => {
  it("renders one indexed row per entry with a remove control", () => {
    const html = renderOverlapInputs(withState({ overlapInput: FIXTURE }));
    expect(html).toContain("Subnets &middot; 6");
    expect(html.match(/data-action="select-overlap-entry"/g)).toHaveLength(6);
    expect(html.match(/data-action="remove-overlap-entry"/g)).toHaveLength(6);
    expect(html).toContain(">01<");
    expect(html).toContain(">06<");
    expect(html).toContain("Knoxville");
    expect(html).toContain("10.10.0.0/16");
  });

  it("marks conflicted rows with a severity edge and a chip", () => {
    const html = renderOverlapInputs(withState({ overlapInput: FIXTURE }));
    // Knoxville/Nashville are the warnings; the two DC-Core rows are errors.
    expect(html.match(/swb-ov-warning/g)).toHaveLength(2);
    expect(html.match(/swb-ov-error/g)).toHaveLength(2);
    expect(html.match(/swb-sev-warning/g)).toHaveLength(2);
    expect(html.match(/swb-sev-error/g)).toHaveLength(2);
  });

  it("leaves clean rows unmarked, which is the whole point of the treatment", () => {
    const html = renderOverlapInputs(withState({ overlapInput: CLEAN }));
    expect(html).not.toContain("swb-ov-error");
    expect(html).not.toContain("swb-ov-warning");
    expect(html).not.toContain("swb-sev-");
    expect(html).toContain("swb-tally-ok");
    expect(html).toContain(">clear<");
  });

  it("tallies conflicts at the loudest severity present", () => {
    expect(renderOverlapInputs(withState({ overlapInput: FIXTURE }))).toContain(
      "swb-tally-err"
    );
    expect(renderOverlapInputs(withState({ overlapInput: FIXTURE }))).toContain(
      "2 conflicts"
    );
    const warnOnly = "Super: 10.0.0.0/8\nSite: 10.1.0.0/16";
    const html = renderOverlapInputs(withState({ overlapInput: warnOnly }));
    expect(html).toContain("swb-tally-warn");
    expect(html).toContain("1 conflict<");
  });

  it("shows no tally at all when there is nothing to compare", () => {
    const html = renderOverlapInputs(withState({ overlapInput: "10.0.0.0/24" }));
    expect(html).not.toContain("swb-tally");
    expect(html).toContain("Subnets &middot; 1");
  });

  it("marks the focused row and only that row", () => {
    const html = renderOverlapInputs(
      withState({ overlapInput: FIXTURE, overlapSelected: 3 })
    );
    expect(html.match(/swb-sel/g)).toHaveLength(1);
    expect(html).toContain('data-index="3"');
  });

  it("ignores a focus index the list no longer holds", () => {
    const html = renderOverlapInputs(
      withState({ overlapInput: CLEAN, overlapSelected: 9 })
    );
    expect(html).not.toContain("swb-sel");
  });

  it("flags unparseable lines and escapes them", () => {
    const html = renderOverlapInputs(
      withState({ overlapInput: "banana\n<b>x</b>: 10.0.0.0/24" })
    );
    expect(html).toContain("swb-entry-bad");
    expect(html).toContain("banana");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("carries one index per row so removal cannot hit the wrong entry", () => {
    const html = renderOverlapInputs(withState({ overlapInput: FIXTURE }));
    expect(html).toContain('data-indices="0"');
    expect(html).toContain('data-indices="5"');
  });

  it("offers the add box, its errors, and the commit action", () => {
    const html = renderOverlapInputs(
      withState({ overlapDraft: "10.0.0.0/24", overlapDraftError: "pear —> not a subnet" })
    );
    expect(html).toContain('data-field="overlapDraft"');
    expect(html).toContain(">10.0.0.0/24</textarea>");
    expect(html).toContain('data-action="commit-overlap-draft"');
    expect(html).toContain('data-action="clear-mode"');
    expect(html).toContain("swb-error");
    expect(html).toContain("pear");
  });

  it("offers the edit-as-text toggle even with an empty list", () => {
    const html = renderOverlapInputs(withState({}));
    expect(html).toContain('data-action="toggle-overlap-text"');
    expect(html).not.toContain("swb-entries");
  });
});

describe("renderOverlapInputs: the edit-as-text escape hatch", () => {
  it("swaps the roster for the raw textarea holding the same lines", () => {
    const html = renderOverlapInputs(
      withState({ overlapInput: FIXTURE, overlapEditText: true })
    );
    expect(html).toContain('data-field="overlapInput"');
    expect(html).toContain("Knoxville: 10.10.0.0/16");
    expect(html).not.toContain("swb-entries");
    expect(html).not.toContain('data-action="select-overlap-entry"');
    expect(html).not.toContain('data-field="overlapDraft"');
  });

  it("offers the way back", () => {
    const html = renderOverlapInputs(withState({ overlapEditText: true }));
    expect(html).toContain('data-action="toggle-overlap-text"');
    expect(html).toContain("Back to list");
  });

  it("escapes hostile textarea content", () => {
    const html = renderOverlapInputs(
      withState({ overlapEditText: true, overlapInput: "<script>alert(1)</script>" })
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderOverlapOutput: the report", () => {
  it("hints rather than showing an empty table when there is nothing yet", () => {
    const html = renderOverlapOutput(withState({}));
    expect(html).toContain("swb-hint");
    expect(html).toContain("Waiting on a list");
  });

  it("makes the all-clear state unmistakable", () => {
    const html = renderOverlapOutput(withState({ overlapInput: CLEAN }));
    expect(html).toContain("swb-verdict-ok");
    expect(html).toContain("No conflicts across 3 subnets.");
    expect(html).not.toContain("swb-ovc-");
  });

  it("says why an under-two list is not an all-clear", () => {
    const html = renderOverlapOutput(withState({ overlapInput: "10.0.0.0/24" }));
    expect(html).toContain("only one subnet");
    expect(html).not.toContain("swb-verdict-ok");
  });

  it("renders one row per conflict, worst first, with the summary above", () => {
    const html = renderOverlapOutput(withState({ overlapInput: FIXTURE }));
    expect(html).toContain("2 conflicts across 6 subnets (1 error, 1 warning).");
    expect(html.match(/class="swb-ovc /g)).toHaveLength(2);
    expect(html.indexOf("swb-ovc-error")).toBeLessThan(html.indexOf("swb-ovc-warning"));
    expect(html).toContain("are identical");
  });

  it("offers to remove both sides of a conflict in one action", () => {
    const html = renderOverlapOutput(withState({ overlapInput: FIXTURE }));
    expect(html).toContain("Remove both");
    // DC-Core and DC-Core-B are entries 3 and 4.
    expect(html).toContain('data-indices="3,4"');
    // Knoxville contains Nashville: entries 0 and 1.
    expect(html).toContain('data-indices="0,1"');
  });

  it("withholds the repair in text mode, where indices cannot be trusted", () => {
    const html = renderOverlapOutput(
      withState({ overlapInput: FIXTURE, overlapEditText: true })
    );
    expect(html).toContain("swb-ovc-error");
    expect(html).not.toContain("Remove both");
  });

  it("keeps the plain-text report copyable behind a disclosure", () => {
    const html = renderOverlapOutput(withState({ overlapInput: FIXTURE }));
    expect(html).toContain("<details");
    expect(html).toContain('id="swb-overlap-text"');
    expect(html).toContain('data-copy-target="swb-overlap-text"');
    expect(html).toContain("ERROR");
  });

  it("still hands the whole list off to Vendor Syntax", () => {
    const html = renderOverlapOutput(withState({ overlapInput: FIXTURE }));
    expect(html).toContain('data-action="overlap-to-vendor"');
  });

  it("surfaces parse errors above the report", () => {
    const html = renderOverlapOutput(
      withState({ overlapInput: "10.0.0.0/24\n10.0.1.0/24\nbanana" })
    );
    expect(html).toContain("swb-error");
    expect(html).toContain("banana");
  });

  it("escapes hostile labels on their way into the report", () => {
    const html = renderOverlapOutput(
      withState({ overlapInput: "<img src=x>: 10.0.0.0/24\nB: 10.0.0.0/24" })
    );
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img");
  });
});

describe("renderOverlapOutput: the focus filter", () => {
  it("scopes the report to the focused subnet's conflicts", () => {
    const html = renderOverlapOutput(
      withState({ overlapInput: FIXTURE, overlapSelected: 0 })
    );
    expect(html).toContain("Showing 1 conflict for Knoxville.");
    expect(html.match(/class="swb-ovc /g)).toHaveLength(1);
    // The DC-Core pair is another subnet's problem; only the copyable
    // plain-text artifact below still carries the whole report.
    expect(html).not.toContain("swb-ovc-error");
  });

  it("always offers the way back out to everything", () => {
    const html = renderOverlapOutput(
      withState({ overlapInput: FIXTURE, overlapSelected: 3 })
    );
    expect(html).toContain('data-action="clear-overlap-filter"');
    expect(html).toContain("show all 2 conflicts");
  });

  it("says so plainly when the focused subnet is clean", () => {
    const html = renderOverlapOutput(
      withState({ overlapInput: FIXTURE, overlapSelected: 2 })
    );
    expect(html).toContain("Chattanooga is clean; nothing overlaps it.");
    expect(html).not.toContain("swb-ovc-");
    expect(html).toContain('data-action="clear-overlap-filter"');
  });

  it("falls back to the full report when the focus is out of range", () => {
    const html = renderOverlapOutput(
      withState({ overlapInput: FIXTURE, overlapSelected: 99 })
    );
    expect(html).toContain("2 conflicts across 6 subnets");
    expect(html).not.toContain("Showing");
  });

  it("ignores the filter in text mode, where rows are not clickable", () => {
    const html = renderOverlapOutput(
      withState({ overlapInput: FIXTURE, overlapSelected: 0, overlapEditText: true })
    );
    expect(html).toContain("2 conflicts across 6 subnets");
    expect(html).not.toContain("Showing");
  });
});

describe("OVERLAP_CSS", () => {
  it("uses the severity edge as an inset shadow, not a layout-shifting border", () => {
    expect(OVERLAP_CSS).toContain(".swb-ov-error { box-shadow: inset 2px 0 0");
    expect(OVERLAP_CSS).toContain(".swb-ov-warning { box-shadow: inset 2px 0 0");
  });

  it("carries no retired dark-theme surfaces", () => {
    expect(OVERLAP_CSS).not.toContain("#161310");
    expect(OVERLAP_CSS).not.toContain("#f4ede3");
  });
});
