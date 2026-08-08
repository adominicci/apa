<script lang="ts">
  import { untrack } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import type { Editor } from "@tiptap/core";
  import type { DocLocale } from "@tesina/engine";
  import type { CitationEnv } from "$lib/editor/citation";
  import { createTesinaEditor } from "$lib/editor/createEditor";
  import type { ReferenceDecorationEnv } from "$lib/editor/referenceDecoration";
  import "$lib/editor/apa.css";

  interface Props {
    initialDoc?: unknown;
    newlyCreated: boolean;
    documentLanguage?: DocLocale;
    citationEnv: CitationEnv;
    referenceEnv: ReferenceDecorationEnv;
    onUpdate?: (docJson: unknown, words: number) => void;
    onReady?: (editor: Editor) => void;
    onLaunchConsumed?: () => void;
    onEditEquation?: (pos: number, latex: string) => void;
  }

  let {
    initialDoc,
    newlyCreated,
    documentLanguage = "es",
    citationEnv,
    referenceEnv,
    onUpdate,
    onReady,
    onLaunchConsumed,
    onEditEquation,
  }: Props = $props();

  const mountEditor: Attachment<HTMLDivElement> = (element) => {
    const editor = untrack(() => {
      const instance = createTesinaEditor({
        element,
        content: initialDoc,
        newlyCreated,
        citationEnv,
        referenceEnv,
        onUpdate,
        onEditEquation,
      });
      onReady?.(instance);
      if (newlyCreated) onLaunchConsumed?.();
      return instance;
    });
    return () => untrack(() => editor.destroy());
  };
</script>

<div class="apa-editor" data-doclang={documentLanguage}>
  <div class="page-stack" {@attach mountEditor}></div>
</div>
