import type { DocLocale } from "@tesina/engine";
import type { Mapping } from "@tiptap/pm/transform";
import {
  analyzeCoachPassages,
  type CoachPassageAnalysis,
} from "./analysisAdapter.ts";
import {
  type CoachControllerState,
  type CoachPassageSnapshot,
  type CoachSuppression,
  type EditorRange,
  type FixedCoachSession,
  type MappedCoachIssue,
  mappedIssueIdentity,
} from "./types.ts";
import {
  createCoachSuppression,
  mapCoachRange,
  mapCoachSuppression,
  suppressionMatchesIssue,
} from "./mapping.ts";

export interface CoachAnalysisSnapshot {
  readonly essayId: string;
  readonly revision: number;
  readonly documentLanguage: DocLocale;
  readonly citationEnvironmentVersion: number;
  readonly snapshotId: string;
  readonly passages: readonly CoachPassageSnapshot[];
}

export interface WritingCoachControllerOptions {
  readonly analyze?: (
    passages: readonly CoachPassageSnapshot[],
    generation: number,
  ) => CoachPassageAnalysis | Promise<CoachPassageAnalysis>;
}

const emptyState = (
  status: "idle" | "no-current-issues" | "unavailable-for-current-text",
): CoachControllerState => ({ status, issues: [], fixed: null });

const analyzingState = (
  prior: CoachControllerState,
): CoachControllerState => ({
  status: "analyzing",
  issues: prior.issues,
  fixed: prior.fixed,
});

function sameIdentity(
  left: CoachAnalysisSnapshot,
  right: CoachAnalysisSnapshot,
): boolean {
  return left.essayId === right.essayId && left.revision === right.revision &&
    left.documentLanguage === right.documentLanguage &&
    left.citationEnvironmentVersion === right.citationEnvironmentVersion &&
    left.snapshotId === right.snapshotId;
}

