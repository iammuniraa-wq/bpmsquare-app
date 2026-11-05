import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import PhotoFrame from "./PhotoFrame";

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToString(el);

describe("PhotoFrame", () => {
  it("is a rounded mesh frame that holds floating children", () => {
    const out = html(createElement(PhotoFrame, { mesh: "c", radius: 32, height: 200 }, "Bid 042"));
    expect(out).toContain("rich-photo--c");
    expect(out).toContain("border-radius:32px");
    expect(out).toContain("height:200px");
    expect(out).toContain("Bid 042");
    expect(out).not.toContain("<img");
  });

  it("holds a real picture later, decorative unless it has alt text", () => {
    const out = html(createElement(PhotoFrame, { src: "/x.jpg", alt: "Warehouse" }));
    expect(out).toContain('src="/x.jpg"');
    expect(out).toContain('alt="Warehouse"');
  });
});
