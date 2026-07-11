<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    editor: Editor | undefined;
  }

  let { editor }: Props = $props();

  // TipTap's isActive() state lives outside Svelte's reactivity, so this
  // version counter bridges it in: the $effect only subscribes/unsubscribes;
  // the assignment happens later, inside TipTap's event callback.
  let tick = $state(0);

  $effect(() => {
    if (!editor) return;
    const bump = () => {
      tick += 1;
    };
    editor.on("transaction", bump);
    editor.on("selectionUpdate", bump);
    return () => {
      editor.off("transaction", bump);
      editor.off("selectionUpdate", bump);
    };
  });

  function active(name: string, attrs?: Record<string, unknown>): boolean {
    void tick;
    return editor?.isActive(name, attrs) ?? false;
  }

  const HEADING_LEVELS = [1, 2, 3, 4, 5] as const;
</script>

<div class="toolbar" role="toolbar" aria-label={m.toolbar_aria()}>
  <span class="group">
    <button
      class="ic bold"
      class:on={active("bold")}
      onclick={() => editor?.chain().focus().toggleBold().run()}
      disabled={!editor}
      aria-label={m.toolbar_bold()}
    >
      B
    </button>
    <button
      class="ic italic"
      class:on={active("italic")}
      onclick={() => editor?.chain().focus().toggleItalic().run()}
      disabled={!editor}
      aria-label={m.toolbar_italic()}
    >
      I
    </button>
    <button
      class="ic underline"
      class:on={active("underline")}
      onclick={() => editor?.chain().focus().toggleUnderline().run()}
      disabled={!editor}
      aria-label={m.toolbar_underline()}
    >
      U
    </button>
  </span>
  <span class="group">
    {#each HEADING_LEVELS as level (level)}
      <button
        class="ic"
        class:on={active("heading", { level })}
        onclick={() =>
          editor?.chain().focus().toggleHeading({ level }).run()}
        disabled={!editor}
        aria-label={m.toolbar_heading_level({ level })}
      >
        T{level}
      </button>
    {/each}
  </span>
  <span class="group">
    <button
      class="ic"
      class:on={active("blockquote")}
      onclick={() => editor?.chain().focus().toggleBlockquote().run()}
      disabled={!editor}
      aria-label={m.toolbar_blockquote()}
    >
      ❝
    </button>
    <button
      class="ic"
      class:on={active("bulletList")}
      onclick={() => editor?.chain().focus().toggleBulletList().run()}
      disabled={!editor}
      aria-label={m.toolbar_bullet_list()}
    >
      ••
    </button>
    <button
      class="ic"
      class:on={active("orderedList")}
      onclick={() => editor?.chain().focus().toggleOrderedList().run()}
      disabled={!editor}
      aria-label={m.toolbar_ordered_list()}
    >
      1.
    </button>
  </span>
  <span class="apa-hint">{m.toolbar_apa_hint()}</span>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 14px;
    border-bottom: 1px solid #e0deda;
    background: #f6f5f2;
    flex-wrap: wrap;
  }

  .group {
    display: flex;
    gap: 2px;
    padding-right: 10px;
    border-right: 1px solid #e0deda;
  }

  .ic {
    min-width: 26px;
    height: 24px;
    border: none;
    background: transparent;
    border-radius: 5px;
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    color: #44433e;
    padding: 0 5px;
  }

  .ic:hover:enabled {
    background: #eceae5;
  }

  .ic.on {
    background: #eaf1fe;
    color: #173a8c;
    font-weight: 600;
  }

  .ic:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .bold {
    font-weight: 700;
  }

  .italic {
    font-style: italic;
    font-family: Georgia, serif;
  }

  .underline {
    text-decoration: underline;
  }

  .apa-hint {
    margin-left: auto;
    font-size: 0.7rem;
    color: #a09e96;
  }

  @media (prefers-color-scheme: dark) {
    .toolbar {
      background: #232320;
      border-color: #373632;
    }

    .group {
      border-color: #373632;
    }

    .ic {
      color: #c9c7c0;
    }

    .ic:hover:enabled {
      background: #2b2b28;
    }

    .ic.on {
      background: #1d2c50;
      color: #b7cdfa;
    }

    .apa-hint {
      color: #6f6e67;
    }
  }
</style>
