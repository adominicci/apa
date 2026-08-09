// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownContent from "./MarkdownContent.svelte";

const opener = vi.hoisted(() => ({
  openUrl: vi.fn<(url: string | URL) => Promise<void>>(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: opener.openUrl,
}));

let component: ReturnType<typeof mount> | null = null;

function render(source: string): HTMLElement {
  component = mount(MarkdownContent, {
    target: document.body,
    props: { source },
  });
  flushSync();
  return document.querySelector<HTMLElement>(".markdown-content")!;
}

beforeEach(() => {
  opener.openUrl.mockReset();
  opener.openUrl.mockResolvedValue();
});

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  document.body.replaceChildren();
});

describe("MarkdownContent supported release-note structure", () => {
  it("normalizes headings below the dialog title and renders supported inline and list semantics", () => {
    const root = render(`# Changed

## Details

###### Deep note

A paragraph with **strong text**, *emphasis*, and \`inline code\`.

1. First ordered item
2. Second ordered item

- First unordered item
- Second unordered item`);

    expect(root.querySelector("h4")?.textContent).toBe("Changed");
    expect(root.querySelector("h5")?.textContent).toBe("Details");
    expect(root.querySelector("h6")?.textContent).toBe("Deep note");
    expect(root.querySelector("h1, h2, h3")).toBeNull();
    expect(root.querySelector("p")?.textContent).toContain(
      "A paragraph with strong text, emphasis, and inline code.",
    );
    expect(root.querySelector("strong")?.textContent).toBe("strong text");
    expect(root.querySelector("em")?.textContent).toBe("emphasis");
    expect(root.querySelector("code")?.textContent).toBe("inline code");
    expect(
      Array.from(root.querySelectorAll("ol > li"), (item) => item.textContent),
    ).toEqual(["First ordered item", "Second ordered item"]);
    expect(
      Array.from(root.querySelectorAll("ul > li"), (item) => item.textContent),
    ).toEqual(["First unordered item", "Second unordered item"]);
  });

  it("keeps readable text for malformed and unsupported Markdown without loading resources", () => {
    const root = render(
      `Broken **emphasis and [unfinished link](https://example.com

![Diagram alternative](https://tracker.invalid/pixel.png)

~~Unsupported deletion still reads~~

| First | Second |
| --- | --- |
| Alpha | Beta |`,
    );

    expect(root.textContent).toContain("Broken");
    expect(root.textContent).toContain("unfinished link");
    expect(root.textContent).toContain("Diagram alternative");
    expect(root.textContent).toContain("Unsupported deletion still reads");
    expect(root.textContent).toContain("Alpha");
    expect(root.textContent).toContain("Beta");
    expect(root.querySelector("img, picture, source")).toBeNull();
  });
});

describe("MarkdownContent sanitization", () => {
  it("removes executable, styling, foreign-namespace, and embedded-resource markup while retaining readable text", () => {
    const root = render(
      `<div style="position:fixed" onclick="globalThis.__markdownAttack = true" data-probe="x">Visible raw text</div>
<script>globalThis.__markdownAttack = true</script>
<style>body { display: none }</style>
<svg onload="globalThis.__markdownAttack = true"><text>Vector text</text><a href="https://tracker.invalid/vector">Vector link</a></svg>
<math><mtext>Math text</mtext><a href="https://tracker.invalid/math">Math link</a></math>
<iframe src="https://tracker.invalid/frame">Frame text</iframe>
<img src="https://tracker.invalid/pixel.png" onerror="globalThis.__markdownAttack = true" alt="Image text">
<audio src="https://tracker.invalid/audio"></audio>
<video src="https://tracker.invalid/video"></video>
<object data="https://tracker.invalid/object"></object>
<a href="https://example.com" style="color:red" onclick="globalThis.__markdownAttack = true" data-probe="x">Safe text</a>`,
    );

    expect(root.textContent).toContain("Visible raw text");
    expect(root.textContent).toContain("Safe text");
    expect(
      root.querySelector(
        "script, style, svg, math, iframe, img, audio, video, source, object, embed, link, meta",
      ),
    ).toBeNull();
    expect(root.querySelector("[style], [data-probe]")).toBeNull();
    for (const element of root.querySelectorAll("*")) {
      expect(
        Array.from(element.attributes).some((attribute) =>
          attribute.name.toLowerCase().startsWith("on")
        ),
      ).toBe(false);
      expect(element.hasAttribute("src")).toBe(false);
      expect(element.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    }
    expect((globalThis as { __markdownAttack?: boolean }).__markdownAttack)
      .not.toBe(true);
  });

  it("leaves unsafe and non-absolute destinations inert while preserving their labels", () => {
    const root = render(`[script](javascript:alert(1))
[encoded script](%6A%61vascript:alert(1))
[data](data:text/html;base64,PHNjcmlwdD4=)
[file](file:///tmp/notes)
[relative](/release-notes)
[protocol relative](//example.com/release-notes)
[http](http://example.com/release-notes)
[mail](mailto:test@example.com)

<a href="java&#x73;cript:alert(1)">HTML encoded script</a>`);

    for (
      const label of [
        "script",
        "encoded script",
        "data",
        "file",
        "relative",
        "protocol relative",
        "http",
        "mail",
        "HTML encoded script",
      ]
    ) {
      expect(root.textContent).toContain(label);
    }
    expect(root.querySelector("a[href]")).toBeNull();
  });

  it("delegates only an absolute HTTPS link to the Tauri opener", async () => {
    const root = render(
      `[Project site](https://example.com/releases/current?from=notes#details)`,
    );
    const link = root.querySelector<HTMLAnchorElement>("a");

    expect(link?.getAttribute("href")).toBe(
      "https://example.com/releases/current?from=notes#details",
    );
    expect(link?.hasAttribute("target")).toBe(false);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link!.dispatchEvent(event);
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(opener.openUrl).toHaveBeenCalledTimes(1);
    expect(opener.openUrl).toHaveBeenCalledWith(
      "https://example.com/releases/current?from=notes#details",
    );
  });
});
