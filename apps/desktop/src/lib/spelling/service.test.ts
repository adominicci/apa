import { describe, expect, test, vi } from "vitest";
import {
  createSpellingService,
  createTauriSpellingClient,
  isEligibleSpellingSource,
} from "./service";
import type {
  NativeCheckRequest,
  NativeClient,
  NativeSpellingResult,
  SpellingIssue,
  SpellingTextSource,
} from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function completed(
  request: NativeCheckRequest,
  issues: SpellingIssue[] = [],
): NativeSpellingResult {
  return {
    status: "completed",
    requestId: request.requestId,
    documentRevision: request.documentRevision,
    selectedLanguageTag: request.language === "en" ? "en-US" : "es-ES",
    issues,
  };
}

function fakeNative(
  check: NativeClient["check"] = (request) =>
    Promise.resolve(completed(request)),
): NativeClient {
  return {
    capability: vi.fn((language) =>
      Promise.resolve({
        status: "available" as const,
        language,
        selectedLanguageTag: language === "en" ? "en-US" : "es-ES",
      })
    ),
    check: vi.fn(check),
    cancel: vi.fn(() => Promise.resolve()),
  };
}

const validInput = {
  contextId: "editor:essay-1",
  documentRevision: 7,
  language: "en" as const,
  documentStart: 0,
  text: "Correct text",
};

