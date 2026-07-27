/**
 * Tests for the shared entry roster.
 *
 * These cover the roster's own contract rather than either caller's: what a row
 * looks like ticked, what happens to the row under edit, when the bulk bar
 * appears, and which indices the All / None links carry. Calculate's and
 * Overlap's decorations are tested where they are decided, in view.test.ts and
 * overlapView.test.ts.
 */

import { describe, expect, it } from "vitest";
import {
  ROSTER_CSS,
  renderCheckAll,
  renderEditFoot,
  renderRoster,
  renderRosterHead,
  type BulkAction,
  type RosterActions,
  type RosterRow,
  type RosterSpec,
} from "./rosterView";

const ACTIONS: RosterActions = {
  select: "pick",
  check: "tick",
  checkAll: "tick-all",
  beginEdit: "edit",
  commitEdit: "save",
  cancelEdit: "undo",
  remove: "cut",
};

const BULK: BulkAction[] = [
  { action: "send", label: "Send" },
  { action: "one", label: "Supernet", singleOnly: true },
  { action: "cut-many", label: "Remove", danger: true },
];

function row(over: Partial<RosterRow> = {}): RosterRow {
  return {
    raw: "Mgmt: 10.0.0.0/24",
    label: "Mgmt",
    cidr: "10.0.0.0/24",
    className: "",
    trailing: "",
    selectable: true,
    ...over,
  };
}

function spec(over: Partial<RosterSpec> = {}): RosterSpec {
  return {
    rows: [row(), row({ raw: "10.0.1.0/24", label: "", cidr: "10.0.1.0/24" })],
    selected: null,
    editing: null,
    editDraft: "",
    editError: "",
    checked: [],
    editField: "editDraft",
    actions: ACTIONS,
    bulk: BULK,
    ...over,
  };
}

describe("renderRoster", () => {
  it("renders nothing for an empty list", () => {
    expect(renderRoster(spec({ rows: [] }))).toBe("");
  });

  it("gives every row a checkbox, a pencil and an x", () => {
    const html = renderRoster(spec());
    expect(html.match(/data-action="tick"/g)).toHaveLength(2);
    expect(html.match(/data-action="edit"/g)).toHaveLength(2);
    expect(html.match(/data-action="cut"/g)).toHaveLength(2);
  });

  it("numbers rows from 01 and carries zero-based indices", () => {
    const html = renderRoster(spec());
    expect(html).toContain(">01</span>");
    expect(html).toContain(">02</span>");
    expect(html).toContain('data-action="edit" data-index="1"');
    expect(html).toContain('data-action="cut" data-indices="1"');
  });

  it("marks a ticked row and checks its box", () => {
    const html = renderRoster(spec({ checked: [1] }));
    expect(html.match(/swb-entry swb-ck/g)).toHaveLength(1);
    expect(html).toContain('data-index="1" checked');
    expect(html).not.toContain('data-index="0" checked');
  });

  it("ticking and selecting are separate marks on the row", () => {
    const html = renderRoster(spec({ checked: [0], selected: 0 }));
    expect(html).toContain('class="swb-entry swb-sel swb-ck"');
  });

  it("drops the click target on an unselectable row but keeps the pencil", () => {
    const html = renderRoster(
      spec({ rows: [row({ raw: "banana", cidr: undefined, selectable: false })] })
    );
    expect(html).not.toContain('data-action="pick"');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain(">banana</span>");
  });

  it("shows the raw line when the row has no CIDR", () => {
    const html = renderRoster(spec({ rows: [row({ raw: "nope", cidr: undefined })] }));
    expect(html).toContain(">nope</span>");
    expect(html).not.toContain("swb-entry-cidr");
  });

  it("escapes labels, raw lines and action names", () => {
    const html = renderRoster(
      spec({
        rows: [row({ raw: "<b>x</b>", label: "<b>x</b>", cidr: "10.0.0.0/24" })],
        actions: { ...ACTIONS, select: 'a"b' },
      })
    );
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain('data-action="a&quot;b"');
  });

  it("slots the caller's trailing markup into the row", () => {
    const html = renderRoster(
      spec({ rows: [row({ trailing: '<span class="chip">warn</span>' })] })
    );
    expect(html).toContain('<span class="chip">warn</span>');
  });
});

