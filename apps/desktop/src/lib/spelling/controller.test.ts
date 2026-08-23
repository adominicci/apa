import { describe, expect, it, vi } from "vitest";
import type { SpellingService } from "./types.ts";
import {
  createSpellingController,
  type SpellingAnalysisSnapshot,
} from "./controller.ts";

const asyncValue = <T>(value: T): Promise<T> => Promise.resolve(value);

const doc = (word: string) => ({
  type: "doc",
  content: [{
    type: "sectionBody",
    content: [{ type: "paragraph", content: [{ type: "text", text: word }] }],
  }],
});

function snapshot(overrides: Partial<SpellingAnalysisSnapshot> = {}) {
  return {
    essayId: "essay-1",
    title: "titl",
    doc: doc("bodi"),
    documentLanguage: "en" as const,
    documentIgnores: [],
    personalDictionary: [],
    ...overrides,
  };
}

describe("unified spelling analysis controller", () => {
  it("checks capability once, chunks sequentially, and publishes title first atomically", async () => {
    let active = 0;
    let maxActive = 0;
    const calls: Array<{ contextId: string; language: string; text: string }> =
      [];
    const service: SpellingService = {
      capability: vi.fn(() =>
        asyncValue({
          status: "available" as const,
          language: "en" as const,
          selectedLanguageTag: "en",
        })
      ),
      check: vi.fn(async (input: Parameters<SpellingService["check"]>[0]) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push(input);
        await Promise.resolve();
        active -= 1;
        return {
          status: "completed" as const,
          requestId: input.text,
          documentRevision: input.documentRevision,
          selectedLanguageTag: "en",
          issues: [{
            from: input.documentStart,
            to: input.documentStart + input.text.length,
            word: input.text,
            suggestions: [`${input.text}e`],
          }],
        };
      }),
    };
    const controller = createSpellingController({ service, read: snapshot });
    await controller.checkNow();
    expect(service.capability).toHaveBeenCalledTimes(1);
    expect(maxActive).toBe(1);
    expect(new Set(calls.map((call) => call.contextId)).size).toBe(1);
    expect(calls.every((call) => call.language === "en")).toBe(true);
    expect(controller.state.status).toBe("issues");
    expect(controller.state.issues.map((issue) => issue.source)).toEqual([
      "paper-title",
      "body",
    ]);
    expect(controller.state.issues.every((issue) => issue.generation === 0))
      .toBe(true);
  });

  it("invalidates the complete generation and ignore-once state on either source mutation", async () => {
    let resolveCheck!: (
      value: Awaited<ReturnType<SpellingService["check"]>>,
    ) => void;
    const service: SpellingService = {
      capability: () =>
        asyncValue({
          status: "available",
          language: "en",
          selectedLanguageTag: "en",
        }),
      check: () => new Promise((resolve) => (resolveCheck = resolve)),
    };
    const controller = createSpellingController({ service, read: snapshot });
    const checking = controller.checkNow();
    await Promise.resolve();
    controller.invalidate("paper-title");
    expect(controller.generation).toBe(1);
    expect(controller.state.issues).toEqual([]);
    resolveCheck({
      status: "cancelled",
      requestId: "old",
      documentRevision: 0,
    });
    await checking;
    expect(controller.state.status).toBe("idle");
  });

  it.each(
    [
      ["missing-dictionary", "missing-dictionary"],
      ["unavailable", "unavailable"],
    ] as const,
  )("publishes truthful %s capability state without checking chunks", async (
    capabilityStatus,
    expected,
  ) => {
    const service: SpellingService = {
      capability: () =>
        asyncValue(
          capabilityStatus === "missing-dictionary"
            ? {
              status: "missing-dictionary",
              language: "es",
              helpCode: "install-system-dictionary",
            }
            : {
              status: "unavailable",
              language: "es",
              reason: "api-unavailable",
            },
        ),
      check: vi.fn(),
    };
    const controller = createSpellingController({
      service,
      read: () => snapshot({ documentLanguage: "es" }),
    });
    await controller.checkNow();
    expect(controller.state.status).toBe(expected);
    expect(service.check).not.toHaveBeenCalled();
  });

  it("distinguishes a complete zero-issue batch from busy and failed batches", async () => {
    const outcomes = ["completed", "busy", "failed"] as const;
    for (const outcome of outcomes) {
      const service: SpellingService = {
        capability: () =>
          asyncValue({
            status: "available",
            language: "en",
            selectedLanguageTag: "en",
          }),
        check: (input) =>
          asyncValue(
            outcome === "completed"
              ? {
                status: "completed",
                requestId: "ok",
                documentRevision: input.documentRevision,
                selectedLanguageTag: "en",
                issues: [],
              }
              : outcome === "busy"
              ? {
                status: "busy",
                requestId: "busy",
                documentRevision: input.documentRevision,
                code: "busy",
              }
              : {
                status: "failed",
                requestId: "failed",
                documentRevision: input.documentRevision,
                code: "adapter-failure",
              },
          ),
      };
      const controller = createSpellingController({ service, read: snapshot });
      await controller.checkNow();
      expect(controller.state.status).toBe(
        outcome === "completed" ? "issue-free" : outcome,
      );
      expect(controller.state.issues).toEqual([]);
      controller.destroy();
    }
  });

  it("keeps Ignore once occurrence-specific and drops it across source mutations", async () => {
    const service: SpellingService = {
      capability: () =>
        asyncValue({
          status: "available",
          language: "en",
          selectedLanguageTag: "en",
        }),
      check: (input) =>
        asyncValue({
          status: "completed",
          requestId: input.text,
          documentRevision: input.documentRevision,
          selectedLanguageTag: "en",
          issues: [{
            from: input.documentStart,
            to: input.documentStart + input.text.length,
            word: input.text,
            suggestions: [],
          }],
        }),
    };
    const controller = createSpellingController({ service, read: snapshot });
    await controller.checkNow();
    const titleIssue = controller.state.issues[0]!;
    expect(controller.ignoreOnce(titleIssue)).toBe(true);
    expect(controller.state.issues.map((item) => item.source)).toEqual([
      "body",
    ]);
    controller.invalidate("body");
    await controller.checkNow();
    expect(controller.state.issues.map((item) => item.source)).toEqual([
      "paper-title",
      "body",
    ]);
  });

  it("filters document and personal terms across both sources and navigates pinned order", async () => {
    const service: SpellingService = {
      capability: () =>
        asyncValue({
          status: "available",
          language: "en",
          selectedLanguageTag: "en",
        }),
      check: (input) =>
        asyncValue({
          status: "completed",
          requestId: input.text,
          documentRevision: input.documentRevision,
          selectedLanguageTag: "en",
          issues: [{
            from: input.documentStart,
            to: input.documentStart + input.text.length,
            word: input.text,
            suggestions: [],
          }],
        }),
    };
    const controller = createSpellingController({
      service,
      read: () =>
        snapshot({
          title: "same",
          doc: doc("other"),
          documentIgnores: ["same"],
          personalDictionary: [],
        }),
    });
    await controller.checkNow();
    expect(controller.state.issues.map((item) => item.word)).toEqual(["other"]);
    expect(controller.nextIssue()).toBe(controller.state.issues[0]);
  });
});