export function createWritingCoachController(
  essayId: string,
  options: WritingCoachControllerOptions = {},
) {
  const analyze = options.analyze ?? analyzeCoachPassages;
  let current: CoachAnalysisSnapshot | null = null;
  let state: CoachControllerState = emptyState("idle");
  let armed = false;
  let destroyed = false;
  let generation = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let maximumTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressions: CoachSuppression[] = [];

  const clearTimers = () => {
    if (trailingTimer !== null) clearTimeout(trailingTimer);
    if (maximumTimer !== null) clearTimeout(maximumTimer);
    trailingTimer = null;
    maximumTimer = null;
  };

  const publish = (
    captured: CoachAnalysisSnapshot,
    capturedGeneration: number,
    result: CoachPassageAnalysis,
  ) => {
    if (
      destroyed || capturedGeneration !== generation || !current ||
      !sameIdentity(captured, current)
    ) return;
    if (result.status === "unavailable-for-current-text") {
      state = emptyState("unavailable-for-current-text");
      return;
    }
    const visibleIssues = result.issues.filter((issue) =>
      !suppressions.some((suppression) =>
        suppressionMatchesIssue(issue, suppression)
      )
    );
    if (visibleIssues.length === 0) {
      state = emptyState("no-current-issues");
      return;
    }
    const fixed: FixedCoachSession = state.fixed ?? Object.freeze({
      kind: "fixed-coach-session" as const,
      issue: visibleIssues[0]!,
      position: 1,
      total: visibleIssues.length,
    });
    state = {
      status: "issues",
      issues: visibleIssues,
      fixed,
    };
  };

  const run = () => {
    clearTimers();
    if (destroyed || !armed || !current) return;
    const captured = current;
    const capturedGeneration = generation;
    queueMicrotask(() => {
      if (destroyed || capturedGeneration !== generation) return;
      Promise.resolve(analyze(captured.passages, capturedGeneration)).then(
        (result) => publish(captured, capturedGeneration, result),
      );
    });
  };

  const schedule = () => {
    if (!armed || destroyed || !current) return;
    state = analyzingState(state);
    if (trailingTimer !== null) clearTimeout(trailingTimer);
    trailingTimer = setTimeout(run, 300);
    if (maximumTimer === null) maximumTimer = setTimeout(run, 1_000);
  };

  return {
    getState: (): CoachControllerState => state,
    updateSnapshot(next: CoachAnalysisSnapshot): void {
      if (destroyed || next.essayId !== essayId) return;
      const invalidatesFixed = current !== null &&
        (current.documentLanguage !== next.documentLanguage ||
          current.citationEnvironmentVersion !==
            next.citationEnvironmentVersion);
      current = next;
      generation += 1;
      if (invalidatesFixed) {
        suppressions = [];
        state = emptyState("no-current-issues");
      }
      if (armed) schedule();
    },
    enterStudy(): void {
      if (destroyed || armed) return;
      armed = true;
      state = analyzingState(state);
      generation += 1;
      run();
    },
    reportExtractionFailure(): void {
      if (destroyed) return;
      generation += 1;
      clearTimers();
      state = emptyState("unavailable-for-current-text");
    },
    selectIssue(identity: string): void {
      if (state.status !== "issues") return;
      const index = state.issues.findIndex((issue) =>
        issue.identity === identity
      );
      if (index < 0) return;
      state = {
        ...state,
        fixed: Object.freeze({
          kind: "fixed-coach-session",
          issue: state.issues[index]!,
          position: index + 1,
          total: state.issues.length,
        }),
      };
    },
    nextIssue(): void {
      if (state.status !== "issues" || state.issues.length < 2) return;
      const fixed = state.fixed;
      const currentIndex = state.issues.findIndex((issue) =>
        issue.identity === fixed.issue.identity
      );
      const index = (currentIndex + 1) % state.issues.length;
      this.selectIssue(state.issues[index]!.identity);
    },
    previousIssue(): void {
      if (state.status !== "issues" || state.issues.length < 2) return;
      const fixed = state.fixed;
      const currentIndex = state.issues.findIndex((issue) =>
        issue.identity === fixed.issue.identity
      );
      const index = (currentIndex - 1 + state.issues.length) %
        state.issues.length;
      this.selectIssue(state.issues[index]!.identity);
    },
    invalidateFixedSource(): void {
      if (
        destroyed || state.fixed === null ||
        (state.status !== "issues" && state.status !== "analyzing")
      ) return;
      generation += 1;
      clearTimers();
      state = armed
        ? analyzingState(emptyState("no-current-issues"))
        : emptyState("idle");
    },
    mapFixedSource(
      mapping: Mapping,
      readText: (range: EditorRange) => string,
      revision: number,
    ): void {
      if (destroyed || state.fixed === null) return;
      const editorRange = mapCoachRange(state.fixed.issue.editorRange, mapping);
      if (
        !editorRange ||
        readText(editorRange) !== state.fixed.issue.issue.observedText
      ) {
        generation += 1;
        state = armed
          ? analyzingState(emptyState("no-current-issues"))
          : emptyState("idle");
        return;
      }
      const provisional: MappedCoachIssue = {
        ...state.fixed.issue,
        identity: "",
        passage: { ...state.fixed.issue.passage, revision },
        editorRange,
      };
      const fixed = Object.freeze({
        ...state.fixed,
        issue: Object.freeze({
          ...provisional,
          identity: mappedIssueIdentity(provisional),
        }),
      });
      state = { ...state, fixed };
    },
    suppressCurrent(action: CoachSuppression["action"]): void {
      if (state.status !== "issues") return;
      suppressions.push(createCoachSuppression(state.fixed.issue, action));
      const remaining = state.issues.filter((issue) =>
        !suppressions.some((suppression) =>
          suppressionMatchesIssue(issue, suppression)
        )
      );
      if (remaining.length === 0) {
        state = emptyState("no-current-issues");
        return;
      }
      state = {
        status: "issues",
        issues: remaining,
        fixed: Object.freeze({
          kind: "fixed-coach-session",
          issue: remaining[0]!,
          position: 1,
          total: remaining.length,
        }),
      };
    },
    mapSuppressions(
      mapping: Mapping,
      readText: (range: EditorRange) => string,
    ): void {
      suppressions = suppressions.flatMap((suppression) => {
        const mapped = mapCoachSuppression(suppression, mapping, readText);
        return mapped ? [mapped] : [];
      });
    },
    getSuppressions(): readonly CoachSuppression[] {
      return suppressions;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      clearTimers();
      current = null;
      suppressions = [];
      state = emptyState("idle");
    },
  };
}
