import type { Editor } from "@tiptap/core";
import type { DocumentLanguage } from "./types.ts";
import type { ExperienceSpellingIssue } from "./controller.ts";
import { canonicalizeTerm } from "./canonicalTerms.ts";

interface SourceReaders {
  title: (from: number, to: number) => string;
  body: (from: number, to: number) => string;
}

interface DurableIssueActionArgs {
  issue: ExperienceSpellingIssue;
  generation: number;
  language: DocumentLanguage;
  titleInput?: HTMLInputElement;
  editor?: Editor;
  mutate: () => boolean | void;
}

export function verifyCurrentIssue(
  issue: ExperienceSpellingIssue,
  generation: number,
  readers: SourceReaders,
  language: DocumentLanguage,
): boolean {
  if (
    issue.generation !== generation || issue.from < 0 || issue.to <= issue.from
  ) {
    return false;
  }
  const current = issue.source === "paper-title"
    ? readers.title(issue.from, issue.to)
    : readers.body(issue.from, issue.to);
  return current === issue.word &&
    canonicalizeTerm(current, language)?.key === issue.termKey;
}

export function applyDurableIssueAction({
  issue,
  generation,
  language,
  titleInput,
  editor,
  mutate,
}: DurableIssueActionArgs): boolean {
  const valid = verifyCurrentIssue(issue, generation, {
    title: (from, to) => titleInput?.value.slice(from, to) ?? "",
    body: (from, to) => editor?.state.doc.textBetween(from, to, "", "") ?? "",
  }, language);
  if (!valid || mutate() === false) return false;
  if (issue.source === "paper-title" && titleInput) {
    titleInput.focus();
    titleInput.setSelectionRange(issue.from, issue.to);
  } else if (issue.source === "body" && editor) {
    editor.commands.focus();
    editor.commands.setTextSelection({ from: issue.from, to: issue.to });
  }
  return true;
}

export function replaceBodyIssue(
  editor: Editor,
  issue: ExperienceSpellingIssue,
  generation: number,
  suggestion: string,
  language: DocumentLanguage,
): boolean {
  if (issue.source !== "body") return false;
  const valid = verifyCurrentIssue(issue, generation, {
    title: () => "",
    body: (from, to) => editor.state.doc.textBetween(from, to, "", ""),
  }, language);
  if (!valid) return false;
  const transaction = editor.state.tr.insertText(
    suggestion,
    issue.from,
    issue.to,
  );
  editor.view.dispatch(transaction);
  editor.commands.focus();
  editor.commands.setTextSelection({
    from: issue.from,
    to: issue.from + suggestion.length,
  });
  return true;
}

interface ReplaceTitleArgs {
  input: HTMLInputElement;
  issue: ExperienceSpellingIssue;
  generation: number;
  language: DocumentLanguage;
  suggestion: string;
  onTitleChange: (title: string) => void;
  /** Injectable only for deterministic browser tests. The default uses the
   * webview's editing command so the native input undo manager owns the edit. */
  replaceSelection?: () => boolean;
}

export function replaceTitleIssue({
  input,
  issue,
  generation,
  language,
  suggestion,
  onTitleChange,
  replaceSelection,
}: ReplaceTitleArgs): "replaced" | "stale" | "undo-unavailable" {
  if (
    issue.source !== "paper-title" ||
    !verifyCurrentIssue(issue, generation, {
      title: (from, to) => input.value.slice(from, to),
      body: () => "",
    }, language)
  ) return "stale";
  input.focus();
  input.setSelectionRange(issue.from, issue.to);
  const replace = replaceSelection ??
    (() =>
      typeof document.execCommand === "function" &&
      document.execCommand("insertText", false, suggestion));
  if (!replace()) return "undo-unavailable";
  onTitleChange(input.value);
  input.focus();
  input.setSelectionRange(issue.from, issue.from + suggestion.length);
  return "replaced";
}
