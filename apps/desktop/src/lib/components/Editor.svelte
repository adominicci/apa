<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import type { Editor } from "@tiptap/core";
  import type { DocLocale } from "@tesina/engine";
  import type { CitationEnv } from "$lib/editor/citation";
  import { createTesinaEditor } from "$lib/editor/createEditor";
  import "$lib/editor/apa.css";

  interface Props {
    initialDoc?: unknown;
    documentLanguage?: DocLocale;
    citationEnv: CitationEnv;
    onUpdate?: (docJson: unknown, words: number) => void;
    onReady?: (editor: Editor) => void;
    onEditEquation?: (pos: number, latex: string) => void;
  }

  let {
    initialDoc,
    documentLanguage = "es",
    citationEnv,
    onUpdate,
    onReady,
    onEditEquation,
  }: Props = $props();

  const mountEditor: Attachment<HTMLDivElement> = (element) => {
    const editor = createTesinaEditor({
      element,
      content: initialDoc,
      citationEnv,
      onUpdate,
      onEditEquation,
    });
    onReady?.(editor);
    return () => editor.destroy();
  };
</script>

<div class="apa-editor" data-doclang={documentLanguage}>
  <article class="paper-sheet">
    <div class="paper-body" {@attach mountEditor}></div>
  </article>
</div>
