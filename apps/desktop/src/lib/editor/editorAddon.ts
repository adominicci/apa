import type { Editor } from "@tiptap/core";
import type { DocLocale } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";

export interface EditorAddonProps {
  essay: Essay;
  editor?: Editor;
  titleInput?: HTMLInputElement;
  titleFormOpen: boolean;
  title: string;
  doc: unknown;
  documentLanguage: DocLocale;
  onTitleChange: (value: string) => void;
  onEssayMutation: () => void;
  onOpenTitleForm: () => void;
}
