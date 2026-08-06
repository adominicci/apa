<script lang="ts">
  import { untrack } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import Modal from "$lib/components/Modal.svelte";
  import { latexToMathml } from "$lib/editor/mathml";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    /** Current LaTeX when editing an existing equation; empty when inserting. */
    initialLatex?: string;
    editing?: boolean;
    onConfirm: (latex: string) => void;
    onClose: () => void;
  }

  let {
    initialLatex = "",
    editing = false,
    onConfirm,
    onClose,
  }: Props = $props();

  // The dialog is always freshly mounted per open — EditorScreen sets
  // equationDialog back to null before opening the next one — so capturing
  // the initial value once here is deliberate, mirroring EditorScreen's own
  // essayTitle/documentLanguage captures.
  let latex = $state(untrack(() => initialLatex));

  /*
   * Live preview through the exact same renderToString + innerHTML path the
   * node view uses (see mathml.ts / blocks.ts) — never `temml.render()`.
   * `latexToMathml` throws on invalid LaTeX (`\frac{`, `\sqrt{x`, `x^`…), so
   * this has to catch it and show a message instead of taking the dialog
   * down with it.
   */
  const preview = $derived.by((): { html: string | null; error: boolean } => {
    const trimmed = latex.trim();
    if (trimmed === "") return { html: null, error: false };
    try {
      return { html: latexToMathml(trimmed), error: false };
    } catch {
      return { html: null, error: true };
    }
  });

  /*
   * Sets innerHTML through an attachment instead of `{@html}` — identical to
   * how the node view renders MathML (blocks.ts): `latexToMathml`'s output
   * is Temml's own MathML markup, not arbitrary HTML from outside the app.
   */
  function renderMath(html: string): Attachment<HTMLDivElement> {
    return (node) => {
      node.innerHTML = html;
    };
  }

  function confirm() {
    const trimmed = latex.trim();
    if (trimmed === "") return;
    onConfirm(trimmed);
  }
</script>

<Modal title={editing ? m.equation_edit() : m.equation_insert()} {onClose}>
  <label class="field">
    <span>{m.equation_latex_label()}</span>
    <textarea
      rows="4"
      bind:value={latex}
      placeholder={m.equation_latex_placeholder()}
    ></textarea>
  </label>

  <div class="field">
    <span>{m.equation_preview_label()}</span>
    <div class="eq-preview">
      {#if preview.html}
        <div class="eq-preview-math" {@attach renderMath(preview.html)}></div>
      {:else if preview.error}
        <p class="eq-preview-msg eq-preview-error">
          {m.equation_preview_error()}
        </p>
      {:else}
        <p class="eq-preview-msg">{m.equation_preview_empty()}</p>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <button class="btn btn-ghost" onclick={onClose}>{m.common_close()}</button>
    <button
      class="btn btn-primary"
      onclick={confirm}
      disabled={latex.trim() === ""}
    >
      {editing ? m.equation_save() : m.equation_insert()}
    </button>
  {/snippet}
</Modal>

<style>
  .eq-preview {
    min-height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--chrome);
    overflow-x: auto;
  }

  .eq-preview-msg {
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
  }

  .eq-preview-error {
    color: var(--danger);
  }
</style>
