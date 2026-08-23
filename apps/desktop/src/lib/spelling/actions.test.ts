// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTesinaEditor } from "$lib/editor/createEditor";
import type { ExperienceSpellingIssue } from "./controller.ts";
import {
  applyDurableIssueAction,
  replaceBodyIssue,
  replaceTitleIssue,
  verifyCurrentIssue,
} from "./actions.ts";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function issue(
  source: "body" | "paper-title",
  from: number,
  to: number,
  word: string,
): ExperienceSpellingIssue {
  return {
    source,
    generation: 4,
    from,
    to,
    word,
    termKey: word.toLocaleLowerCase("en"),
    suggestions: ["right"],
  };
}

function bodyEditor() {
  const element = document.createElement("div");
  document.body.append(element);
  return createTesinaEditor({
    element,
    content: {
      type: "doc",
      content: [{
        type: "sectionBody",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "wrng and wrng" }],
        }],
      }],
    },
    newlyCreated: true,
    citationEnv: { refsById: new Map(), locale: "en" },
    referenceEnv: { references: [], locale: "en", emptyLabel: "None" },
    paginationEnv: null,
  });
}

afterEach(() => document.body.replaceChildren());

describe("source-safe spelling actions", () => {
  it("replaces one verified body occurrence through normal ProseMirror history", () => {
    const editor = bodyEditor();
    const target = issue("body", 2, 6, "wrng");
    expect(replaceBodyIssue(editor, target, 4, "wrong", "en")).toBe(true);
    expect(editor.state.doc.textBetween(2, 16, "", "")).toBe("wrong and wrng");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textBetween(2, 15, "", "")).toBe("wrng and wrng");
    editor.destroy();
  });

  it("rejects stale generation, source, range, term, and substring mismatches", () => {
    const readers = {
      title: () => "changed",
      body: () => "wrng",
    };
    expect(
      verifyCurrentIssue(issue("paper-title", 0, 4, "wrng"), 4, readers, "en"),
    )
      .toBe(false);
    expect(verifyCurrentIssue(issue("body", 0, 4, "wrng"), 5, readers, "en"))
      .toBe(false);
  });

  it("uses the title input's editing command, canonical mutation callback, and focus selection", () => {
    const input = document.createElement("input");
    input.value = "wrng title";
    document.body.append(input);
    const onTitleChange = vi.fn();
    const replaceSelection = vi.fn(() => {
      input.setRangeText("wrong", 0, 4, "select");
      return true;
    });
    expect(replaceTitleIssue({
      input,
      issue: issue("paper-title", 0, 4, "wrng"),
      generation: 4,
      language: "en",
      suggestion: "wrong",
      onTitleChange,
      replaceSelection,
    })).toBe("replaced");
    expect(input.value).toBe("wrong title");
    expect(onTitleChange).toHaveBeenCalledWith("wrong title");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it("reports an undo-preservation blocker instead of mutating when the editing command is unavailable", () => {
    const input = document.createElement("input");
    input.value = "wrng";
    expect(replaceTitleIssue({
      input,
      issue: issue("paper-title", 0, 4, "wrng"),
      generation: 4,
      language: "en",
      suggestion: "wrong",
      onTitleChange: vi.fn(),
      replaceSelection: () => false,
    })).toBe("undo-unavailable");
    expect(input.value).toBe("wrng");
  });

  it("verifies durable actions before mutation and restores exact source focus and selection", () => {
    const input = document.createElement("input");
    input.value = "wrng title";
    document.body.append(input);
    const mutate = vi.fn(() => true);
    const target = issue("paper-title", 0, 4, "wrng");
    expect(applyDurableIssueAction({
      issue: target,
      generation: 5,
      language: "en",
      titleInput: input,
      mutate,
    })).toBe(false);
    expect(mutate).not.toHaveBeenCalled();

    expect(applyDurableIssueAction({
      issue: target,
      generation: 4,
      language: "en",
      titleInput: input,
      mutate,
    })).toBe(true);
    expect(mutate).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);

    input.value = "gone title";
    expect(applyDurableIssueAction({
      issue: target,
      generation: 4,
      language: "en",
      titleInput: input,
      mutate,
    })).toBe(false);
    expect(mutate).toHaveBeenCalledOnce();
  });
});