describe("the row under edit", () => {
  it("swaps the row for a text box seeded with the draft", () => {
    const html = renderRoster(spec({ editing: 0, editDraft: "10.0.0.0/25" }));
    expect(html).toContain('data-field="editDraft"');
    expect(html).toContain('value="10.0.0.0/25"');
    // The row it replaced is gone; the untouched one still has its pencil.
    expect(html.match(/data-action="edit"/g)).toHaveLength(1);
  });

  it("offers a save and a cancel as well as the keys", () => {
    const html = renderRoster(spec({ editing: 0 }));
    expect(html).toContain('data-action="save"');
    expect(html).toContain('data-action="undo"');
    expect(html).toContain("Enter saves");
  });

  it("takes the checkbox away so a bulk remove cannot cut the row being fixed", () => {
    const html = renderRoster(spec({ editing: 0, checked: [1] }));
    expect(html.match(/data-action="tick"/g)).toHaveLength(1);
    expect(html).toContain('data-action="tick" data-index="1"');
  });

  it("keeps the row's number in place", () => {
    expect(renderRoster(spec({ editing: 1 }))).toContain(">02</span>");
  });

  it("shows the reason instead of the key hint when the edit will not commit", () => {
    const html = renderRoster(spec({ editing: 0, editError: "not a subnet" }));
    expect(html).toContain("not a subnet");
    expect(html).not.toContain("Enter saves");
  });

  it("escapes the draft so a hostile value cannot break out of the input", () => {
    const html = renderRoster(spec({ editing: 0, editDraft: '"><script>' }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("renderEditFoot", () => {
  it("carries the swap hook on both variants", () => {
    expect(renderEditFoot("")).toContain("swb-entry-foot");
    expect(renderEditFoot("bad")).toContain("swb-entry-foot");
  });

  it("shows the keys when there is nothing wrong", () => {
    expect(renderEditFoot("")).toContain("Enter saves");
    expect(renderEditFoot("")).not.toContain("swb-error");
  });

  it("shows an escaped reason when there is", () => {
    const html = renderEditFoot("<b>no</b>");
    expect(html).toContain("swb-error");
    expect(html).toContain("&lt;b&gt;no&lt;/b&gt;");
  });
});

describe("the bulk bar", () => {
  it("stays away until something is ticked", () => {
    expect(renderRoster(spec())).not.toContain("swb-bulk");
  });

  it("appears with a count as soon as something is", () => {
    const html = renderRoster(spec({ checked: [1] }));
    expect(html).toContain("swb-bulk");
    expect(html).toContain("1 selected");
  });

  it("counts what is ticked, not what is in the list", () => {
    expect(renderRoster(spec({ checked: [0, 1] }))).toContain("2 selected");
  });

  it("disables a single-only action unless exactly one row is ticked", () => {
    const one = renderRoster(spec({ checked: [0] }));
    expect(one).toContain('data-action="one">Supernet');
    const two = renderRoster(spec({ checked: [0, 1] }));
    expect(two).toContain('data-action="one" disabled');
  });

  it("marks a destructive action so it can be coloured apart", () => {
    expect(renderRoster(spec({ checked: [0] }))).toContain("swb-bulk-del");
  });

  it("is omitted when the caller offers no bulk actions", () => {
    expect(renderRoster(spec({ checked: [0], bulk: [] }))).not.toContain("swb-bulk");
  });
});

describe("renderCheckAll", () => {
  it("renders nothing for an empty list", () => {
    expect(renderCheckAll("tick-all", 0)).toBe("");
  });

  it("gives All every index and None an empty list", () => {
    const html = renderCheckAll("tick-all", 3);
    expect(html).toContain('data-indices="0,1,2">All');
    expect(html).toContain('data-indices="">None');
  });
});

describe("renderRosterHead", () => {
  it("renders a bare label when there is no badge or control", () => {
    const html = renderRosterHead("Subnets &middot; 0", "", []);
    expect(html).toContain("Subnets &middot; 0");
    expect(html).not.toContain("swb-roster-ctl");
  });

  it("keeps the caller's badge and controls in order", () => {
    const html = renderRosterHead("Subnets", "<span>clear</span>", ["<i>a</i>", "<i>b</i>"]);
    expect(html.indexOf("<span>clear</span>")).toBeLessThan(html.indexOf("<i>a</i>"));
    expect(html.indexOf("<i>a</i>")).toBeLessThan(html.indexOf("<i>b</i>"));
  });
});

describe("ROSTER_CSS", () => {
  it("owns the head and link rules both rosters now use", () => {
    expect(ROSTER_CSS).toContain(".swb-roster-head");
    expect(ROSTER_CSS).toContain(".swb-textlink");
  });

  it("reveals the pencil on hover rather than leaving it in the row", () => {
    expect(ROSTER_CSS).toContain(".swb-entry-ed");
    expect(ROSTER_CSS).toContain(".swb-entry:hover .swb-entry-ed");
  });

  it("stays on the light surface: no retired dark panel hexes", () => {
    expect(ROSTER_CSS).not.toContain("#161310");
    expect(ROSTER_CSS).not.toContain("#f4ede3");
  });
});
