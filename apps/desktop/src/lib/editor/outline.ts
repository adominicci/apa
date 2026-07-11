interface DocNode {
  type?: string;
  attrs?: { level?: number };
  text?: string;
  content?: DocNode[];
}

export interface OutlineItem {
  /** ProseMirror position of the block start (for focus/scroll). */
  pos: number;
  /** "—" title page (pos -1), "R" abstract/references, digits for sections. */
  marker: string;
  label: string;
  words: number;
  sub: boolean;
}

function textOf(node: DocNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(textOf).join("");
}

function wordsOf(node: DocNode): number {
  const text = textOf(node).trim();
  return text === "" ? 0 : text.split(/\s+/).length;
}

/**
 * Builds the ESTRUCTURA sidebar items from the sectioned doc: the abstract,
 * every level 1–2 heading in the body (level 3 as sub-items), and the
 * appendices. Word counts cover each segment until the next same-or-higher
 * heading — same numbers the prototype shows next to each entry.
 */
export function buildOutline(docJson: unknown): OutlineItem[] {
  const doc = docJson as DocNode;
  const items: OutlineItem[] = [];
  let sectionNumber = 0;
  // Doc-level positions: children of doc start after the section opening tag.
  let pos = 0;

  for (const section of doc.content ?? []) {
    const sectionStart = pos;
    const inner = section.content ?? [];

    if (section.type === "sectionAbstract") {
      items.push({
        pos: sectionStart + 1,
        marker: "R",
        label: "",
        words: wordsOf(section),
        sub: false,
      });
    } else if (section.type === "sectionBody") {
      let childPos = sectionStart + 1;
      let current: OutlineItem | null = null;
      for (const block of inner) {
        const blockSize = nodeSize(block);
        const level = Number(block.attrs?.level ?? 0);
        if (block.type === "heading" && level <= 2) {
          sectionNumber += 1;
          current = {
            pos: childPos,
            marker: String(sectionNumber),
            label: textOf(block).trim() || "…",
            words: 0,
            sub: false,
          };
          items.push(current);
        } else if (block.type === "heading" && level === 3) {
          items.push({
            pos: childPos,
            marker: "",
            label: textOf(block).trim() || "…",
            words: 0,
            sub: true,
          });
        } else if (current) {
          current.words += wordsOf(block);
        }
        childPos += blockSize;
      }
    } else if (section.type === "sectionAppendix") {
      items.push({
        pos: sectionStart + 1,
        marker: "A",
        label: "",
        words: wordsOf(section),
        sub: false,
      });
    }
    pos += nodeSize(section);
  }
  return items;
}

/** Size of a node in ProseMirror positions (open + content + close). */
function nodeSize(node: DocNode): number {
  if (typeof node.text === "string") return node.text.length;
  const inner = (node.content ?? []).reduce(
    (sum, child) => sum + nodeSize(child),
    0,
  );
  return inner + 2;
}
