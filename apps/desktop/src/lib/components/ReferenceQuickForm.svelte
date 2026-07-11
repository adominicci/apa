<script lang="ts">
  import type { Contributor, Reference } from "@tesina/engine";

  interface Props {
    onSave: (ref: Reference) => void;
    onClose: () => void;
  }

  let { onSave, onClose }: Props = $props();

  type QuickType = "journalArticle" | "book" | "website";

  let type = $state<QuickType>("journalArticle");
  let authorsText = $state("");
  let year = $state("");
  let noDate = $state(false);
  let title = $state("");
  let journal = $state("");
  let volume = $state("");
  let issue = $state("");
  let pages = $state("");
  let publisher = $state("");
  let siteName = $state("");
  let url = $state("");
  let doi = $state("");

  const canSave = $derived(
    title.trim() !== "" &&
      (noDate || year.trim() !== "") &&
      (type !== "journalArticle" || journal.trim() !== ""),
  );

  /** One contributor per line: "Apellido, Nombre" or a group name. */
  function parseAuthors(text: string): Contributor[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line): Contributor => {
        const comma = line.indexOf(",");
        if (comma === -1) return { kind: "group", name: line };
        const family = line.slice(0, comma).trim();
        const given = line.slice(comma + 1).trim();
        return given === ""
          ? { kind: "person", family }
          : { kind: "person", family, given };
      });
  }

  function save() {
    if (!canSave) return;
    const base = {
      id: crypto.randomUUID(),
      authors: parseAuthors(authorsText),
      date: noDate
        ? { noDate: true as const }
        : { year: Number.parseInt(year, 10) },
      title: title.trim(),
      ...(doi.trim() !== "" ? { doi: doi.trim() } : {}),
      ...(url.trim() !== "" ? { url: url.trim() } : {}),
    };

    let ref: Reference;
    if (type === "journalArticle") {
      const [pageStart, pageEnd] = pages.split(/[–-]/).map((p) => p.trim());
      ref = {
        ...base,
        type: "journalArticle",
        journal: journal.trim(),
        ...(volume.trim() !== "" ? { volume: volume.trim() } : {}),
        ...(issue.trim() !== "" ? { issue: issue.trim() } : {}),
        ...(pageStart ? { pageStart } : {}),
        ...(pageEnd ? { pageEnd } : {}),
      };
    } else if (type === "book") {
      ref = {
        ...base,
        type: "book",
        ...(publisher.trim() !== "" ? { publisher: publisher.trim() } : {}),
      };
    } else {
      ref = {
        ...base,
        type: "website",
        ...(siteName.trim() !== "" ? { siteName: siteName.trim() } : {}),
      };
    }
    onSave(ref);
  }
</script>

<div class="overlay" role="presentation">
  <div class="modal" role="dialog" aria-label="Añadir referencia">
    <div class="row head">
      <strong>Añadir referencia</strong>
      <button class="close" onclick={onClose} aria-label="Cerrar">×</button>
    </div>

    <div class="seg" role="group" aria-label="Tipo de fuente">
      <button
        class:active={type === "journalArticle"}
        onclick={() => (type = "journalArticle")}
      >
        Artículo
      </button>
      <button class:active={type === "book"} onclick={() => (type = "book")}>
        Libro
      </button>
      <button
        class:active={type === "website"}
        onclick={() => (type = "website")}
      >
        Página web
      </button>
    </div>

    <label>
      Autores — uno por línea: "Apellido, Nombre" (o nombre de organización)
      <textarea rows="3" bind:value={authorsText} placeholder="Salgado, Nora"
      ></textarea>
    </label>

    <div class="row">
      <label class="grow">
        Año
        <input
          type="text"
          bind:value={year}
          placeholder="2020"
          disabled={noDate}
        />
      </label>
      <label class="checkline">
        <input type="checkbox" bind:checked={noDate} /> Sin fecha
      </label>
    </div>

    <label>
      Título
      <input type="text" bind:value={title} />
    </label>

    {#if type === "journalArticle"}
      <label>
        Revista
        <input type="text" bind:value={journal} />
      </label>
      <div class="row">
        <label class="grow">
          Volumen
          <input type="text" bind:value={volume} />
        </label>
        <label class="grow">
          Número
          <input type="text" bind:value={issue} />
        </label>
        <label class="grow">
          Páginas
          <input type="text" bind:value={pages} placeholder="45–67" />
        </label>
      </div>
      <label>
        DOI
        <input type="text" bind:value={doi} placeholder="10.1234/abcd" />
      </label>
    {:else if type === "book"}
      <label>
        Editorial
        <input type="text" bind:value={publisher} />
      </label>
      <label>
        DOI o URL (opcional)
        <input type="text" bind:value={url} />
      </label>
    {:else}
      <label>
        Nombre del sitio
        <input type="text" bind:value={siteName} />
      </label>
      <label>
        URL
        <input type="text" bind:value={url} placeholder="https://…" />
      </label>
    {/if}

    <button class="save" onclick={save} disabled={!canSave}>
      Guardar referencia
    </button>
    <p class="hint">
      El autollenado por DOI/ISBN/URL y los demás tipos de fuente llegan en el
      hito M3.
    </p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 18, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .modal {
    width: min(440px, calc(100vw - 2rem));
    max-height: calc(100vh - 4rem);
    overflow-y: auto;
    background: #fff;
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 0.82rem;
    color: #26251f;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
  }

  .row {
    display: flex;
    gap: 10px;
    align-items: end;
  }

  .head {
    align-items: center;
    justify-content: space-between;
  }

  .close {
    border: none;
    background: transparent;
    font-size: 1rem;
    cursor: pointer;
    color: #6b6a64;
  }

  .grow {
    flex: 1;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: #44433e;
  }

  .checkline {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    padding-bottom: 7px;
    white-space: nowrap;
  }

  input[type="text"],
  textarea {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid #d7d4cf;
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }

  input:disabled {
    opacity: 0.5;
  }

  .seg {
    display: flex;
    border: 1px solid #d7d4cf;
    border-radius: 7px;
    overflow: hidden;
    align-self: start;
  }

  .seg button {
    border: none;
    background: transparent;
    font: inherit;
    font-size: 0.78rem;
    padding: 5px 12px;
    cursor: pointer;
    color: #6b6a64;
  }

  .seg button.active {
    background: #eaf1fe;
    color: #173a8c;
    font-weight: 600;
  }

  .save {
    border: none;
    background: #2158d6;
    color: #fff;
    font: inherit;
    padding: 8px 10px;
    border-radius: 7px;
    cursor: pointer;
  }

  .save:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .hint {
    margin: 0;
    color: #8a887f;
    font-size: 0.75rem;
  }

  @media (prefers-color-scheme: dark) {
    .modal {
      background: #232320;
      color: #e8e6e1;
    }

    label {
      color: #c9c7c0;
    }

    input[type="text"],
    textarea,
    .seg {
      border-color: #45443f;
      background: #1c1c1a;
      color: #e8e6e1;
    }

    .seg button {
      color: #a3a19a;
    }

    .seg button.active {
      background: #1d2c50;
      color: #b7cdfa;
    }

    .close,
    .hint {
      color: #8a887f;
    }
  }
</style>
