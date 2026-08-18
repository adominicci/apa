import {
  createEmptyEssay,
  type Essay,
  essayFromLegacyDraft,
  type EssaySummary,
  normalizeForStudentRelease,
  type SummarizableEssay,
  summarize,
} from "$lib/model/essay";
import type { DocLocale } from "@tesina/engine";
import { collectCitedRefIds } from "$lib/editor/citedRefs";
import {
  fileExists,
  listJsonFiles,
  readJson,
  removeFile,
  writeJsonAtomic,
} from "$lib/persist/atomic";

const LEGACY_DRAFT = "essays/draft.json";

function essayPath(id: string): string {
  return `essays/${id}.json`;
}

const FONT_CHOICES = new Set([
  "times-new-roman-12",
  "georgia-11",
  "computer-modern-10",
  "aptos-12",
  "calibri-11",
  "arial-11",
  "lucida-sans-unicode-10",
]);

function isIndexableEssay(
  value: unknown,
  fileName: string,
): value is SummarizableEssay {
  if (value === null || typeof value !== "object") return false;
  const essay = value as {
    schemaVersion?: unknown;
    id?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    settings?: {
      documentLanguage?: unknown;
      variant?: unknown;
      font?: unknown;
      paperSize?: unknown;
      runningHead?: unknown;
      includeUncitedReferences?: unknown;
      wordGoal?: unknown;
    };
    titlePage?: {
      title?: unknown;
      authors?: unknown;
      affiliations?: unknown;
      course?: unknown;
      instructor?: unknown;
      dueDate?: unknown;
      authorNote?: unknown;
    };
    content?: unknown;
    referencesSnapshot?: unknown;
    importedAt?: unknown;
    sourceEssayId?: unknown;
  };
  return essay.schemaVersion === 2 &&
    typeof essay.id === "string" && essay.id.length > 0 &&
    fileName === `${essay.id}.json` &&
    typeof essay.createdAt === "string" &&
    typeof essay.updatedAt === "string" &&
    essay.settings !== null && typeof essay.settings === "object" &&
    (essay.settings.documentLanguage === "en" ||
      essay.settings.documentLanguage === "es") &&
    (essay.settings.variant === "student" ||
      essay.settings.variant === "professional") &&
    FONT_CHOICES.has(String(essay.settings.font)) &&
    (essay.settings.paperSize === "us-letter" ||
      essay.settings.paperSize === "a4") &&
    typeof essay.settings.includeUncitedReferences === "boolean" &&
    (essay.settings.runningHead === undefined ||
      typeof essay.settings.runningHead === "string") &&
    (essay.settings.wordGoal === undefined ||
      (Number.isSafeInteger(essay.settings.wordGoal) &&
        Number(essay.settings.wordGoal) > 0)) &&
    essay.titlePage !== null && typeof essay.titlePage === "object" &&
    typeof essay.titlePage.title === "string" &&
    Array.isArray(essay.titlePage.authors) &&
    essay.titlePage.authors.every((author) => typeof author === "string") &&
    Array.isArray(essay.titlePage.affiliations) &&
    essay.titlePage.affiliations.every((affiliation) =>
      typeof affiliation === "string"
    ) &&
    (essay.titlePage.course === undefined ||
      typeof essay.titlePage.course === "string") &&
    (essay.titlePage.instructor === undefined ||
      typeof essay.titlePage.instructor === "string") &&
    (essay.titlePage.dueDate === undefined ||
      typeof essay.titlePage.dueDate === "string") &&
    (essay.titlePage.authorNote === undefined ||
      typeof essay.titlePage.authorNote === "string") &&
    essay.content !== null && typeof essay.content === "object" &&
    Array.isArray(essay.referencesSnapshot) &&
    (essay.importedAt === undefined || typeof essay.importedAt === "string") &&
    (essay.sourceEssayId === undefined ||
      typeof essay.sourceEssayId === "string");
}

export class IncompleteEssayScanError extends Error {
  readonly unreadableFiles: string[];

  constructor(unreadableFiles: string[]) {
    const sortedFiles = [...unreadableFiles].sort();
    super(`Could not safely scan essay citations: ${sortedFiles.join(", ")}`);
    this.name = "IncompleteEssayScanError";
    this.unreadableFiles = sortedFiles;
  }
}

/**
 * The essay library: one JSON file per essay under $APPDATA/essays. The
 * index is rebuilt by scanning the directory (files are small; nothing to
 * desync). Deleting moves the file into backups/ first — never destroys.
 */
class EssaysStore {
  summaries = $state<EssaySummary[]>([]);
  unreadableFiles = $state<string[]>([]);
  loaded = $state(false);