describe("spelling service facade", () => {
  test("uses the exact Tauri capability, check, and cancel serialization", async () => {
    const invoke = vi.fn(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "spelling_capability") {
          return Promise.resolve({
            status: "available",
            language: "en",
            selectedLanguageTag: "en-US",
          });
        }
        if (command === "spelling_check") {
          const request = args?.request as NativeCheckRequest;
          return Promise.resolve(completed(request));
        }
        return Promise.resolve(undefined);
      },
    );
    const client = createTauriSpellingClient(invoke);
    const request: NativeCheckRequest = {
      requestId: "session:1",
      documentRevision: 3,
      language: "en",
      documentStart: 5,
      text: "wrngg",
    };

    await client.capability("en");
    await client.check(request);
    await client.cancel("session:1");

    expect(invoke.mock.calls).toEqual([
      ["spelling_capability", { language: "en" }],
      ["spelling_check", { request }],
      ["spelling_cancel", { requestId: "session:1" }],
    ]);
  });

  test("reports English and Spanish capability without conflating an absent dictionary", async () => {
    const native = fakeNative();
    vi.mocked(native.capability).mockResolvedValueOnce({
      status: "missing-dictionary",
      language: "es",
      helpCode: "install-system-dictionary",
    });
    const service = createSpellingService(native);

    await expect(service.capability("es")).resolves.toEqual({
      status: "missing-dictionary",
      language: "es",
      helpCode: "install-system-dictionary",
    });
    await expect(service.capability("en")).resolves.toMatchObject({
      status: "available",
      selectedLanguageTag: "en-US",
    });
  });

  test("routes empty text through native admission while the platform check stays bypassed", async () => {
    const native = fakeNative();
    const service = createSpellingService(native);

    await expect(service.check({ ...validInput, text: "" })).resolves.toEqual({
      status: "completed",
      requestId: expect.any(String),
      documentRevision: 7,
      selectedLanguageTag: "en-US",
      issues: [],
    });
    expect(native.capability).not.toHaveBeenCalled();
    expect(native.check).toHaveBeenCalledOnce();
    expect(vi.mocked(native.check).mock.calls[0][0].text).toBe("");
  });

  test("returns busy for a third empty request while two native slots are occupied", async () => {
    const held = [
      deferred<NativeSpellingResult>(),
      deferred<NativeSpellingResult>(),
    ];
    let admitted = 0;
    const native = fakeNative((request) => {
      if (admitted < 2) return held[admitted++].promise;
      return Promise.resolve({
        status: "busy",
        requestId: request.requestId,
        documentRevision: request.documentRevision,
        code: "busy",
      });
    });
    const service = createSpellingService(native);
    const first = service.check({
      ...validInput,
      contextId: "empty:1",
      text: "",
    });
    const second = service.check({
      ...validInput,
      contextId: "empty:2",
      text: "",
    });
    await vi.waitFor(() => expect(native.check).toHaveBeenCalledTimes(2));

    await expect(
      service.check({ ...validInput, contextId: "empty:3", text: "" }),
    )
      .resolves.toMatchObject({ status: "busy", code: "busy" });

    const firstRequest = vi.mocked(native.check).mock.calls[0][0];
    const secondRequest = vi.mocked(native.check).mock.calls[1][0];
    held[0].resolve(completed(firstRequest));
    held[1].resolve(completed(secondRequest));
    await Promise.all([first, second]);
  });

  test("cancels empty text while native capability work is active", async () => {
    const pending = deferred<NativeSpellingResult>();
    const native = fakeNative(() => pending.promise);
    const service = createSpellingService(native);
    const controller = new AbortController();
    const result = service.check(
      { ...validInput, text: "" },
      controller.signal,
    );
    await vi.waitFor(() => expect(native.check).toHaveBeenCalledOnce());
    const request = vi.mocked(native.check).mock.calls[0][0];

    controller.abort();
    await vi.waitFor(() =>
      expect(native.cancel).toHaveBeenCalledWith(request.requestId)
    );
    pending.resolve({
      status: "cancelled",
      requestId: request.requestId,
      documentRevision: request.documentRevision,
    });

    await expect(result).resolves.toMatchObject({
      status: "cancelled",
      requestId: request.requestId,
    });
  });

  test("generates session-unique request IDs across contexts and reports fixed dialects", async () => {
    const native = fakeNative();
    const serviceA = createSpellingService(native);
    const serviceB = createSpellingService(native);
    const first = await serviceA.check(validInput);
    const second = await serviceB.check({
      ...validInput,
      contextId: "editor:essay-2",
      language: "es",
    });

    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.requestId).toMatch(/^[0-9a-f-]+:\d+$/);
    expect(second).toMatchObject({ selectedLanguageTag: "es-ES" });
  });

  test("clears completed context correlation before the next request", async () => {
    const native = fakeNative();
    const service = createSpellingService(native);

    await service.check(validInput);
    await service.check({ ...validInput, documentRevision: 8 });

    expect(native.cancel).not.toHaveBeenCalled();
  });

  test("clears early-aborted context correlation before the next request", async () => {
    const native = fakeNative();
    const service = createSpellingService(native);
    const controller = new AbortController();
    controller.abort();

    const aborted = await service.check(validInput, controller.signal);
    await service.check({ ...validInput, documentRevision: 8 });

    expect(aborted.status).toBe("cancelled");
    expect(native.cancel).toHaveBeenCalledTimes(1);
    expect(native.cancel).toHaveBeenCalledWith(aborted.requestId);
  });

  test.each([
    [{ ...validInput, contextId: "" }, "empty context"],
    [{ ...validInput, documentRevision: -1 }, "negative revision"],
    [{ ...validInput, documentRevision: 1.5 }, "fractional revision"],
    [{ ...validInput, documentStart: -1 }, "negative offset"],
    [
      { ...validInput, documentStart: Number.MAX_SAFE_INTEGER, text: "xx" },
      "unsafe end",
    ],
    [{ ...validInput, text: "x".repeat(65_537) }, "oversized text"],
  ])("rejects %s before native work", async (input) => {
    const native = fakeNative();
    const service = createSpellingService(native);

    await expect(service.check(input as typeof validInput)).resolves
      .toMatchObject({
        status: "failed",
        code: "invalid-request",
      });
    expect(native.check).not.toHaveBeenCalled();
  });

  test("preserves punctuation, repeated words, UTF-16 ranges, and filtered suggestions", async () => {
    const native = fakeNative((request) =>
      Promise.resolve(completed(request, [
        { from: 14, to: 19, word: "wrngg", suggestions: ["wrong", "wring"] },
        { from: 3, to: 8, word: "wrngg", suggestions: ["wrong", "wring"] },
      ]))
    );
    const service = createSpellingService(native);

    const result = await service.check({
      ...validInput,
      documentStart: 0,
      text: "😀 wrngg, and wrngg.",
    });

    expect(result).toMatchObject({
      status: "completed",
      issues: [
        { from: 3, to: 8, word: "wrngg", suggestions: ["wrong", "wring"] },
        { from: 14, to: 19, word: "wrngg", suggestions: ["wrong", "wring"] },
      ],
    });
  });

  test("keeps the complete text-source allowlist explicit", () => {
    const eligible: SpellingTextSource[] = ["body-prose", "paper-title"];
    const excluded: SpellingTextSource[] = [
      "generated-citation",
      "generated-reference",
      "url",
      "equation",
      "identifier",
      "author",
      "institution",
      "course",
      "instructor",
      "proper-name-heavy",
    ];

    expect(eligible.every(isEligibleSpellingSource)).toBe(true);
    expect(excluded.some(isEligibleSpellingSource)).toBe(false);
    expect(excluded.every((source) => !isEligibleSpellingSource(source))).toBe(
      true,
    );
  });

  test("cancels an older context request and discards its stale revision", async () => {
    const old = deferred<NativeSpellingResult>();
    const native = fakeNative((request) =>
      request.documentRevision === 1
        ? old.promise
        : Promise.resolve(completed(request))
    );
    const service = createSpellingService(native);
    const firstPromise = service.check({ ...validInput, documentRevision: 1 });
    await vi.waitFor(() => expect(native.check).toHaveBeenCalledTimes(1));

    const second = await service.check({ ...validInput, documentRevision: 2 });
    const firstRequest = vi.mocked(native.check).mock.calls[0][0];
    old.resolve(completed(firstRequest, [
      { from: 0, to: 3, word: "bad", suggestions: ["bed"] },
    ]));

    await expect(firstPromise).resolves.toMatchObject({
      status: "stale",
      requestId: firstRequest.requestId,
      documentRevision: 1,
    });
    expect(second.status).toBe("completed");
    expect(native.cancel).toHaveBeenCalledWith(firstRequest.requestId);
  });

  test("discards a native response with mismatched correlation", async () => {
    const native = fakeNative((request) =>
      Promise.resolve({
        status: "completed",
        requestId: `${request.requestId}:wrong`,
        documentRevision: request.documentRevision + 1,
        selectedLanguageTag: "en-US",
        issues: [{ from: 0, to: 3, word: "bad", suggestions: ["bed"] }],
      })
    );
    const service = createSpellingService(native);

    const result = await service.check(validInput);

    expect(result).toMatchObject({
      status: "stale",
      documentRevision: validInput.documentRevision,
    });
    expect("issues" in result).toBe(false);
    expect(result.requestId).not.toContain(":wrong");
  });

  test("forwards AbortSignal cancellation without affecting later requests", async () => {
    const native = fakeNative();
    const service = createSpellingService(native);
    const controller = new AbortController();
    controller.abort();

    const cancelled = await service.check(validInput, controller.signal);
    const later = await service.check({
      ...validInput,
      contextId: "editor:later",
    });

    expect(cancelled.status).toBe("cancelled");
    expect(later.status).toBe("completed");
    expect(cancelled.requestId).not.toBe(later.requestId);
  });

  test("preserves native busy results while cancelled native work retains capacity", async () => {
    const native = fakeNative((request) =>
      Promise.resolve({
        status: "busy",
        requestId: request.requestId,
        documentRevision: request.documentRevision,
        code: "busy",
      })
    );
    const service = createSpellingService(native);

    await expect(service.check(validInput)).resolves.toMatchObject({
      status: "busy",
      code: "busy",
    });
  });

  test("returns stable adapter failures without native details", async () => {
    const native = fakeNative((request) =>
      Promise.resolve({
        status: "failed",
        requestId: request.requestId,
        documentRevision: request.documentRevision,
        code: "adapter-failure",
      })
    );
    const service = createSpellingService(native);

    await expect(service.check(validInput)).resolves.toEqual({
      status: "failed",
      requestId: expect.any(String),
      documentRevision: 7,
      code: "adapter-failure",
    });
  });
});
