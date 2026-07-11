<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import type { Editor } from "@tiptap/core";
  import type { DocLocale } from "@tesina/engine";
  import { createTesinaEditor } from "$lib/editor/createEditor";
  import "$lib/editor/apa.css";

  interface Props {
    initialDoc?: unknown;
    documentLanguage?: DocLocale;
    onUpdate?: (docJson: unknown, words: number) => void;
    onReady?: (editor: Editor) => void;
  }

  let {
    initialDoc,
    documentLanguage = "es",
    onUpdate,
    onReady,
  }: Props = $props();

  const mountEditor: Attachment<HTMLDivElement> = (element) => {
    const editor = createTesinaEditor({
      element,
      content: initialDoc,
      onUpdate,
    });
    onReady?.(editor);
    return () => editor.destroy();
  };
</script>

<div class="apa-editor" data-doclang={documentLanguage} {@attach mountEditor}>
</div>
