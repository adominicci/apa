import type { PMJson } from "./input.ts";

function isNode(value: unknown): value is PMJson {
  return typeof value === "object" && value !== null;
}

function normalizedTitle(value: string): string {
  return value.normalize("NFC").trim();
}

function headingPlainText(heading: PMJson): string | null {
  let text = "";
  for (const inline of heading.content ?? []) {
    if (inline.type === "text" && typeof inline.text === "string") {
      text += inline.text;
    } else if (inline.type === "hardBreak") {
      text += "\n";
    } else {
      return null;
    }
  }
  return text;
}

/**
 * Recognizes a stored leading H1 that already fulfills the derived body-title
 * role. This is read-only compatibility for schema-v2 documents; renderers
 * keep the authored node and omit only their synthetic duplicate.
 */
export function hasAuthoredBodyTitle(
  documentOrBody: unknown,
  titlePageTitle: string,
): boolean {
  if (!isNode(documentOrBody)) return false;
  const body = documentOrBody.type === "sectionBody"
    ? documentOrBody
    : documentOrBody.content?.find(
      (node) => isNode(node) && node.type === "sectionBody",
    );
  if (!body || !isNode(body)) return false;

  const firstBlock = body.content?.[0];
  if (
    !isNode(firstBlock) || firstBlock.type !== "heading" ||
    firstBlock.attrs?.["level"] !== 1
  ) {
    return false;
  }

  const authoredText = headingPlainText(firstBlock);
  return authoredText !== null &&
    normalizedTitle(authoredText) === normalizedTitle(titlePageTitle);
}
