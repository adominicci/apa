import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CoachAnalysisSnapshot,
  createWritingCoachController,
} from "./controller.ts";
import type { CoachPassageSnapshot } from "./types.ts";

function snapshot(
  revision: number,
  text = "The policy changed in many ways during review.",
  overrides: Partial<CoachAnalysisSnapshot> = {},
): CoachAnalysisSnapshot {
  const passage: CoachPassageSnapshot = {
    kind: "coach-passage-snapshot",
    passageId: `essay-1:${revision}:1`,
    essayId: "essay-1",
    revision,
    documentLanguage: overrides.documentLanguage ?? "en",
    citationEnvironmentVersion: overrides.citationEnvironmentVersion ?? 1,
    text,
    offsetMap: Array.from({ length: text.length + 1 }, (_, index) => 2 + index),
    protectedSpans: [],
  };
  return {
    essayId: "essay-1",
    revision,
    documentLanguage: "en",
    citationEnvironmentVersion: 1,
    snapshotId: `snapshot-${revision}`,
    passages: [passage],
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("essay-scoped writing coach scheduling", () => {
  it("stays idle before Study and analyzes the current snapshot immediately on first entry", async () => {
    vi.useFakeTimers();
    const controller = createWritingCoachController("essay-1");
    controller.updateSnapshot(snapshot(1));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.getState().status).toBe("idle");

    controller.enterStudy();
    expect(controller.getState().status).toBe("analyzing");
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().status).toBe("issues");
    controller.destroy();
  });

  it("uses a 300 ms trailing timer and the latest snapshot", async () => {
    vi.useFakeTimers();
    const controller = createWritingCoachController("essay-1");
    controller.updateSnapshot(snapshot(1));
    controller.enterStudy();
    await vi.advanceTimersByTimeAsync(0);

    controller.updateSnapshot(
      snapshot(2, "The draft changed in many ways during review."),
    );
    await vi.advanceTimersByTimeAsync(299);
    expect(controller.getState().status).toBe("analyzing");
    controller.updateSnapshot(
      snapshot(3, "Various aspects shaped the final review."),
    );
    await vi.advanceTimersByTimeAsync(299);
    expect(controller.getState().status).toBe("analyzing");
    await vi.advanceTimersByTimeAsync(1);
    const state = controller.getState();
    expect(state.status).toBe("issues");
    if (state.status === "issues") {
      expect(state.issues[0]?.passage.revision).toBe(3);
      expect(state.issues[0]?.issue.observedText).toBe("Various aspects");
    }
    controller.destroy();
  });

  it("runs by 1,000 ms during continuous changes and clears timers on destroy", async () => {
    vi.useFakeTimers();
    const controller = createWritingCoachController("essay-1");
    controller.updateSnapshot(snapshot(1));
    controller.enterStudy();
    await vi.advanceTimersByTimeAsync(0);
    controller.updateSnapshot(snapshot(2));
    for (const revision of [3, 4, 5]) {
      await vi.advanceTimersByTimeAsync(250);
      controller.updateSnapshot(snapshot(revision));
    }
    await vi.advanceTimersByTimeAsync(249);
    expect(controller.getState().status).toBe("analyzing");
    await vi.advanceTimersByTimeAsync(1);
    const state = controller.getState();
    expect(state.status).toBe("issues");
    if (state.status === "issues") {
      expect(state.issues[0]?.passage.revision).toBe(5);
    }

    controller.updateSnapshot(snapshot(6));
    controller.destroy();
    await vi.runAllTimersAsync();
    expect(controller.getState().status).toBe("idle");
  });
});

