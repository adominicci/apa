import {
  createEmptyEssay,
  type Essay,
  essayFromLegacyDraft,
  type EssaySummary,
  normalizeForStudentRelease,
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

/**
 * The essay library: one JSON file per essay under $APPDATA/essays. The
 * index is rebuilt by scanning the directory (files are small; nothing to
 * desync). Deleting moves the file into backups/ first — never destroys.
 */
class EssaysStore {
  summaries = $state<EssaySummary[]>([]);
  loaded = $state(false);

  async loadIndex(): Promise<void> {
    try {
      await this.#migrateLegacyDraft();
      const names = await listJsonFiles("essays");
      const found: EssaySummary[] = [];
      for (const name of names) {
        const essay = await readJson<Essay>(`essays/${name}`);
        if (essay && essay.schemaVersion === 2 && essay.id) {
          found.push(summarize(essay));
        }
      }
      found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      this.summaries = found;
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
    const names = await listJsonFiles("essays");
    const citing: { id: string; title: string }[] = [];
    for (const name of names) {
      const essay = await readJson<Essay>(`essays/${name}`);
      if (!essay || essay.schemaVersion !== 2 || !essay.id) continue;
      if (collectCitedRefIds(essay.content).has(refId)) {
        citing.push({ id: essay.id, title: essay.titlePage.title });
      }
    }
    return citing;
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
