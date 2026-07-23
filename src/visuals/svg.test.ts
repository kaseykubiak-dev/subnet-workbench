import { describe, expect, it } from "vitest";

import { attrs, el, esc, hatchDefs, svgRoot, textEl } from "./svg";

describe("esc", () => {
  it("escapes the five XML-significant characters", () => {
    expect(esc(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;"
    );
  });

  it("passes plain text through", () => {
    expect(esc("10.0.0.0/24")).toBe("10.0.0.0/24");
  });
});

describe("attrs", () => {
  it("renders key-value pairs with a leading space", () => {
    expect(attrs({ x: 1, fill: "red" })).toBe(` x="1" fill="red"`);
  });

  it("omits undefined values", () => {
    expect(attrs({ x: 1, y: undefined })).toBe(` x="1"`);
  });

  it("escapes attribute values", () => {
    expect(attrs({ label: `a"b` })).toBe(` label="a&quot;b"`);
  });

  it("renders empty map as empty string", () => {
    expect(attrs({})).toBe("");
  });
});

describe("el / textEl", () => {
  it("self-closes empty elements", () => {
    expect(el("rect", { x: 0 })).toBe(`<rect x="0"/>`);
  });

  it("wraps children without escaping them", () => {
    expect(el("g", {}, `<rect/>`)).toBe(`<g><rect/></g>`);
  });

  it("escapes text content in textEl", () => {
    expect(textEl("text", { x: 0 }, "<b>")).toBe(`<text x="0">&lt;b&gt;</text>`);
  });
});

describe("svgRoot", () => {
  it("emits xmlns, viewBox, and role", () => {
    const svg = svgRoot(100, 50, {}, `<rect/>`);
    expect(svg).toContain(`xmlns="http://www.w3.org/2000/svg"`);
    expect(svg).toContain(`viewBox="0 0 100 50"`);
    expect(svg).toContain(`role="img"`);
    expect(svg).toContain(`<rect/>`);
  });
});

describe("hatchDefs", () => {
  it("defines both hatch patterns", () => {
    const defs = hatchDefs();
    expect(defs).toContain(`id="swb-hatch"`);
    expect(defs).toContain(`id="swb-hatch-err"`);
  });
});
