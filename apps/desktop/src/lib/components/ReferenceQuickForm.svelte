<script lang="ts">
  import {
    type APADate,
    type Contributor,
    type DocLocale,
    getTerms,
    type LocaleTerms,
    type Reference,
    type ReferenceType,
  } from "@tesina/engine";
  import { untrack } from "svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { detectInput } from "$lib/autofill/detect";
  import {
    type AutofillError,
    lookupDoi,
    lookupIsbn,
    lookupUrl,
  } from "$lib/autofill/client";
  import {
    emptyQuickFields,
    type QuickFields,
    refToQuickFields,
  } from "$lib/autofill/fill";
  import { m } from "$lib/paraglide/messages";

  interface Props {
    /** Document language: preset descriptors are typed into the document. */
    language: DocLocale;
    /** When set, edit this reference (keeping its id) instead of adding. */
    initial?: Reference;
    /** Render as an embedded pane (reference manager) instead of a modal. */
    inline?: boolean;
    onSave: (ref: Reference) => void;
    onClose: () => void;
    /** When set, shows a "import from BibTeX" shortcut below the form. */
    onImportBibtex?: () => void;
  }

  let {
    language,
    initial,
    inline = false,
    onSave,
    onClose,
    onImportBibtex,
  }: Props = $props();

  const terms = $derived(getTerms(language));
  const editing = $derived(initial !== undefined);
  const title = $derived(editing ? m.form_title_edit() : m.form_title());

  interface CatalogItem {
    id: string;
    label: string;
    type: ReferenceType;
    /** Prefills document-language descriptors and kind fields. */
    apply?: (f: QuickFields, t: LocaleTerms) => void;
  }

  /**
   * Every format on APA's reference-examples page, grouped by its
   * categories. Several formats share an engine type and differ only in the
   * preset bracket descriptor, mirroring how the manual itself groups them.
   */
  const CATALOG: { label: string; items: CatalogItem[] }[] = [
    {
      label: m.cat_periodicals(),
      items: [
        {
          id: "journalArticle",
          label: m.form_type_journalArticle(),
          type: "journalArticle",
        },
        {
          id: "magazineArticle",
          label: m.fmt_magazine(),
          type: "newspaperArticle",
        },
        {
          id: "newspaperArticle",
          label: m.form_type_newspaperArticle(),
          type: "newspaperArticle",
        },
        { id: "blogPost", label: m.fmt_blog(), type: "newspaperArticle" },
      ],
    },
    {
      label: m.cat_books(),
      items: [
        { id: "book", label: m.form_type_book(), type: "book" },
        { id: "illustratedBook", label: m.fmt_illustrated(), type: "book" },
        { id: "religiousWork", label: m.fmt_religious(), type: "book" },
        {
          id: "musicalScore",
          label: m.fmt_musical_score(),
          type: "book",
          apply: (f, t) => {
            f.descriptor = t.descriptors.musicalScore;
          },
        },
        {
          id: "bookChapter",
          label: m.form_type_bookChapter(),
          type: "bookChapter",
        },
        {
          id: "referenceEntry",
          label: m.form_type_referenceEntry(),
          type: "referenceEntry",
        },
        {
          id: "wikipediaEntry",
          label: m.fmt_wikipedia(),
          type: "referenceEntry",
          apply: (f) => {
            f.workTitle = "Wikipedia";
          },
        },
      ],
    },
    {
      label: m.cat_gray(),
      items: [
        { id: "report", label: m.form_type_report(), type: "report" },
        {
          id: "brochure",
          label: m.fmt_brochure(),
          type: "report",
          apply: (f, t) => {
            f.descriptor = t.descriptors.brochure;
          },
        },
        {
          id: "factSheet",
          label: m.fmt_fact_sheet(),
          type: "report",
          apply: (f, t) => {
            f.descriptor = t.descriptors.factSheet;
          },
        },
        {
          id: "pressRelease",
          label: m.fmt_press_release(),
          type: "report",
          apply: (f, t) => {
            f.descriptor = t.descriptors.pressRelease;
          },
        },
        {
          id: "whitePaper",
          label: m.fmt_white_paper(),
          type: "report",
          apply: (f, t) => {
            f.descriptor = t.descriptors.whitePaper;
          },
        },
        { id: "standard", label: m.fmt_standard(), type: "report" },
        { id: "ethicsCode", label: m.fmt_ethics_code(), type: "report" },
      ],
    },
    {
      label: m.cat_conference(),
      items: [
        {
          id: "conferencePaper",
          label: m.form_type_conferencePaper(),
          type: "conferencePaper",
        },
        {
          id: "posterPresentation",
          label: m.fmt_poster(),
          type: "conferencePaper",
          apply: (f, t) => {
            f.contributionType = t.descriptors.posterPresentation;
          },
        },
        {
          id: "conferenceSession",
          label: m.fmt_conf_session(),
          type: "conferencePaper",
          apply: (f, t) => {
            f.contributionType = t.descriptors.conferenceSession;
          },
        },
        {
          id: "keynote",
          label: m.fmt_keynote(),
          type: "conferencePaper",
          apply: (f, t) => {
            f.contributionType = t.descriptors.keynote;
          },
        },
        {
          id: "conferenceProceedings",
          label: m.fmt_proceedings(),
          type: "bookChapter",
        },
        { id: "thesis", label: m.form_type_thesis(), type: "thesis" },
      ],
    },
    {
      label: m.cat_informal(),
      items: [
        { id: "preprint", label: m.fmt_preprint(), type: "preprint" },
        { id: "databaseDoc", label: m.fmt_database_doc(), type: "preprint" },
        {
          id: "unpublishedWork",
          label: m.fmt_unpublished(),
          type: "unpublishedWork",
        },
      ],
    },
    {
      label: m.cat_data(),
      items: [
        {
          id: "dataset",
          label: m.form_dataset(),
          type: "software",
          apply: (f) => {
            f.softwareKind = "dataset";
          },
        },
        { id: "software", label: m.form_software(), type: "software" },
        {
          id: "mobileApp",
          label: m.fmt_mobile_app(),
          type: "software",
          apply: (f, t) => {
            f.descriptor = t.descriptors.mobileApp;
          },
        },
        {
          id: "aiModel",
          label: m.fmt_ai_model(),
          type: "software",
          apply: (f, t) => {
            f.descriptor = t.descriptors.llm;
          },
        },
      ],
    },
    {
      label: m.cat_av(),
      items: [
        { id: "film", label: m.fmt_film(), type: "film" },
        {
          id: "tvSeries",
          label: m.fmt_tv_series(),
          type: "film",
          apply: (f) => {
            f.filmKind = "tvSeries";
          },
        },
        { id: "tvEpisode", label: m.fmt_tv_episode(), type: "tvEpisode" },
        { id: "video", label: m.form_type_video(), type: "video" },
        { id: "tedTalk", label: m.fmt_ted_talk(), type: "video" },
        {
          id: "webinar",
          label: m.fmt_webinar(),
          type: "video",
          apply: (f, t) => {
            f.descriptor = t.descriptors.webinar;
          },
        },
        {
          id: "mooc",
          label: m.fmt_mooc(),
          type: "video",
          apply: (f, t) => {
            f.descriptor = t.descriptors.mooc;
          },
        },
        {
          id: "slides",
          label: m.fmt_slides(),
          type: "video",
          apply: (f, t) => {
            f.descriptor = t.descriptors.slides;
          },
        },
        {
          id: "lectureNotes",
          label: m.fmt_lecture_notes(),
          type: "video",
          apply: (f, t) => {
            f.descriptor = t.descriptors.lectureNotes;
          },
        },
        {
          id: "radioBroadcast",
          label: m.fmt_radio(),
          type: "video",
          apply: (f, t) => {
            f.descriptor = t.descriptors.radioBroadcast;
          },
        },
        {
          id: "transcript",
          label: m.fmt_transcript(),
          type: "video",
          apply: (f, t) => {
            f.descriptor = t.descriptors.transcript;
          },
        },
        {
          id: "podcastEpisode",
          label: m.form_type_podcastEpisode(),
          type: "podcastEpisode",
        },
        {
          id: "podcastShow",
          label: m.fmt_podcast_show(),
          type: "podcastEpisode",
          apply: (f) => {
            f.podcastKind = "show";
          },
        },
        { id: "musicAlbum", label: m.fmt_album(), type: "music" },
        {
          id: "song",
          label: m.fmt_song(),
          type: "music",
          apply: (f) => {
            f.musicKind = "song";
          },
        },
        { id: "artwork", label: m.fmt_artwork(), type: "artwork" },
        {
          id: "stockImage",
          label: m.fmt_stock_image(),
          type: "artwork",
          apply: (f, t) => {
            f.medium = t.descriptors.stockImage;
          },
        },
      ],
    },
    {
      label: m.cat_online(),
      items: [
        { id: "website", label: m.form_type_website(), type: "website" },
        {
          id: "socialMedia",
          label: m.form_type_socialMedia(),
          type: "socialMedia",
        },
        {
          id: "forumPost",
          label: m.fmt_forum_post(),
          type: "socialMedia",
          apply: (f, t) => {
            f.contentType = t.descriptors.forumPost;
          },
        },
        {
          id: "personalCommunication",
          label: m.form_type_personalCommunication(),
          type: "personalCommunication",
        },
      ],
    },
  ];

  const FORMAT_BY_ID = new Map(
    CATALOG.flatMap((g) => g.items).map((item) => [item.id, item]),
  );

  // Prefill from the reference under edit (same path autofill uses); read once
  // — the wrapper remounts via {#key} when the selected reference changes.
  let f = $state<QuickFields>(
    untrack(() => initial ? refToQuickFields(initial) : emptyQuickFields()),
  );
  let formatId = $state(
    untrack(() =>
      (initial &&
        CATALOG.flatMap((g) => g.items).find((i) => i.type === initial.type)
          ?.id) ||
      "journalArticle"
    ),
  );
  let lookupText = $state("");
  let looking = $state(false);
  let lookupError = $state("");
  let autofilled = $state(false);

  function applyFormat(id: string) {
    const item = FORMAT_BY_ID.get(id);
    if (!item) return;
    formatId = id;
    f.type = item.type;
    // Format-level presets start clean; the user's shared fields survive.
    f.descriptor = "";
    f.contributionType = "";
    f.contentType = "";
    f.medium = "";
    f.filmKind = "film";
    f.musicKind = "album";
    f.podcastKind = "episode";
    f.softwareKind = "software";
    item.apply?.(f, terms);
  }

  const ERROR_MESSAGES: Record<AutofillError | "unknown-input", () => string> =
    {
      offline: m.form_err_offline,
      "not-found": m.form_err_not_found,
      unsupported: m.form_err_unsupported,
      parse: m.form_err_parse,
      "url-unreadable": m.form_err_url_unreadable,
      "unknown-input": m.form_err_unknown_input,
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
        return f.podcastKind === "show" || f.showTitle.trim() !== "";
      case "socialMedia":
        return f.platform.trim() !== "" && f.contentType.trim() !== "";
      case "tvEpisode":
        return f.seriesTitle.trim() !== "";
      case "preprint":
        return f.repository.trim() !== "";
      default:
        return true;
    }
  });

  async function lookup() {
    lookupError = "";
    autofilled = false;
    const detected = detectInput(lookupText);
    if (
      detected.kind !== "doi" && detected.kind !== "isbn" &&
      detected.kind !== "url"
    ) {
      lookupError = ERROR_MESSAGES["unknown-input"]();
      return;
    }
    looking = true;
    try {
      const result = detected.kind === "doi"
        ? await lookupDoi(detected.value)
        : detected.kind === "isbn"
        ? await lookupIsbn(detected.value)
        : await lookupUrl(detected.value);
      if (!result.ok) {
        lookupError = ERROR_MESSAGES[result.error]();
        return;
      }
      f = refToQuickFields(result.ref);
      const match = CATALOG.flatMap((g) => g.items)
        .find((item) => item.type === f.type);
      if (match) formatId = match.id;
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
      id: initial?.id ?? crypto.randomUUID(),
      authors: parseContributors(f.authorsText),
      date: buildDate(),
      title: f.title.trim() ||
        (f.type === "personalCommunication"
          ? terms.personalCommunication.charAt(0).toUpperCase() +
            terms.personalCommunication.slice(1)
          : ""),
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
      case "book": {
        const illustrators = parseContributors(f.illustratorsText);
        const originalYear = Number.parseInt(f.originalYear, 10);
        ref = {
          ...base,
          type: "book",
          ...(opt(f.publisher) ? { publisher: opt(f.publisher)! } : {}),
          ...(opt(f.edition) ? { edition: opt(f.edition)! } : {}),
          ...(illustrators.length > 0 ? { illustrators } : {}),
          ...(opt(f.descriptor) ? { descriptor: opt(f.descriptor)! } : {}),
          ...(Number.isNaN(originalYear) ? {} : { originalYear }),
        };
        break;
      }
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
          ...(opt(f.standardNumber)
            ? { standardNumber: opt(f.standardNumber)! }
            : {}),
          ...(opt(f.descriptor) ? { descriptor: opt(f.descriptor)! } : {}),
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
          ...(opt(f.contributionType)
            ? { contributionType: opt(f.contributionType)! }
            : {}),
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
          ...(opt(f.descriptor) ? { descriptor: opt(f.descriptor)! } : {}),
        };
        break;
      case "podcastEpisode": {
        const yearEnd = Number.parseInt(f.yearEnd, 10);
        ref = {
          ...base,
          type: "podcastEpisode",
          kind: f.podcastKind,
          ...(opt(f.episodeNumber)
            ? { episodeNumber: opt(f.episodeNumber)! }
            : {}),
          ...(opt(f.showTitle) ? { showTitle: opt(f.showTitle)! } : {}),
          ...(opt(f.platform) ? { platform: opt(f.platform)! } : {}),
          ...(f.podcastKind === "show" && !Number.isNaN(yearEnd)
            ? { yearEnd }
            : {}),
          ...(f.podcastKind === "show" && f.ongoing ? { ongoing: true } : {}),
        };
        break;
      }
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
          ...(opt(f.descriptor) ? { descriptor: opt(f.descriptor)! } : {}),
        };
        break;
      case "film": {
        const yearEnd = Number.parseInt(f.yearEnd, 10);
        ref = {
          ...base,
          type: "film",
          kind: f.filmKind,
          ...(opt(f.productionCompany)
            ? { productionCompany: opt(f.productionCompany)! }
            : {}),
          ...(f.filmKind === "tvSeries" && !Number.isNaN(yearEnd)
            ? { yearEnd }
            : {}),
          ...(f.filmKind === "tvSeries" && f.ongoing ? { ongoing: true } : {}),
        };
        break;
      }
      case "tvEpisode":
        ref = {
          ...base,
          type: "tvEpisode",
          credit: f.credit,
          ...(opt(f.season) ? { season: opt(f.season)! } : {}),
          ...(opt(f.episode) ? { episode: opt(f.episode)! } : {}),
          seriesTitle: f.seriesTitle.trim(),
          ...(f.execProducersText.trim() !== ""
            ? { executiveProducers: parseContributors(f.execProducersText) }
            : {}),
          ...(opt(f.productionCompany)
            ? { productionCompany: opt(f.productionCompany)! }
            : {}),
        };
        break;
      case "music":
        ref = {
          ...base,
          type: "music",
          kind: f.musicKind,
          ...(f.musicKind === "song" && opt(f.albumTitle)
            ? { albumTitle: opt(f.albumTitle)! }
            : {}),
          ...(opt(f.musicLabel) ? { label: opt(f.musicLabel)! } : {}),
        };
        break;
      case "artwork":
        ref = {
          ...base,
          type: "artwork",
          ...(opt(f.medium) ? { medium: opt(f.medium)! } : {}),
          ...(opt(f.venue) ? { venue: opt(f.venue)! } : {}),
          ...(opt(f.location) ? { location: opt(f.location)! } : {}),
        };
        break;
      case "preprint":
        ref = {
          ...base,
          type: "preprint",
          repository: f.repository.trim(),
          ...(opt(f.itemNumber) ? { itemNumber: opt(f.itemNumber)! } : {}),
        };
        break;
      case "unpublishedWork":
        ref = {
          ...base,
          type: "unpublishedWork",
          status: f.unpubStatus,
          ...(f.unpubStatus !== "submitted" && opt(f.institution)
            ? { institution: opt(f.institution)! }
            : {}),
        };
        break;
      case "personalCommunication":
        ref = { ...base, type: "personalCommunication" };
        break;
    }
    onSave(ref);
  }
