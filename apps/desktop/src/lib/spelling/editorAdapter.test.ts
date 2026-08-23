// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTesinaEditor } from "$lib/editor/createEditor";
import {
  attachSpellingEditorAdapter,
  issueAtBodyPosition,
  refreshSpellingDecorations,
} from "./editorAdapter.ts";
import type { ExperienceSpellingIssue } from "./controller.ts";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

afterEach(() => document.body.replaceChildren());

describe("ProseMirror spelling adapter", () => {
  it("intercepts pointer positions only inside a current body issue", () => {
    const issues: ExperienceSpellingIssue[] = [{
      source: "body",
      generation: 2,
      from: 4,
      to: 8,
      word: "wrng",
      termKey: "wrng",
      suggestions: [],
    }];
    expect(issueAtBodyPosition(issues, 6)).toBe(issues[0]);
    expect(issueAtBodyPosition(issues, 8)).toBeUndefined();
    expect(issueAtBodyPosition(issues, 9)).toBeUndefined();
    expect(issueAtBodyPosition([{ ...issues[0]!, source: "paper-title" }], 6))
      .toBeUndefined();
  });

  it("renders non-color-only decorations and reports body mutations", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = createTesinaEditor({
      element,
      content: {
        type: "doc",
        content: [{
          type: "sectionBody",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "wrng" }],
          }],
        }],
      },
      newlyCreated: true,
      citationEnv: { refsById: new Map(), locale: "en" },
      referenceEnv: { references: [], locale: "en", emptyLabel: "None" },
      paginationEnv: null,
    });
    const issues: ExperienceSpellingIssue[] = [{
      source: "body",
      generation: 1,
      from: 2,
      to: 6,
      word: "wrng",
      termKey: "wrng",
      suggestions: [],
    }];
    const onBodyMutation = vi.fn();
    const detach = attachSpellingEditorAdapter(editor, {
      getIssues: () => issues,
      onBodyMutation,
      onAltF7: vi.fn(),
      onIssueContextMenu: vi.fn(() => false),
    });
    refreshSpellingDecorations(editor);
    const mark = element.querySelector(".tesina-spelling-issue");
    expect(mark?.getAttribute("data-spelling-indicator")).toBe("misspelled");
    editor.commands.insertContentAt(6, "x");
    expect(onBodyMutation).toHaveBeenCalled();
    detach();
    editor.destroy();
  });
});