describe("stale analysis rejection", () => {
  it.each([
    ["revision", { revision: 2, snapshotId: "snapshot-2" }],
    ["language", {
      documentLanguage: "es" as const,
      snapshotId: "snapshot-es",
    }],
    ["citation environment", {
      citationEnvironmentVersion: 2,
      snapshotId: "snapshot-citation",
    }],
    ["snapshot", { snapshotId: "replacement" }],
  ])("rejects an older generation after %s changes", async (_label, change) => {
    vi.useFakeTimers();
    const pending: Array<
      (
        value: ReturnType<
          typeof import("./analysisAdapter.ts")["analyzeCoachPassages"]
        >,
      ) => void
    > = [];
    const controller = createWritingCoachController("essay-1", {
      analyze: () => new Promise((resolve) => pending.push(resolve)),
    });
    controller.updateSnapshot(snapshot(1));
    controller.enterStudy();
    await vi.advanceTimersByTimeAsync(0);
    controller.updateSnapshot(snapshot(1, undefined, change));
    pending.shift()?.({ status: "available", issues: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().status).toBe("analyzing");
    controller.destroy();
  });

  it("fails closed on extraction failure, essay mismatch, external refresh, and teardown", async () => {
    vi.useFakeTimers();
    const controller = createWritingCoachController("essay-1");
    controller.updateSnapshot(snapshot(1));
    controller.enterStudy();
    await vi.advanceTimersByTimeAsync(0);
    controller.reportExtractionFailure();
    expect(controller.getState().status).toBe("unavailable-for-current-text");
    controller.updateSnapshot(snapshot(2, undefined, { essayId: "essay-2" }));
    expect(controller.getState().status).toBe("unavailable-for-current-text");
    controller.updateSnapshot(
      snapshot(3, undefined, { citationEnvironmentVersion: 3 }),
    );
    expect(controller.getState().status).toBe("analyzing");
    controller.destroy();
    expect(controller.getState().status).toBe("idle");
  });
});

describe("fixed question-led sessions", () => {
  it("keeps the selected full passage fixed across unrelated background analysis", async () => {
    vi.useFakeTimers();
    const controller = createWritingCoachController("essay-1");
    controller.updateSnapshot(snapshot(1));
    controller.enterStudy();
    await vi.advanceTimersByTimeAsync(0);
    const first = controller.getState();
    if (first.status !== "issues") throw new Error("expected issues");
    const fixed = first.fixed;

    controller.updateSnapshot(
      snapshot(2, "Various aspects shaped a separate paragraph."),
    );
    expect(controller.getState().fixed).toBe(fixed);
    await vi.advanceTimersByTimeAsync(300);
    const updated = controller.getState();
    expect(updated.status).toBe("issues");
    if (updated.status === "issues") {
      expect(updated.fixed).toBe(fixed);
      expect(updated.fixed.issue.passage.text).toBe(
        "The policy changed in many ways during review.",
      );
      expect(updated.issues[0]?.passage.revision).toBe(2);
    }
    controller.destroy();
  });

  it("uses explicit deterministic selection and wraps only with multiple issues", async () => {
    vi.useFakeTimers();
    const controller = createWritingCoachController("essay-1");
    const text =
      "It is important to note that the policy changed in many ways during review.";
    controller.updateSnapshot(snapshot(1, text));
    controller.enterStudy();
    await vi.advanceTimersByTimeAsync(0);
    const initial = controller.getState();
    if (initial.status !== "issues") throw new Error("expected issues");
    expect(initial.issues.map((issue) => issue.issue.category)).toEqual([
      "voice",
      "specificity",
    ]);
    controller.nextIssue();
    expect(controller.getState().fixed?.position).toBe(2);
    controller.nextIssue();
    expect(controller.getState().fixed?.position).toBe(1);
    controller.previousIssue();
    expect(controller.getState().fixed?.position).toBe(2);
    controller.selectIssue(initial.issues[0]!.identity);
    expect(controller.getState().fixed?.position).toBe(1);
    controller.destroy();

    const single = createWritingCoachController("essay-1");
    single.updateSnapshot(snapshot(1));
    single.enterStudy();
    await vi.advanceTimersByTimeAsync(0);
    const fixed = single.getState().fixed;
    single.nextIssue();
    single.previousIssue();
    expect(single.getState().fixed).toBe(fixed);
    single.destroy();
  });

  it("invalidates fixed sessions on source, language, citation, essay, and lifecycle changes", async () => {
    vi.useFakeTimers();
    const controller = createWritingCoachController("essay-1");
    controller.updateSnapshot(snapshot(1));
    controller.enterStudy();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().fixed).not.toBeNull();
    controller.invalidateFixedSource();
    expect(controller.getState().fixed).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    controller.updateSnapshot(
      snapshot(2, undefined, { documentLanguage: "es" }),
    );
    expect(controller.getState().fixed).toBeNull();
    controller.updateSnapshot(
      snapshot(3, undefined, { citationEnvironmentVersion: 2 }),
    );
    expect(controller.getState().fixed).toBeNull();
    controller.updateSnapshot(snapshot(4, undefined, { essayId: "essay-2" }));
    expect(controller.getState().fixed).toBeNull();
    controller.destroy();
    expect(controller.getState()).toEqual({
      status: "idle",
      issues: [],
      fixed: null,
    });
  });
});
