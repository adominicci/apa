import type { DocLocale } from "@tesina/engine";

export const COACH_CONTRACT_VERSION = 1 as const;
export const COACH_CATEGORIES = [
  "specificity",
  "evidence",
  "clarity",
  "economy",
  "repetition",
  "voice",
] as const;
export type CoachCategory = typeof COACH_CATEGORIES[number];

export type ProtectedSpanKind =
  | "citation"
  | "quotation"
  | "source-title"
  | "proper-name";

export interface ProtectedSpan {
  from: number;
  to: number;
  kind: ProtectedSpanKind;
}

export interface WritingCoachRequest {
  text: string;
  documentLanguage: DocLocale;
  documentStart: number;
  protectedSpans: readonly ProtectedSpan[];
}

export interface CoachMessageMap {
  "coach.specificity.explanation": { observedText: string };
  "coach.specificity.question": { observedText: string };
  "coach.evidence.explanation": { observedText: string };
  "coach.evidence.question": { observedText: string };
  "coach.clarity.explanation": { observedText: string };
  "coach.clarity.question": { observedText: string };
  "coach.economy.explanation": { observedText: string };
  "coach.economy.question": { observedText: string };
  "coach.repetition.explanation": { observedText: string };
  "coach.repetition.question": { observedText: string };
  "coach.voice.explanation": { observedText: string };
  "coach.voice.question": { observedText: string };
}

export type CoachMessageId = keyof CoachMessageMap;
export type CoachMessageDescriptor<I extends CoachMessageId = CoachMessageId> =
  I extends CoachMessageId ? { id: I; params: CoachMessageMap[I] } : never;

export interface WritingCoachIssue {
  from: number;
  to: number;
  observedText: string;
  category: CoachCategory;
  explanation: CoachMessageDescriptor;
  learningQuestion: CoachMessageDescriptor;
  source: "deterministic";
}

export type CoachInputErrorCode =
  | "invalid-request"
  | "text-too-long"
  | "unsupported-document-language"
  | "invalid-document-start"
  | "unsafe-document-end"
  | "invalid-protected-span"
  | "protected-span-outside-snapshot"
  | "protected-span-splits-surrogate";

export class CoachInputError extends TypeError {
  override readonly name = "CoachInputError";
  constructor(readonly code: CoachInputErrorCode) {
    super(code);
  }
}

function isBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 &&
    after <= 0xdfff);
}

export function validateWritingCoachRequest(
  input: unknown,
): WritingCoachRequest {
  if (!input || typeof input !== "object") {
    throw new CoachInputError("invalid-request");
  }
  const request = input as Partial<WritingCoachRequest>;
  if (
    typeof request.text !== "string" || !Array.isArray(request.protectedSpans)
  ) {
    throw new CoachInputError("invalid-request");
  }
  if (request.text.length > 65_536) throw new CoachInputError("text-too-long");
  if (request.documentLanguage !== "en" && request.documentLanguage !== "es") {
    throw new CoachInputError("unsupported-document-language");
  }
  if (
    !Number.isSafeInteger(request.documentStart) || request.documentStart! < 0
  ) {
    throw new CoachInputError("invalid-document-start");
  }
  const documentEnd = request.documentStart! + request.text.length;
  if (!Number.isSafeInteger(documentEnd)) {
    throw new CoachInputError("unsafe-document-end");
  }
  const kinds = new Set<ProtectedSpanKind>([
    "citation",
    "quotation",
    "source-title",
    "proper-name",
  ]);
  for (const value of request.protectedSpans) {
    const span = value as Partial<ProtectedSpan>;
    if (
      !Number.isSafeInteger(span.from) || !Number.isSafeInteger(span.to) ||
      span.from! >= span.to! || !kinds.has(span.kind as ProtectedSpanKind)
    ) throw new CoachInputError("invalid-protected-span");
    if (span.from! < request.documentStart! || span.to! > documentEnd) {
      throw new CoachInputError("protected-span-outside-snapshot");
    }
    if (
      !isBoundary(request.text, span.from! - request.documentStart!) ||
      !isBoundary(request.text, span.to! - request.documentStart!)
    ) throw new CoachInputError("protected-span-splits-surrogate");
  }
  return request as WritingCoachRequest;
}
