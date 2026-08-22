export const SPELLING_CONTRACT_VERSION = 1 as const;
export const MAX_SPELLING_TEXT_LENGTH = 65_536;

export type DocumentLanguage = "en" | "es";

export type SpellingTextSource =
  | "body-prose"
  | "paper-title"
  | "generated-citation"
  | "generated-reference"
  | "url"
  | "equation"
  | "identifier"
  | "author"
  | "institution"
  | "course"
  | "instructor"
  | "proper-name-heavy";

export type CapabilityResult =
  | {
    status: "available";
    language: DocumentLanguage;
    selectedLanguageTag: string;
  }
  | {
    status: "missing-dictionary";
    language: DocumentLanguage;
    helpCode: "install-system-dictionary";
  }
  | {
    status: "unavailable";
    language: DocumentLanguage;
    reason: "api-unavailable";
  };

export interface SpellingIssue {
  from: number;
  to: number;
  word: string;
  suggestions: string[];
}

export interface SpellingCheckInput {
  contextId: string;
  documentRevision: number;
  language: DocumentLanguage;
  documentStart: number;
  text: string;
}

export interface NativeCheckRequest {
  requestId: string;
  documentRevision: number;
  language: DocumentLanguage;
  documentStart: number;
  text: string;
}

type Correlation = {
  requestId: string;
  documentRevision: number;
};

export type NativeSpellingResult =
  | Correlation & {
    status: "completed";
    selectedLanguageTag: string;
    issues: SpellingIssue[];
  }
  | Correlation & { status: "cancelled" }
  | Correlation & { status: "busy"; code: "busy" }
  | Correlation & {
    status: "failed";
    code:
      | "api-unavailable"
      | "missing-dictionary"
      | "invalid-request"
      | "adapter-failure";
  };

export type SpellingResult =
  | NativeSpellingResult
  | Correlation & { status: "stale" };

export interface NativeClient {
  capability(language: DocumentLanguage): Promise<CapabilityResult>;
  check(request: NativeCheckRequest): Promise<NativeSpellingResult>;
  cancel(requestId: string): Promise<void>;
}

export interface SpellingService {
  capability(language: DocumentLanguage): Promise<CapabilityResult>;
  check(
    input: SpellingCheckInput,
    signal?: AbortSignal,
  ): Promise<SpellingResult>;
}
