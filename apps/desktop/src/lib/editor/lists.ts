import { Extension } from "@tiptap/core";

export type OrderedListStyle = "decimal" | "lower-alpha";

/**
 * Adds a `listStyle` attribute to StarterKit's ordered list so APA lettered
 * lists (a, b, c) are possible without swapping the node out. `decimal`
 * renders no extra markup; other values carry a `data-list-style` attribute
 * that the preview and DOCX exporters read to pick the numbering format.
 */
export const OrderedListStyleAttr = Extension.create({
  name: "orderedListStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["orderedList"],
        attributes: {
          listStyle: {
            default: "decimal" as OrderedListStyle,
            parseHTML: (el: HTMLElement): OrderedListStyle =>
              el.getAttribute("data-list-style") === "lower-alpha"
                ? "lower-alpha"
                : "decimal",
            renderHTML: (attrs: { listStyle?: OrderedListStyle }) =>
              attrs.listStyle && attrs.listStyle !== "decimal"
                ? { "data-list-style": attrs.listStyle }
                : {},
          },
        },
      },
    ];
  },
});
