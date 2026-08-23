import {
  type Candidate,
  filterProtectedCandidates,
  hasNearbySupport,
  maskedTokens,
  normalizeCandidates,
  normalizeProtection,
} from "./normalization.ts";
import {
  type CoachCategory,
  type CoachMessageDescriptor,
  validateWritingCoachRequest,
  type WritingCoachIssue,
  type WritingCoachRequest,
} from "./types.ts";
import { type CoachToken, paragraphs, sentences } from "./segmentation.ts";

interface RuleCandidate extends Candidate {
  observedText: string;
  explanation: CoachMessageDescriptor;
  learningQuestion: CoachMessageDescriptor;
  source: "deterministic";
}

const SPECIFICITY = {
  en: ["in many ways", "various aspects"],
  es: ["de alguna manera", "en diversos sentidos"],
} as const;
const EVIDENCE = {
  en: ["clearly proves that", "research clearly shows"],
  es: ["demuestra claramente que", "los datos confirman que"],
} as const;
const ECONOMY = {
  en: ["due to the fact that", "in order to"],
  es: ["con el fin de", "debido al hecho de que"],
} as const;
const VOICE = {
  en: ["it is important to note that", "needless to say"],
  es: ["cabe señalar que", "huelga decir que"],
} as const;
const CLAUSE_CUES = {
  en: new Set(["because", "although", "while", "whereas", "which", "but"]),
  es: new Set(["porque", "aunque", "mientras", "si", "pero", "cuando"]),
} as const;
const STOP_TOKENS: Record<"en" | "es", ReadonlySet<string>> = {
  en: new Set(["a", "an", "and", "in", "of", "or", "the", "to"]),
  es: new Set([
    "a",
    "al",
    "de",
    "del",
    "el",
    "en",
    "la",
    "las",
    "los",
    "o",
    "y",
  ]),
};

function makeCandidate(
  request: WritingCoachRequest,
  category: CoachCategory,
  from: number,
  to: number,
  ruleId: string,
  priority = 0,
): RuleCandidate {
  const observedText = request.text.slice(
    from - request.documentStart,
    to - request.documentStart,
  );
  return {
    from,
    to,
    category,
    ruleId,
    priority,
    observedText,
    explanation: {
      id: `coach.${category}.explanation`,
      params: { observedText },
    } as CoachMessageDescriptor,
    learningQuestion: {
      id: `coach.${category}.question`,
      params: { observedText },
    } as CoachMessageDescriptor,
    source: "deterministic",
  };
}

function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
}

