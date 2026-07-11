<script lang="ts">
  import type {
    APADate,
    Contributor,
    Reference,
    ReferenceType,
  } from "@tesina/engine";
  import { detectInput } from "$lib/autofill/detect";
  import {
    type AutofillError,
    lookupDoi,
    lookupIsbn,
  } from "$lib/autofill/client";
  import {
    emptyQuickFields,
    type QuickFields,
    refToQuickFields,
  } from "$lib/autofill/fill";

  interface Props {
    onSave: (ref: Reference) => void;
    onClose: () => void;
  }

  let { onSave, onClose }: Props = $props();

  const TYPE_OPTIONS: { value: ReferenceType; label: string }[] = [
    { value: "journalArticle", label: "Artículo de revista académica" },
    { value: "book", label: "Libro" },
    { value: "bookChapter", label: "Capítulo de libro editado" },
    { value: "website", label: "Página web" },
    { value: "report", label: "Informe" },
    { value: "thesis", label: "Tesis" },
    { value: "conferencePaper", label: "Ponencia de congreso" },
    { value: "newspaperArticle", label: "Periódico o revista" },
    { value: "referenceEntry", label: "Entrada de diccionario" },
    { value: "video", label: "Video" },
    { value: "podcastEpisode", label: "Episodio de podcast" },
    { value: "socialMedia", label: "Publicación en red social" },
    { value: "software", label: "Software o conjunto de datos" },
    { value: "personalCommunication", label: "Comunicación personal" },
  ];

  let f = $state<QuickFields>(emptyQuickFields());
  let lookupText = $state("");
  let looking = $state(false);
  let lookupError = $state("");
  let autofilled = $state(false);

  const ERROR_MESSAGES: Record<AutofillError | "unknown-input", string> = {
    offline: "Sin conexión o el servicio no respondió. Intenta de nuevo.",
    "not-found": "No se encontró ese DOI/ISBN.",
    unsupported: "Tipo de obra aún no soportado por el autollenado.",
    parse: "El servicio devolvió una respuesta inesperada.",
    "unknown-input": "Eso no parece un DOI ni un ISBN.",
  };

  const canSave = $derived.by(() => {
    if (f.type === "personalCommunication") {
      return f.authorsText.trim() !== "" && (f.noDate || f.year.trim() !== "");
    }
    if (f.title.trim() === "") return false;
    if (!f.noDate && f.year.trim() === "") return false;
    switch (f.type) {
      case "journalArticle":
        return f.journal.trim() !== "";
      case "bookChapter":
        return f.bookTitle.trim() !== "";
      case "thesis":
        return f.institution.trim() !== "";
      case "conferencePaper":
        return f.conferenceName.trim() !== "";
      case "newspaperArticle":
        return f.publication.trim() !== "";
      case "referenceEntry":
        return f.workTitle.trim() !== "";
      case "video":
        return f.platform.trim() !== "";
      case "podcastEpisode":
        return f.showTitle.trim() !== "";
      case "socialMedia":
        return f.platform.trim() !== "" && f.contentType.trim() !== "";
      default:
        return true;
    }
  });

  async function lookup() {
    lookupError = "";
    autofilled = false;
    const detected = detectInput(lookupText);
    if (detected.kind !== "doi" && detected.kind !== "isbn") {
      lookupError = ERROR_MESSAGES["unknown-input"];
      return;
    }
    looking = true;
    try {
      const result = detected.kind === "doi"
        ? await lookupDoi(detected.value)
        : await lookupIsbn(detected.value);
      if (!result.ok) {
        lookupError = ERROR_MESSAGES[result.error];
        return;
      }
      f = refToQuickFields(result.ref);
      autofilled = true;
    } finally {
      looking = false;
    }
  }

  /** One contributor per line: "Apellido, Nombre" or a group name. */
  function parseContributors(text: string): Contributor[] {
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

  function buildDate(): APADate {
    if (f.noDate) return { noDate: true };
    const date: APADate = { year: Number.parseInt(f.year, 10) };
    const month = Number.parseInt(f.month, 10);
    const day = Number.parseInt(f.day, 10);
    if (month >= 1 && month <= 12) {
      date.month = month;
      if (day >= 1 && day <= 31) date.day = day;
    }
    return date;
  }

  function opt(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  function splitPages(): { pageStart?: string; pageEnd?: string } {
    const [start, end] = f.pages.split(/[–-]/).map((p) => p.trim());
    return {
      ...(start ? { pageStart: start } : {}),
      ...(end ? { pageEnd: end } : {}),
    };
  }

  function save() {
    if (!canSave) return;
    const base = {
      id: crypto.randomUUID(),
      authors: parseContributors(f.authorsText),
      date: buildDate(),
      title: f.title.trim() ||
        (f.type === "personalCommunication" ? "Comunicación personal" : ""),
      ...(opt(f.doi) ? { doi: opt(f.doi)! } : {}),
      ...(opt(f.url) ? { url: opt(f.url)! } : {}),
    };

    let ref: Reference;
    switch (f.type) {
      case "journalArticle":
        ref = {
          ...base,
          type: "journalArticle",
          journal: f.journal.trim(),
          ...(opt(f.volume) ? { volume: opt(f.volume)! } : {}),
          ...(opt(f.issue) ? { issue: opt(f.issue)! } : {}),
          ...splitPages(),
        };
        break;
      case "book":
        ref = {
          ...base,
          type: "book",
          ...(opt(f.publisher) ? { publisher: opt(f.publisher)! } : {}),
          ...(opt(f.edition) ? { edition: opt(f.edition)! } : {}),
        };
        break;
      case "bookChapter":
        ref = {
          ...base,
          type: "bookChapter",
          editors: parseContributors(f.editorsText),
          bookTitle: f.bookTitle.trim(),
          ...(opt(f.edition) ? { edition: opt(f.edition)! } : {}),
          ...splitPages(),
          ...(opt(f.publisher) ? { publisher: opt(f.publisher)! } : {}),
        };
        break;
      case "website":
        ref = {
          ...base,
          type: "website",
          ...(opt(f.siteName) ? { siteName: opt(f.siteName)! } : {}),
        };
        break;
      case "report":
        ref = {
          ...base,
          type: "report",
          ...(opt(f.institution) ? { institution: opt(f.institution)! } : {}),
          ...(opt(f.reportNumber)
            ? { reportNumber: opt(f.reportNumber)! }
            : {}),
        };
        break;
      case "thesis":
        ref = {
          ...base,
          type: "thesis",
          thesisType: f.thesisType,
          institution: f.institution.trim(),
          ...(f.unpublished ? { unpublished: true } : {}),
          ...(!f.unpublished && opt(f.archive)
            ? { archive: opt(f.archive)! }
            : {}),
        };
        break;
      case "conferencePaper": {
        const dayEnd = Number.parseInt(f.dayEnd, 10);
        ref = {
          ...base,
          type: "conferencePaper",
          conferenceName: f.conferenceName.trim(),
          ...(opt(f.location) ? { location: opt(f.location)! } : {}),
          ...(dayEnd >= 1 && dayEnd <= 31 ? { dayEnd } : {}),
        };
        break;
      }
      case "newspaperArticle":
        ref = {
          ...base,
          type: "newspaperArticle",
          publication: f.publication.trim(),
          ...(opt(f.volume) ? { volume: opt(f.volume)! } : {}),
          ...(opt(f.issue) ? { issue: opt(f.issue)! } : {}),
          ...splitPages(),
        };
        break;
      case "referenceEntry":
        ref = {
          ...base,
          type: "referenceEntry",
          workTitle: f.workTitle.trim(),
          ...(opt(f.edition) ? { edition: opt(f.edition)! } : {}),
          ...(opt(f.publisher) ? { publisher: opt(f.publisher)! } : {}),
        };
        break;
      case "video":
        ref = {
          ...base,
          type: "video",
          ...(opt(f.username) ? { username: opt(f.username)! } : {}),
          platform: f.platform.trim(),
        };
        break;
      case "podcastEpisode":
        ref = {
          ...base,
          type: "podcastEpisode",
          ...(opt(f.episodeNumber)
            ? { episodeNumber: opt(f.episodeNumber)! }
            : {}),
          showTitle: f.showTitle.trim(),
          ...(opt(f.platform) ? { platform: opt(f.platform)! } : {}),
        };
        break;
      case "socialMedia":
        ref = {
          ...base,
          type: "socialMedia",
          ...(opt(f.username) ? { username: opt(f.username)! } : {}),
          platform: f.platform.trim(),
          contentType: f.contentType.trim(),
        };
        break;
      case "software":
        ref = {
          ...base,
          type: "software",
          kind: f.softwareKind,
          ...(opt(f.version) ? { version: opt(f.version)! } : {}),
          ...(opt(f.publisher) ? { publisher: opt(f.publisher)! } : {}),
        };
        break;
      case "personalCommunication":
        ref = { ...base, type: "personalCommunication" };
        break;
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

    <div class="lookup" class:filled={autofilled}>
      <div class="row">
        <input
          type="text"
          bind:value={lookupText}
          placeholder="Pega un DOI o ISBN y rellena el resto solo"
          onkeydown={(e) => {
            if (e.key === "Enter") lookup();
          }}
        />
        <button
          class="find"
          onclick={lookup}
          disabled={looking || lookupText.trim() === ""}
        >
          {looking ? "Buscando…" : "Buscar"}
        </button>
      </div>
      {#if lookupError}
        <p class="lookup-error">{lookupError}</p>
      {:else if autofilled}
        <p class="lookup-ok">
          Formulario prellenado — revisa los datos antes de guardar.
        </p>
      {/if}
    </div>

    <label>
      Tipo de fuente
      <select bind:value={f.type}>
        {#each TYPE_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>

    {#if f.type === "personalCommunication"}
      <p class="notice">
        Las comunicaciones personales se citan solo en el texto y nunca
        aparecen en la lista de referencias (APA 8.9).
      </p>
    {/if}

    <label>
      Autores — uno por línea: "Apellido, Nombre" (o nombre de organización)
      <textarea rows="3" bind:value={f.authorsText} placeholder="Salgado, Nora"
      ></textarea>
    </label>

    <div class="row">
      <label class="grow">
        Año
        <input type="text" bind:value={f.year} disabled={f.noDate} />
      </label>
      <label class="grow">
        Mes (1–12)
        <input type="text" bind:value={f.month} disabled={f.noDate} />
      </label>
      <label class="grow">
        Día
        <input type="text" bind:value={f.day} disabled={f.noDate} />
      </label>
      <label class="checkline">
        <input type="checkbox" bind:checked={f.noDate} /> Sin fecha
      </label>
    </div>

    {#if f.type !== "personalCommunication"}
      <label>
        Título
        <input type="text" bind:value={f.title} />
      </label>
    {/if}

    {#if f.type === "journalArticle"}
      <label>
        Revista
        <input type="text" bind:value={f.journal} />
      </label>
      <div class="row">
        <label class="grow">
          Volumen
          <input type="text" bind:value={f.volume} />
        </label>
        <label class="grow">
          Número
          <input type="text" bind:value={f.issue} />
        </label>
        <label class="grow">
          Páginas
          <input type="text" bind:value={f.pages} placeholder="45–67" />
        </label>
      </div>
    {:else if f.type === "book"}
      <div class="row">
        <label class="grow">
          Editorial
          <input type="text" bind:value={f.publisher} />
        </label>
        <label class="grow">
          Edición (número)
          <input type="text" bind:value={f.edition} placeholder="2" />
        </label>
      </div>
    {:else if f.type === "bookChapter"}
      <label>
        Editores del libro — uno por línea
        <textarea rows="2" bind:value={f.editorsText}></textarea>
      </label>
      <label>
        Título del libro
        <input type="text" bind:value={f.bookTitle} />
      </label>
      <div class="row">
        <label class="grow">
          Edición
          <input type="text" bind:value={f.edition} />
        </label>
        <label class="grow">
          Páginas
          <input type="text" bind:value={f.pages} placeholder="85–104" />
        </label>
        <label class="grow">
          Editorial
          <input type="text" bind:value={f.publisher} />
        </label>
      </div>
    {:else if f.type === "website"}
      <label>
        Nombre del sitio
        <input type="text" bind:value={f.siteName} />
      </label>
    {:else if f.type === "report"}
      <div class="row">
        <label class="grow">
          Institución que publica
          <input type="text" bind:value={f.institution} />
        </label>
        <label class="grow">
          Número de informe
          <input type="text" bind:value={f.reportNumber} />
        </label>
      </div>
    {:else if f.type === "thesis"}
      <div class="seg" role="group" aria-label="Tipo de tesis">
        <button
          class:active={f.thesisType === "doctoral"}
          onclick={() => (f.thesisType = "doctoral")}
        >
          Doctoral
        </button>
        <button
          class:active={f.thesisType === "masters"}
          onclick={() => (f.thesisType = "masters")}
        >
          Maestría
        </button>
      </div>
      <label>
        Institución (universidad)
        <input type="text" bind:value={f.institution} />
      </label>
      <label class="checkline">
        <input type="checkbox" bind:checked={f.unpublished} /> Inédita (no
        publicada)
      </label>
      {#if !f.unpublished}
        <label>
          Repositorio o base de datos
          <input type="text" bind:value={f.archive} />
        </label>
      {/if}
    {:else if f.type === "conferencePaper"}
      <label>
        Nombre del congreso
        <input type="text" bind:value={f.conferenceName} />
      </label>
      <div class="row">
        <label class="grow">
          Lugar (Ciudad, País)
          <input type="text" bind:value={f.location} />
        </label>
        <label class="grow">
          Día final (si dura varios días)
          <input type="text" bind:value={f.dayEnd} placeholder="8" />
        </label>
      </div>
    {:else if f.type === "newspaperArticle"}
      <label>
        Nombre del periódico o revista
        <input type="text" bind:value={f.publication} />
      </label>
      <div class="row">
        <label class="grow">
          Volumen
          <input type="text" bind:value={f.volume} />
        </label>
        <label class="grow">
          Número
          <input type="text" bind:value={f.issue} />
        </label>
        <label class="grow">
          Páginas
          <input type="text" bind:value={f.pages} />
        </label>
      </div>
    {:else if f.type === "referenceEntry"}
      <label>
        Diccionario o enciclopedia
        <input type="text" bind:value={f.workTitle} />
      </label>
      <div class="row">
        <label class="grow">
          Edición
          <input type="text" bind:value={f.edition} />
        </label>
        <label class="grow">
          Editorial
          <input type="text" bind:value={f.publisher} />
        </label>
      </div>
    {:else if f.type === "video"}
      <div class="row">
        <label class="grow">
          Canal o nombre de usuario
          <input type="text" bind:value={f.username} />
        </label>
        <label class="grow">
          Plataforma
          <input type="text" bind:value={f.platform} placeholder="YouTube" />
        </label>
      </div>
    {:else if f.type === "podcastEpisode"}
      <div class="row">
        <label class="grow">
          Número de episodio
          <input type="text" bind:value={f.episodeNumber} />
        </label>
        <label class="grow">
          Nombre del podcast
          <input type="text" bind:value={f.showTitle} />
        </label>
        <label class="grow">
          Plataforma
          <input type="text" bind:value={f.platform} />
        </label>
      </div>
    {:else if f.type === "socialMedia"}
      <div class="row">
        <label class="grow">
          Usuario (@handle)
          <input type="text" bind:value={f.username} />
        </label>
        <label class="grow">
          Tipo de contenido
          <input type="text" bind:value={f.contentType} placeholder="Tuit" />
        </label>
        <label class="grow">
          Plataforma
          <input type="text" bind:value={f.platform} placeholder="X" />
        </label>
      </div>
    {:else if f.type === "software"}
      <div class="seg" role="group" aria-label="Software o datos">
        <button
          class:active={f.softwareKind === "software"}
          onclick={() => (f.softwareKind = "software")}
        >
          Software
        </button>
        <button
          class:active={f.softwareKind === "dataset"}
          onclick={() => (f.softwareKind = "dataset")}
        >
          Conjunto de datos
        </button>
      </div>
      <div class="row">
        <label class="grow">
          Versión
          <input type="text" bind:value={f.version} placeholder="2.1" />
        </label>
        <label class="grow">
          Editorial o distribuidor
          <input type="text" bind:value={f.publisher} />
        </label>
      </div>
    {/if}

    {#if f.type !== "personalCommunication"}
      <div class="row">
        <label class="grow">
          DOI
          <input type="text" bind:value={f.doi} placeholder="10.1234/abcd" />
        </label>
        <label class="grow">
          URL
          <input type="text" bind:value={f.url} placeholder="https://…" />
        </label>
      </div>
    {/if}

    <button class="save" onclick={save} disabled={!canSave}>
      Guardar referencia
    </button>
    <p class="hint">
      Autollenado por URL e import BibTeX: próximamente.
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
    width: min(500px, calc(100vw - 2rem));
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
  textarea,
  select {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid #d7d4cf;
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    background: #fff;
    color: inherit;
  }

  input:disabled {
    opacity: 0.5;
  }

  .lookup {
    border: 1px dashed #a6c4fa;
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .lookup.filled {
    border-style: solid;
    background: #eaf1fe55;
  }

  .lookup .row {
    align-items: center;
  }

  .find {
    border: none;
    background: #2158d6;
    color: #fff;
    font: inherit;
    font-size: 0.78rem;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }

  .find:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .lookup-error {
    margin: 0;
    color: #a32d2d;
    font-size: 0.75rem;
  }

  .lookup-ok {
    margin: 0;
    color: #173a8c;
    font-size: 0.75rem;
  }

  .notice {
    margin: 0;
    padding: 8px;
    border-radius: 8px;
    background: #faeeda;
    color: #633806;
    font-size: 0.78rem;
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
    select,
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

    .lookup {
      border-color: #2f4d8f;
    }

    .lookup.filled {
      background: #1d2c5055;
    }

    .lookup-error {
      color: #f09595;
    }

    .lookup-ok {
      color: #b7cdfa;
    }

    .notice {
      background: #4b3a12;
      color: #fac775;
    }
  }
</style>
