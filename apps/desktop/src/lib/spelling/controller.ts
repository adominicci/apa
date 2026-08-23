import type { DocumentLanguage, SpellingService } from "./types.ts";
import {
  extractSpellingDocument,
  mapChunkIssues,
  type MappedSpellingIssue,
  type SpellingIssueSource,
} from "./extraction.ts";
import { canonicalizeTerm } from "./canonicalTerms.ts";

export interface SpellingAnalysisSnapshot {
  essayId: string;
  title: string;
  doc: unknown;
  documentLanguage: DocumentLanguage;
  documentIgnores: readonly string[];
  personalDictionary: readonly string[];
}

export interface ExperienceSpellingIssue extends MappedSpellingIssue {
  generation: number;
  termKey: string;
}

export type SpellingExperienceStatus =
  | "idle"
  | "checking"
  | "issues"
  | "issue-free"
  | "busy"
  | "missing-dictionary"
  | "unavailable"
  | "failed";

export interface SpellingExperienceState {
  status: SpellingExperienceStatus;
  issues: ExperienceSpellingIssue[];
  language?: DocumentLanguage;
}

interface ControllerOptions {
  service: SpellingService;
  read: () => SpellingAnalysisSnapshot;
  contextId?: string;
  debounceMs?: number;
  onChange?: (state: SpellingExperienceState) => void;
}

export function spellingIssueIdentity(issue: ExperienceSpellingIssue): string {
  return `${issue.source}:${issue.generation}:${issue.from}:${issue.to}:${issue.termKey}`;
}

export function createSpellingController(options: ControllerOptions) {
  let generation = 0;
  let active: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let busyRetryGeneration: number | null = null;
  let capabilityCache: {
    generation: number;
    language: DocumentLanguage;
    promise: ReturnType<SpellingService["capability"]>;
  } | null = null;
  const contextId = options.contextId ?? crypto.randomUUID();
  const ignoredOnce = new Set<string>();
  const state: SpellingExperienceState = { status: "idle", issues: [] };

  const publish = (
    status: SpellingExperienceStatus,
    issues: ExperienceSpellingIssue[] = [],
    language?: DocumentLanguage,
  ) => {
    state.status = status;
    state.issues = issues;
    if (language) state.language = language;
    options.onChange?.({ ...state, issues: [...issues] });
  };

  const schedule = () => {
    if (destroyed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void checkNow();
    }, options.debounceMs ?? 250);
  };

  const invalidate = (_source: SpellingIssueSource | "essay" | "disabled") => {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    active?.abort();
    active = null;
    ignoredOnce.clear();
    busyRetryGeneration = null;
    capabilityCache = null;
    publish("idle");
  };

  const checkNow = async (): Promise<void> => {
    if (destroyed) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    active?.abort();
    const abort = new AbortController();
    active = abort;
    const currentGeneration = generation;
    const snapshot = options.read();
    publish("checking", [], snapshot.documentLanguage);
    if (
      capabilityCache?.generation !== currentGeneration ||
      capabilityCache.language !== snapshot.documentLanguage
    ) {
      capabilityCache = {
        generation: currentGeneration,
        language: snapshot.documentLanguage,
        promise: options.service.capability(snapshot.documentLanguage),
      };
    }
    const capability = await capabilityCache.promise;
    if (destroyed || abort.signal.aborted || generation !== currentGeneration) {
      return;
    }
    if (capability.status === "missing-dictionary") {
      publish("missing-dictionary", [], snapshot.documentLanguage);
      return;
    }
    if (capability.status === "unavailable") {
      publish("unavailable", [], snapshot.documentLanguage);
      return;
    }

    const extracted = extractSpellingDocument(snapshot.title, snapshot.doc);
    const accumulated: ExperienceSpellingIssue[] = [];
    for (const chunk of extracted.chunks) {
      const result = await options.service.check({
        contextId,
        documentRevision: currentGeneration,
        language: snapshot.documentLanguage,
        documentStart: chunk.documentStart,
        text: chunk.text,
      }, abort.signal);
      if (
        destroyed || abort.signal.aborted || generation !== currentGeneration
      ) {
        return;
      }
      if (result.status === "busy") {
        publish("busy", [], snapshot.documentLanguage);
        if (busyRetryGeneration !== currentGeneration) {
          busyRetryGeneration = currentGeneration;
          schedule();
        }
        return;
      }
      if (result.status !== "completed") {
        if (result.status === "cancelled" || result.status === "stale") {
          publish("failed", [], snapshot.documentLanguage);
        } else publish("failed", [], snapshot.documentLanguage);
        return;
      }
      const mapped = mapChunkIssues(chunk, result.issues);
      if (!mapped) {
        publish("failed", [], snapshot.documentLanguage);
        return;
      }
      for (const issue of mapped) {
        const canonical = canonicalizeTerm(
          issue.word,
          snapshot.documentLanguage,
        );
        if (!canonical) {
          publish("failed", [], snapshot.documentLanguage);
          return;
        }
        accumulated.push({
          ...issue,
          generation: currentGeneration,
          termKey: canonical.key,
        });
      }
    }
    if (destroyed || abort.signal.aborted || generation !== currentGeneration) {
      return;
    }
    const durableKeys = new Set(
      [...snapshot.documentIgnores, ...snapshot.personalDictionary]
        .map((term) => canonicalizeTerm(term, snapshot.documentLanguage)?.key)
        .filter((key): key is string => Boolean(key)),
    );
    const issues = accumulated.filter((issue) =>
      !durableKeys.has(issue.termKey) &&
      !ignoredOnce.has(spellingIssueIdentity(issue))
    ).sort((a, b) => {
      const sourceOrder = a.source === b.source
        ? 0
        : a.source === "paper-title"
        ? -1
        : 1;
      return sourceOrder || a.from - b.from || a.to - b.to;
    });
    publish(
      issues.length > 0 ? "issues" : "issue-free",
      issues,
      snapshot.documentLanguage,
    );
    active = null;
  };

  return {
    state,
    get generation() {
      return generation;
    },
    checkNow,
    schedule,
    invalidate,
    ignoreOnce(issue: ExperienceSpellingIssue) {
      if (issue.generation !== generation) return false;
      ignoredOnce.add(spellingIssueIdentity(issue));
      state.issues = state.issues.filter((current) =>
        spellingIssueIdentity(current) !== spellingIssueIdentity(issue)
      );
      publish(state.issues.length > 0 ? "issues" : "issue-free", state.issues);
      return true;
    },
    nextIssue(after?: ExperienceSpellingIssue) {
      if (state.issues.length === 0) return undefined;
      if (!after) return state.issues[0];
      const index = state.issues.findIndex((issue) =>
        spellingIssueIdentity(issue) === spellingIssueIdentity(after)
      );
      return state.issues[(index + 1) % state.issues.length];
    },
    destroy() {
      destroyed = true;
      active?.abort();
      active = null;
      if (timer) clearTimeout(timer);
      timer = null;
      ignoredOnce.clear();
      capabilityCache = null;
      publish("idle");
    },
  };
}

export type SpellingController = ReturnType<typeof createSpellingController>;
