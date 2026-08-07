<script lang="ts">
  import type { Editor as TiptapEditor } from "@tiptap/core";
  import Editor from "./Editor.svelte";

  interface Props {
    initialDoc: unknown;
    onLaunchConsumed: () => void;
    onReady: (editor: TiptapEditor) => void;
  }

  let { initialDoc, onLaunchConsumed, onReady }: Props = $props();
  let launch = $state({ id: "new-paper", newlyCreated: true });
  const editorKey = "new-paper";
  const citationEnv = { refsById: new Map(), locale: "en" as const };
  const referenceEnv = {
    references: [],
    locale: "en" as const,
    emptyLabel: "No references yet",
  };

  function consumeLaunch() {
    launch = { ...launch, newlyCreated: false };
    onLaunchConsumed();
  }
</script>

{#key editorKey}
  <Editor
    {initialDoc}
    newlyCreated={launch.newlyCreated}
    documentLanguage="en"
    {citationEnv}
    {referenceEnv}
    onLaunchConsumed={consumeLaunch}
    {onReady}
  />
{/key}