</script>

{#snippet body()}
    <div class="lookup" class:filled={autofilled}>
      <div class="row">
        <input
          type="text"
          bind:value={lookupText}
          placeholder={m.form_lookup_placeholder()}
          onkeydown={(e) => {
            if (e.key === "Enter") lookup();
          }}
        />
        <button
          class="find"
          onclick={lookup}
          disabled={looking || lookupText.trim() === ""}
        >
          {looking ? m.form_lookup_busy() : m.form_lookup_button()}
        </button>
      </div>
      {#if lookupError}
        <p class="lookup-error">{lookupError}</p>
      {:else if autofilled}
        <p class="lookup-ok">
          {m.form_lookup_ok()}
        </p>
      {/if}
    </div>

    <label>
      {m.form_type_label()}
      <select
        value={formatId}
        onchange={(e) => applyFormat(e.currentTarget.value)}
      >
        {#each CATALOG as group (group.label)}
          <optgroup label={group.label}>
            {#each group.items as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>

    {#if f.type === "personalCommunication"}
      <p class="notice">
        {m.form_pc_notice()}
      </p>
    {/if}

    <label>
      {m.form_authors_label()}
      <textarea rows="3" bind:value={f.authorsText} placeholder="Salgado, Nora"
      ></textarea>
    </label>

    <div class="row">
      <label class="grow">
        {m.form_year()}
        <input type="text" bind:value={f.year} disabled={f.noDate} />
      </label>
      <label class="grow">
        {m.form_month()}
        <input type="text" bind:value={f.month} disabled={f.noDate} />
      </label>
      <label class="grow">
        {m.form_day()}
        <input type="text" bind:value={f.day} disabled={f.noDate} />
      </label>
      <label class="checkline">
        <input type="checkbox" bind:checked={f.noDate} /> {m.form_no_date()}
      </label>
    </div>

    {#if f.type !== "personalCommunication"}
      <label>
        {m.form_field_title()}
        <input type="text" bind:value={f.title} />
      </label>
    {/if}

    {#if f.type === "journalArticle"}
      <label>
        {m.form_journal()}
        <input type="text" bind:value={f.journal} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_volume()}
          <input type="text" bind:value={f.volume} />
        </label>
        <label class="grow">
          {m.form_issue()}
          <input type="text" bind:value={f.issue} />
        </label>
        <label class="grow">
          {m.form_pages()}
          <input type="text" bind:value={f.pages} placeholder="45–67" />
        </label>
      </div>
    {:else if f.type === "book"}
      <div class="row">
        <label class="grow">
          {m.form_publisher()}
          <input type="text" bind:value={f.publisher} />
        </label>
        <label class="grow">
          {m.form_edition()}
          <input type="text" bind:value={f.edition} placeholder="2" />
        </label>
        <label class="grow">
          {m.form_original_year()}
          <input type="text" bind:value={f.originalYear} />
        </label>
      </div>
      <label>
        {m.form_illustrators()}
        <textarea rows="2" bind:value={f.illustratorsText}></textarea>
      </label>
      <label>
        {m.form_descriptor()}
        <input type="text" bind:value={f.descriptor} />
      </label>
    {:else if f.type === "bookChapter"}
      <label>
        {m.form_editors()}
        <textarea rows="2" bind:value={f.editorsText}></textarea>
      </label>
      <label>
        {m.form_book_title()}
        <input type="text" bind:value={f.bookTitle} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_edition()}
          <input type="text" bind:value={f.edition} />
        </label>
        <label class="grow">
          {m.form_pages()}
          <input type="text" bind:value={f.pages} placeholder="85–104" />
        </label>
        <label class="grow">
          {m.form_publisher()}
          <input type="text" bind:value={f.publisher} />
        </label>
      </div>
    {:else if f.type === "website"}
      <label>
        {m.form_site_name()}
        <input type="text" bind:value={f.siteName} />
      </label>
    {:else if f.type === "report"}
      <div class="row">
        <label class="grow">
          {m.form_institution()}
          <input type="text" bind:value={f.institution} />
        </label>
        <label class="grow">
          {m.form_report_number()}
          <input type="text" bind:value={f.reportNumber} />
        </label>
      </div>
      <div class="row">
        <label class="grow">
          {m.form_standard_number()}
          <input
            type="text"
            bind:value={f.standardNumber}
            placeholder="ISO 14001:2015"
          />
        </label>
        <label class="grow">
          {m.form_descriptor()}
          <input type="text" bind:value={f.descriptor} />
        </label>
      </div>
    {:else if f.type === "thesis"}
      <div class="seg" role="group" aria-label={m.form_thesis_aria()}>
        <button
          class:active={f.thesisType === "doctoral"}
          onclick={() => (f.thesisType = "doctoral")}
        >
          {m.form_thesis_doctoral()}
        </button>
        <button
          class:active={f.thesisType === "masters"}
          onclick={() => (f.thesisType = "masters")}
        >
          {m.form_thesis_masters()}
        </button>
      </div>
      <label>
        {m.form_thesis_institution()}
        <input type="text" bind:value={f.institution} />
      </label>
      <label class="checkline">
        <input type="checkbox" bind:checked={f.unpublished} /> {m.form_unpublished()}
      </label>
      {#if !f.unpublished}
        <label>
          {m.form_archive()}
          <input type="text" bind:value={f.archive} />
        </label>
      {/if}
    {:else if f.type === "conferencePaper"}
      <label>
        {m.form_conference()}
        <input type="text" bind:value={f.conferenceName} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_location()}
          <input type="text" bind:value={f.location} />
        </label>
        <label class="grow">
          {m.form_day_end()}
          <input type="text" bind:value={f.dayEnd} placeholder="8" />
        </label>
        <label class="grow">
          {m.form_contribution_type()}
          <input
            type="text"
            bind:value={f.contributionType}
            placeholder={terms.brackets.paperPresentation}
          />
        </label>
      </div>
    {:else if f.type === "newspaperArticle"}
      <label>
        {m.form_publication()}
        <input type="text" bind:value={f.publication} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_volume()}
          <input type="text" bind:value={f.volume} />
        </label>
        <label class="grow">
          {m.form_issue()}
          <input type="text" bind:value={f.issue} />
        </label>
        <label class="grow">
          {m.form_pages()}
          <input type="text" bind:value={f.pages} />
        </label>
      </div>
    {:else if f.type === "referenceEntry"}
      <label>
        {m.form_work_title()}
        <input type="text" bind:value={f.workTitle} />
      </label>
      <div class="row">
        <label class="grow">
          {m.form_edition()}
          <input type="text" bind:value={f.edition} />
        </label>
        <label class="grow">
          {m.form_publisher()}
          <input type="text" bind:value={f.publisher} />
        </label>
      </div>
    {:else if f.type === "video"}
      <div class="row">
        <label class="grow">
          {m.form_username()}
          <input type="text" bind:value={f.username} />
        </label>
        <label class="grow">
          {m.form_platform()}
          <input type="text" bind:value={f.platform} placeholder="YouTube" />
        </label>
        <label class="grow">
          {m.form_descriptor()}
          <input
            type="text"
            bind:value={f.descriptor}
            placeholder={terms.brackets.video}
          />
        </label>
      </div>
    {:else if f.type === "podcastEpisode"}
      <div class="seg" role="group" aria-label={m.form_podcast_kind_aria()}>
        <button
          class:active={f.podcastKind === "episode"}
          onclick={() => (f.podcastKind = "episode")}
        >
          {m.form_podcast_episode_seg()}
        </button>
        <button
          class:active={f.podcastKind === "show"}
          onclick={() => (f.podcastKind = "show")}
        >
          {m.form_podcast_show_seg()}
        </button>
      </div>
      {#if f.podcastKind === "episode"}
        <div class="row">
          <label class="grow">
            {m.form_episode_number()}
            <input type="text" bind:value={f.episodeNumber} />
          </label>
          <label class="grow">
            {m.form_show_title()}
            <input type="text" bind:value={f.showTitle} />
          </label>
          <label class="grow">
            {m.form_platform()}
            <input type="text" bind:value={f.platform} />
          </label>
        </div>
      {:else}
        <div class="row">
          <label class="grow">
            {m.form_platform()}
            <input type="text" bind:value={f.platform} />
          </label>
          <label class="grow">
            {m.form_year_end()}
            <input type="text" bind:value={f.yearEnd} disabled={f.ongoing} />
          </label>
          <label class="checkline">
            <input type="checkbox" bind:checked={f.ongoing} /> {m.form_ongoing()}
          </label>
        </div>
      {/if}
    {:else if f.type === "socialMedia"}
      <div class="row">
        <label class="grow">
          {m.form_handle()}
          <input type="text" bind:value={f.username} />
        </label>
        <label class="grow">
          {m.form_content_type()}
          <input type="text" bind:value={f.contentType} placeholder={m.form_content_type_ph()} />
        </label>
        <label class="grow">
          {m.form_platform()}
          <input type="text" bind:value={f.platform} placeholder="X" />
        </label>
      </div>
    {:else if f.type === "software"}
      <div class="seg" role="group" aria-label={m.form_software_kind_aria()}>
        <button
          class:active={f.softwareKind === "software"}
          onclick={() => (f.softwareKind = "software")}
        >
          {m.form_software()}
        </button>
        <button
          class:active={f.softwareKind === "dataset"}
          onclick={() => (f.softwareKind = "dataset")}
        >
          {m.form_dataset()}
        </button>
      </div>
      <div class="row">
        <label class="grow">
          {m.form_version()}
          <input type="text" bind:value={f.version} placeholder="2.1" />
        </label>
        <label class="grow">
          {m.form_distributor()}
          <input type="text" bind:value={f.publisher} />
        </label>
        <label class="grow">
          {m.form_descriptor()}
          <input
            type="text"
            bind:value={f.descriptor}
            placeholder={terms.brackets.software}
          />
        </label>
      </div>
    {:else if f.type === "film"}
      <div class="seg" role="group" aria-label={m.form_film_kind_aria()}>
        <button
          class:active={f.filmKind === "film"}
          onclick={() => (f.filmKind = "film")}
        >
          {m.fmt_film()}
        </button>
        <button
          class:active={f.filmKind === "tvSeries"}
          onclick={() => (f.filmKind = "tvSeries")}
        >
          {m.fmt_tv_series()}
        </button>
      </div>
      <div class="row">
        <label class="grow">
          {m.form_production_company()}
          <input type="text" bind:value={f.productionCompany} />
        </label>
        {#if f.filmKind === "tvSeries"}
          <label class="grow">
            {m.form_year_end()}
            <input type="text" bind:value={f.yearEnd} disabled={f.ongoing} />
          </label>
          <label class="checkline">
            <input type="checkbox" bind:checked={f.ongoing} /> {m.form_ongoing()}
          </label>
        {/if}
      </div>
      <p class="hint-inline">{m.form_film_hint()}</p>
    {:else if f.type === "tvEpisode"}
      <div class="row">
        <label class="grow">
          {m.form_credit_label()}
          <select bind:value={f.credit}>
            <option value="writerDirector">{m.form_credit_writer_director()}</option>
            <option value="writer">{m.form_credit_writer()}</option>
            <option value="director">{m.form_credit_director()}</option>
          </select>
        </label>
        <label class="grow">
          {m.form_season()}
          <input type="text" bind:value={f.season} placeholder="2" />
        </label>
        <label class="grow">
          {m.form_episode()}
          <input type="text" bind:value={f.episode} placeholder="5" />
        </label>
      </div>
      <label>
        {m.form_series_title()}
        <input type="text" bind:value={f.seriesTitle} />
      </label>
      <label>
        {m.form_exec_producers()}
        <textarea rows="2" bind:value={f.execProducersText}></textarea>
      </label>
      <label>
        {m.form_production_company()}
        <input type="text" bind:value={f.productionCompany} />
      </label>
    {:else if f.type === "music"}
      <div class="seg" role="group" aria-label={m.form_music_kind_aria()}>
        <button
          class:active={f.musicKind === "album"}
          onclick={() => (f.musicKind = "album")}
        >
          {m.fmt_album()}
        </button>
        <button
          class:active={f.musicKind === "song"}
          onclick={() => (f.musicKind = "song")}
        >
          {m.fmt_song()}
        </button>
      </div>
      <div class="row">
        {#if f.musicKind === "song"}
          <label class="grow">
            {m.form_album_title()}
            <input type="text" bind:value={f.albumTitle} />
          </label>
        {/if}
        <label class="grow">
          {m.form_music_label()}
          <input type="text" bind:value={f.musicLabel} />
        </label>
      </div>
    {:else if f.type === "artwork"}
      <div class="row">
        <label class="grow">
          {m.form_medium()}
          <input
            type="text"
            bind:value={f.medium}
            placeholder={`${terms.descriptors.painting}, ${terms.descriptors.photograph}, ${terms.descriptors.map}…`}
          />
        </label>
        <label class="grow">
          {m.form_venue()}
          <input type="text" bind:value={f.venue} />
        </label>
        <label class="grow">
          {m.form_location()}
          <input type="text" bind:value={f.location} />
        </label>
      </div>
    {:else if f.type === "preprint"}
      <div class="row">
        <label class="grow">
          {m.form_repository()}
          <input type="text" bind:value={f.repository} />
        </label>
        <label class="grow">
          {m.form_item_number()}
          <input type="text" bind:value={f.itemNumber} />
        </label>
      </div>
    {:else if f.type === "unpublishedWork"}
      <label>
        {m.form_status_label()}
        <select bind:value={f.unpubStatus}>
          <option value="unpublished">{m.form_status_unpublished()}</option>
          <option value="inPreparation">{m.form_status_in_preparation()}</option>
          <option value="submitted">{m.form_status_submitted()}</option>
        </select>
      </label>
      {#if f.unpubStatus !== "submitted"}
        <label>
          {m.form_institution()}
          <input type="text" bind:value={f.institution} />
        </label>
      {/if}
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

    {#if onImportBibtex}
      <p class="hint">
        <button type="button" class="bibtex-link" onclick={onImportBibtex}>
          {m.bib_import_link()}
        </button>
      </p>
    {/if}

{/snippet}

{#snippet formFooter()}
  <button class="btn btn-ghost" onclick={onClose}>{m.common_close()}</button>
  <button class="btn btn-primary" onclick={save} disabled={!canSave}>
    {editing ? m.form_save_changes() : m.form_save()}
  </button>
{/snippet}

{#if inline}
  <section class="inline-form" aria-label={title}>
    <header class="inline-head"><h3>{title}</h3></header>
    <div class="inline-body">{@render body()}</div>
    <footer class="inline-foot">{@render formFooter()}</footer>
  </section>
{:else}
  <Modal {title} {onClose} size="ref" dismissOnOverlay={false}>
    {@render body()}
    {#snippet footer()}{@render formFooter()}{/snippet}
  </Modal>
{/if}

<style>
  .row {
    display: flex;
    gap: 10px;
    align-items: end;
  }

  .grow {
    flex: 1;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--fg-2);
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
    border: 1px solid var(--border);
    border-radius: 6px;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    background: var(--surface);
    color: inherit;
  }

  input:disabled {
    opacity: 0.5;
  }

  .lookup {
    border: 1px dashed color-mix(in oklab, var(--accent), transparent 50%);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .lookup.filled {
    border-style: solid;
    background: var(--accent-soft);
  }

  .lookup .row {
    align-items: center;
  }

  .find {
    border: none;
    background: var(--accent);
    color: var(--accent-on);
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
    color: var(--danger);
    font-size: 0.75rem;
  }

  .lookup-ok {
    margin: 0;
    color: var(--accent);
    font-size: 0.75rem;
  }

  .notice {
    margin: 0;
    padding: 8px;
    border-radius: 8px;
    background: var(--warn-soft);
    color: var(--warn-strong);
    font-size: 0.78rem;
  }

  .seg {
    display: flex;
    border: 1px solid var(--border);
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
    color: var(--muted);
  }

  .seg button.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .hint,
  .hint-inline {
    margin: 0;
    color: var(--muted);
    font-size: 0.75rem;
  }

  .bibtex-link {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
  }

  .bibtex-link:hover {
    text-decoration: underline;
  }

  /* Embedded pane variant (reference manager edit column). Mirrors the modal
     chrome; the shared .btn styles in modal.css are scoped to .modal, so the
     footer buttons are restyled here. */
  .inline-form {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: var(--font);
    font-size: 13.5px;
    color: var(--fg);
  }

  .inline-head {
    flex: 0 0 auto;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
  }

  .inline-head h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .inline-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .inline-foot {
    flex: 0 0 auto;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
  }

  .inline-foot .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 36px;
    padding: 0 14px;
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    border: 1px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--fast) var(--ease),
      border-color var(--fast) var(--ease);
  }

  .inline-foot .btn-primary {
    background: var(--accent);
    color: var(--accent-on);
  }

  .inline-foot .btn-primary:hover:enabled {
    background: var(--accent-hover);
  }

  .inline-foot .btn-primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .inline-foot .btn-ghost {
    color: var(--fg-2);
    border-color: var(--border);
    background: var(--surface);
  }

  .inline-foot .btn-ghost:hover:enabled {
    border-color: var(--muted);
  }
</style>
