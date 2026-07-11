<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import { createTesinaEditor } from "$lib/editor/createEditor";
  import "$lib/editor/apa.css";

  interface Props {
    initialDoc?: unknown;
    onUpdate?: (docJson: unknown, words: number) => void;
  }

  let { initialDoc, onUpdate }: Props = $props();

  const mountEditor: Attachment<HTMLDivElement> = (element) => {
    const editor = createTesinaEditor({
      element,
      content: initialDoc,
      onUpdate,
    });
    return () => editor.destroy();
  };
</script>

<div class="apa-editor" {@attach mountEditor}></div>
