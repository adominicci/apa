<script lang="ts">
  import type { Essay } from "$lib/model/essay";
  import type { EditorAddonProps } from "./editorAddon";

  interface Props extends EditorAddonProps {
    essay: Essay;
  }

  let { essay, titleInput, onEssayMutation }: Props = $props();

  function persistDocumentIgnore() {
    essay.spelling = { documentIgnores: { en: ["Tesina"] } };
    onEssayMutation();
  }
</script>

<button
  type="button"
  data-test-editor-addon
  data-has-title-input={Boolean(titleInput)}
  data-title-input-owner={titleInput?.closest('[role="dialog"]') ? "form" : "cover"}
  onclick={persistDocumentIgnore}
>Test editor addon</button>
