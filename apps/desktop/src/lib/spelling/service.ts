import { invoke } from "@tauri-apps/api/core";
import type {
  CapabilityResult,
  DocumentLanguage,
  NativeCheckRequest,
  NativeClient,
  NativeSpellingResult,
  SpellingCheckInput,
  SpellingIssue,
  SpellingResult,
  SpellingService,
  SpellingTextSource,
} from "./types";
import { MAX_SPELLING_TEXT_LENGTH } from "./types";

const sessionNonce = crypto.randomUUID();
let requestCounter = 0n;

function nextRequestId(): string {
  requestCounter += 1n;
  return `${sessionNonce}:${requestCounter}`;
}

function invalidInput(input: SpellingCheckInput): boolean {
  return input.contextId.length === 0 ||
    !Number.isSafeInteger(input.documentRevision) ||
    input.documentRevision < 0 ||
    !Number.isSafeInteger(input.documentStart) || input.documentStart < 0 ||
    input.text.length > MAX_SPELLING_TEXT_LENGTH ||
    !Number.isSafeInteger(input.documentStart + input.text.length) ||
    (input.language !== "en" && input.language !== "es");
}

function filteredSuggestions(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value.length === 0 || result.includes(value)) continue;
    result.push(value);
    if (result.length === 8) break;
  }
  return result;
}

function normalizedIssues(issues: SpellingIssue[]): SpellingIssue[] {
  return issues
    .map((issue) => ({
      ...issue,
      suggestions: filteredSuggestions(issue.suggestions),
    }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

export function isEligibleSpellingSource(source: SpellingTextSource): boolean {
  return source === "body-prose" || source === "paper-title";
}

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export function createTauriSpellingClient(
  invokeCommand: InvokeCommand = (command, args) => invoke(command, args),
): NativeClient {
  return {
    capability: (language) =>
      invokeCommand("spelling_capability", { language }) as Promise<
        CapabilityResult
      >,
    check: (request) =>
      invokeCommand("spelling_check", { request }) as Promise<
        NativeSpellingResult
      >,
    cancel: async (requestId) => {
      await invokeCommand("spelling_cancel", { requestId });
    },
  };
}

export function createSpellingService(native: NativeClient): SpellingService {
  const latestByContext = new Map<
    string,
    { requestId: string; documentRevision: number }
  >();
  const clearCurrent = (
    contextId: string,
    correlation: { requestId: string; documentRevision: number },
  ) => {
    const latest = latestByContext.get(contextId);
    if (
      latest?.requestId === correlation.requestId &&
      latest.documentRevision === correlation.documentRevision
    ) {
      latestByContext.delete(contextId);
    }
  };

  return {
    capability(language: DocumentLanguage) {
      return native.capability(language);
    },

    async check(
      input: SpellingCheckInput,
      signal?: AbortSignal,
    ): Promise<SpellingResult> {
      const requestId = nextRequestId();
      const correlation = {
        requestId,
        documentRevision: input.documentRevision,
      };
      if (invalidInput(input)) {
        return { status: "failed", ...correlation, code: "invalid-request" };
      }

      const previous = latestByContext.get(input.contextId);
      latestByContext.set(input.contextId, correlation);
      if (previous) {
        void native.cancel(previous.requestId).catch(() => undefined);
      }

      if (signal?.aborted) {
        void native.cancel(requestId).catch(() => undefined);
        clearCurrent(input.contextId, correlation);
        return { status: "cancelled", ...correlation };
      }

      const abort = () => void native.cancel(requestId).catch(() => undefined);
      signal?.addEventListener("abort", abort, { once: true });

      const request: NativeCheckRequest = {
        requestId,
        documentRevision: input.documentRevision,
        language: input.language,
        documentStart: input.documentStart,
        text: input.text,
      };

      try {
        const result = await native.check(request);

        const latest = latestByContext.get(input.contextId);
        if (
          !latest || latest.requestId !== requestId ||
          latest.documentRevision !== input.documentRevision ||
          result.requestId !== requestId ||
          result.documentRevision !== input.documentRevision
        ) {
          return { status: "stale", ...correlation };
        }
        if (result.status === "completed") {
          return { ...result, issues: normalizedIssues(result.issues) };
        }
        return result;
      } catch {
        return { status: "failed", ...correlation, code: "adapter-failure" };
      } finally {
        signal?.removeEventListener("abort", abort);
        clearCurrent(input.contextId, correlation);
      }
    },
  };
}
