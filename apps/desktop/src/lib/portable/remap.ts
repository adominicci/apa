/**
 * Pure ProseMirror identity/path walkers for imported essays (design §5).
 * One generic recursive walk over `content` arrays reaches every supported
 * container — body sections, abstract, appendices, paragraphs, nested lists,
 * tables — so no citation location can be missed. Every function clones; an
 * input document or essay object is never mutated.
 */

import type { Essay } from "$lib/model/essay";
import { rewriteFigureSources } from "./snapshot.ts";

interface CitationItem {
  refId?: unknown;
}

interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
}

/** Collects every citation `refId` in document order (duplicates preserved). */
export function collectCitationRefIds(docJson: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as DocNode;
    if (n.type === "citation" && Array.isArray(n.attrs?.["items"])) {
      for (const item of n.attrs["items"] as CitationItem[]) {
        if (
          item && typeof item === "object" && typeof item.refId === "string"
        ) {
          ids.push(item.refId);
        }
      }
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  };
  walk(docJson);
  return ids;
}

/**
 * Clone-rewrites every citation node's `attrs.items[].refId` through `idMap`;
 * unmapped ids pass through unchanged.
 */
export function remapCitationRefIds(
  docJson: unknown,
  idMap: ReadonlyMap<string, string>,
): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const n = node as DocNode;
    const out: Record<string, unknown> = { ...n };
    if (n.type === "citation" && Array.isArray(n.attrs?.["items"])) {
      const items = (n.attrs["items"] as CitationItem[]).map((item) => {
        if (
          item && typeof item === "object" && typeof item.refId === "string"
        ) {
          const mapped = idMap.get(item.refId);
          if (mapped !== undefined) return { ...item, refId: mapped };
        }
        return item;
      });
      out["attrs"] = { ...n.attrs, items };
    }
    if (Array.isArray(n.content)) out["content"] = n.content.map(walk);
    return out;
  };
  return walk(docJson);
}

export interface EssayRemapMaps {
  /** Old (conflicting) reference id → newly allocated id. */
  referenceIdMap: ReadonlyMap<string, string>;
  /** Archive figure path (`assets/...`) → final local path (`essays/assets/...`). */
  figurePathMap: ReadonlyMap<string, string>;
}

/**
 * Returns a fresh essay with citations rewritten through `referenceIdMap`,
 * figure `src` attributes rewritten through `figurePathMap`, and remapped
 * `referencesSnapshot` entries carrying their new id with their content
 * otherwise unchanged. The input essay is never mutated.
 */
export function remapEssay(essay: Essay, maps: EssayRemapMaps): Essay {
  const content = rewriteFigureSources(
    remapCitationRefIds(essay.content, maps.referenceIdMap),
    (src) => maps.figurePathMap.get(src) ?? src,
  );
  return {
    ...essay,
    settings: { ...essay.settings },
    titlePage: { ...essay.titlePage },
    content,
    referencesSnapshot: essay.referencesSnapshot.map((reference) => {
      const mapped = maps.referenceIdMap.get(reference.id);
      return mapped !== undefined
        ? { ...reference, id: mapped }
        : { ...reference };
    }),
  };
}