  async loadIndex(): Promise<void> {
    try {
      let legacyMigrationFailed = false;
      try {
        await this.#migrateLegacyDraft();
      } catch {
        legacyMigrationFailed = true;
      }

      const scan = await this.#scanEssays((essay) => summarize(essay));
      const unreadableFiles = new Set(scan.unreadableFiles);
      if (legacyMigrationFailed) unreadableFiles.add("draft.json");
      scan.results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      this.summaries = scan.results;
      this.unreadableFiles = [...unreadableFiles].sort();
    } catch (err) {
      console.error("No se pudo cargar el índice de ensayos:", err);
    } finally {
      this.loaded = true;
    }
  }

  async #migrateLegacyDraft(): Promise<void> {
    if (!(await fileExists(LEGACY_DRAFT))) return;
    const draft = await readJson<Record<string, unknown>>(LEGACY_DRAFT);
    if (draft) {
      const essay = essayFromLegacyDraft(draft);
      await writeJsonAtomic(essayPath(essay.id), essay);
    }
    await removeFile(LEGACY_DRAFT);
  }

  async #scanEssays<T>(
    project: (essay: SummarizableEssay) => T | null,
  ): Promise<{ results: T[]; unreadableFiles: string[] }> {
    const names = await listJsonFiles("essays");
    const results: T[] = [];
    const unreadableFiles: string[] = [];
    for (const name of names) {
      try {
        const essay = await readJson<unknown>(`essays/${name}`);
        if (!isIndexableEssay(essay, name)) {
          unreadableFiles.push(name);
          continue;
        }
        const result = project(essay);
        if (result !== null) results.push(result);
      } catch {
        unreadableFiles.push(name);
      }
    }
    unreadableFiles.sort();
    return { results, unreadableFiles };
  }

  #upsertSummary(essay: Essay): void {
    const summary = summarize(essay);
    const rest = this.summaries.filter((s) => s.id !== essay.id);
    this.summaries = [summary, ...rest];
  }

  async create(language: DocLocale): Promise<Essay> {
    const essay = createEmptyEssay(language, new Date().toISOString());
    await writeJsonAtomic(essayPath(essay.id), essay);
    this.#upsertSummary(essay);
    return essay;
  }

  async load(id: string): Promise<Essay | null> {
    const essay = await readJson<Essay>(essayPath(id));
    return essay?.schemaVersion === 2
      ? normalizeForStudentRelease(essay)
      : null;
  }

  async persist(essay: Essay): Promise<void> {
    const normalized = normalizeForStudentRelease(essay);
    normalized.updatedAt = new Date().toISOString();
    essay.settings.variant = "student";
    essay.updatedAt = normalized.updatedAt;
    await writeJsonAtomic(essayPath(normalized.id), normalized);
    this.#upsertSummary(normalized);
  }

  async rename(id: string, title: string): Promise<void> {
    const essay = await this.load(id);
    if (!essay) return;
    essay.titlePage.title = title.trim() || essay.titlePage.title;
    await this.persist(essay);
  }

  async duplicate(id: string): Promise<void> {
    const essay = await this.load(id);
    if (!essay) return;
    const now = new Date().toISOString();
    const copy: Essay = {
      ...essay,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      titlePage: {
        ...essay.titlePage,
        title: `${essay.titlePage.title} (copia)`,
      },
    };
    await writeJsonAtomic(essayPath(copy.id), copy);
    this.#upsertSummary(copy);
  }

  /**
   * Which essays cite `refId`, for the reference-manager delete guard. Full
   * scan of the essays directory (files are small); only real essays
   * (`schemaVersion === 2`) count. Returns id + title of each citing essay.
   */
  async essaysCiting(refId: string): Promise<{ id: string; title: string }[]> {
    const scan = await this.#scanEssays((essay) =>
      collectCitedRefIds(essay.content).has(refId)
        ? { id: essay.id, title: essay.titlePage.title }
        : null
    );
    this.unreadableFiles = scan.unreadableFiles;
    if (scan.unreadableFiles.length > 0) {
      throw new IncompleteEssayScanError(scan.unreadableFiles);
    }
    return scan.results;
  }

  async remove(id: string): Promise<void> {
    const essay = await this.load(id);
    if (essay) {
      const stamp = new Date().toISOString().replaceAll(":", "-");
      await writeJsonAtomic(`backups/${id}/${stamp}.json`, essay);
    }
    await removeFile(essayPath(id));
    this.summaries = this.summaries.filter((s) => s.id !== id);
  }
}

export const essays = new EssaysStore();