function phraseCandidates(
  request: WritingCoachRequest,
  category: CoachCategory,
  phrases: readonly string[],
): RuleCandidate[] {
  const candidates: RuleCandidate[] = [];
  phrases.forEach((phrase, index) => {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])${
        escapePattern(phrase)
      }(?![\\p{L}\\p{M}\\p{N}])`,
      "giu",
    );
    for (const match of request.text.matchAll(pattern)) {
      candidates.push(makeCandidate(
        request,
        category,
        request.documentStart + match.index,
        request.documentStart + match.index + match[0].length,
        `${request.documentLanguage}.${category}.${index}`,
        index,
      ));
    }
  });
  return candidates;
}

function repetitionCandidates(
  request: WritingCoachRequest,
  availableTokens: readonly CoachToken[],
): RuleCandidate[] {
  const output: RuleCandidate[] = [];
  const absolute = (token: CoachToken) => ({
    ...token,
    from: token.from + request.documentStart,
    to: token.to + request.documentStart,
  });
  for (
    const [paragraphIndex, paragraph] of paragraphs(request.text).entries()
  ) {
    const paragraphTokens = availableTokens.filter((token) =>
      token.from >= paragraph.from && token.to <= paragraph.to
    );
    if (paragraphTokens.length < 8) continue;
    const content = paragraphTokens.filter((token) =>
      !STOP_TOKENS[request.documentLanguage].has(token.normalized)
    );
    const seen = new Set<string>();
    for (let index = 0; index <= content.length - 4; index += 1) {
      const sequence = content.slice(index, index + 4);
      const key = sequence.map((token) => token.normalized).join("\0");
      if (seen.has(key)) {
        const first = absolute(sequence[0]!);
        const last = absolute(sequence.at(-1)!);
        output.push(
          makeCandidate(
            request,
            "repetition",
            first.from,
            last.to,
            `shared.repetition.phrase.${paragraphIndex}`,
          ),
        );
        index += 3;
      } else seen.add(key);
    }
  }
  const sentenceRanges = sentences(request.text);
  const openings = sentenceRanges.map((sentence) => {
    const sentenceTokens = availableTokens.filter((token) =>
      token.from >= sentence.from && token.to <= sentence.to
    );
    if (sentenceTokens.length < 8) return null;
    const content = sentenceTokens.filter((token) =>
      !STOP_TOKENS[request.documentLanguage].has(token.normalized)
    );
    return content.length >= 3 ? content.slice(0, 3) : null;
  });
  for (let index = 2; index < openings.length; index += 1) {
    const group = openings.slice(index - 2, index + 1);
    if (group.some((opening) => !opening)) continue;
    const keys = group.map((opening) =>
      opening!.map((token) => token.normalized).join("\0")
    );
    if (keys[0] !== keys[1] || keys[1] !== keys[2]) continue;
    const opening = group[2]!;
    const first = absolute(opening[0]!);
    const last = absolute(opening[2]!);
    output.push(
      makeCandidate(
        request,
        "repetition",
        first.from,
        last.to,
        `shared.repetition.opening.${index}`,
      ),
    );
  }
  return output;
}

export function analyzeWriting(
  input: WritingCoachRequest,
): WritingCoachIssue[] {
  const request = validateWritingCoachRequest(input);
  const protection = normalizeProtection(request);
  const candidates = phraseCandidates(
    request,
    "specificity",
    SPECIFICITY[request.documentLanguage],
  );
  const availableTokens = maskedTokens(request, protection);
  const sentenceRanges = sentences(request.text).map((sentence) => ({
    from: sentence.from + request.documentStart,
    to: sentence.to + request.documentStart,
  }));
  const evidence = phraseCandidates(
    request,
    "evidence",
    EVIDENCE[request.documentLanguage],
  ).filter((candidate) => {
    const sentence = sentenceRanges.find((range) =>
      candidate.from >= range.from && candidate.to <= range.to
    );
    if (!sentence) return false;
    const tokenCount = availableTokens.filter((token) => {
      const from = token.from + request.documentStart;
      const to = token.to + request.documentStart;
      return from >= sentence.from && to <= sentence.to;
    }).length;
    return tokenCount >= 8 && !hasNearbySupport(
      request.text,
      sentence,
      protection,
      request.documentStart,
    );
  });
  candidates.push(...evidence);
  candidates.push(
    ...phraseCandidates(request, "economy", ECONOMY[request.documentLanguage]),
  );
  candidates.push(...repetitionCandidates(request, availableTokens));
  const voice = phraseCandidates(
    request,
    "voice",
    VOICE[request.documentLanguage],
  ).filter((candidate) => {
    const sentence = sentenceRanges.find((range) =>
      candidate.from >= range.from && candidate.to <= range.to
    );
    if (!sentence) return false;
    return availableTokens.filter((token) => {
      const from = token.from + request.documentStart;
      const to = token.to + request.documentStart;
      return from >= sentence.from && to <= sentence.to;
    }).length >= 8;
  });
  candidates.push(...voice);
  const clarityThreshold = request.documentLanguage === "en" ? 45 : 50;
  sentenceRanges.forEach((sentence, index) => {
    const sentenceTokens = availableTokens.filter((token) => {
      const from = token.from + request.documentStart;
      const to = token.to + request.documentStart;
      return from >= sentence.from && to <= sentence.to;
    });
    const cueCount = sentenceTokens.filter((token) =>
      CLAUSE_CUES[request.documentLanguage].has(token.normalized)
    ).length;
    if (sentenceTokens.length > clarityThreshold && cueCount >= 3) {
      candidates.push(
        makeCandidate(
          request,
          "clarity",
          sentence.from,
          sentence.to,
          `shared.clarity.${index}`,
        ),
      );
    }
  });
  return normalizeCandidates(filterProtectedCandidates(candidates, protection))
    .map((candidate) => ({
      from: candidate.from,
      to: candidate.to,
      observedText: candidate.observedText,
      category: candidate.category,
      explanation: candidate.explanation,
      learningQuestion: candidate.learningQuestion,
      source: candidate.source,
    }));
}
