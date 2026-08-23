<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import type { Essay } from "$lib/model/essay";
  import Modal from "$lib/components/Modal.svelte";
  import type { SpellingService } from "./types";
  import SpellingExperienceEditorAddon from "./SpellingExperienceEditorAddon.svelte";

  interface Props {
    essay: Essay;
    editor: Editor;
    service: SpellingService;
  }

  let { essay, editor, service }: Props = $props();
  let formOpen = $state(false);
  let coverInput = $state<HTMLInputElement>();
  let formInput = $state<HTMLInputElement>();
  let draft = $state("");
</script>

<div class="app">
  <input data-title-owner="cover" bind:this={coverInput} value={essay.titlePage.title} />
  <button type="button" data-open-title onclick={() => {
    draft = essay.titlePage.title;
    formOpen = true;
  }}>Open title</button>
  <SpellingExperienceEditorAddon
    {essay}
    {editor}
    titleInput={formInput ?? coverInput}
    titleFormOpen={formOpen}
    title={essay.titlePage.title}
    doc={editor.getJSON()}
    documentLanguage={essay.settings.documentLanguage}
    onTitleChange={(value) => (essay.titlePage.title = value)}
    onEssayMutation={() => undefined}
    onOpenTitleForm={() => {
      draft = essay.titlePage.title;
      formOpen = true;
    }}
    {service}
  />
</div>

{#if formOpen}
  <Modal title="Title" dismissOnOverlay={false} onClose={() => (formOpen = false)}>
    <input data-title-owner="form" bind:this={formInput} bind:value={draft} />
    <button type="button" data-close-title onclick={() => (formOpen = false)}>Close title</button>
  </Modal>
{/if}
