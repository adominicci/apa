import type { DocLocale } from "@tesina/engine";
import type { CoachCategory, CoachMessageDescriptor } from "./types.ts";

export const COACH_CORPUS_VERSION = "coach-corpus-v1" as const;
export const COACH_RENDER_CATALOG_VERSION = "coach-render-catalog-v1" as const;
export type CorpusCohort =
  | "weak"
  | "competent"
  | "ai-assisted"
  | "second-language";

export interface ProposedObservation {
  id: string;
  category: CoachCategory;
  from: number;
  to: number;
}

export interface CoachCorpusFixture {
  id: string;
  documentLanguage: DocLocale;
  cohort: CorpusCohort;
  text: string;
  origin: "tesina-lt03-synthetic-v1";
  license: "MIT";
  sourceUrl: null;
  attribution: "Tesina contributors";
  deIdentified: true;
  expectedClean: boolean;
  proposedObservations: ProposedObservation[];
}

export const REVIEWER_SLOTS = Object.freeze(
  [
    {
      slot: 1,
      role: "independent-bilingual-reviewer",
      reviewerId: null,
      bilingualAttestation: null,
      independenceAttestation: null,
    },
    {
      slot: 2,
      role: "independent-bilingual-reviewer",
      reviewerId: null,
      bilingualAttestation: null,
      independenceAttestation: null,
    },
  ] as const,
);

const REPETITION_STEMS: Record<DocLocale, readonly string[]> = {
  en: [
    "Careful local evidence supports",
    "Measured field results guide",
    "Focused source comparisons inform",
    "Documented sample patterns shape",
    "Clear method records support",
    "Specific study findings guide",
    "Local source details strengthen",
    "Measured outcome records inform",
  ],
  es: [
    "Método crítico reúne información",
    "Evidencia local orienta revisiones",
    "Resultados medidos apoyan decisiones",
    "Comparaciones claras guían cambios",
    "Registros precisos sostienen conclusiones",
    "Detalles concretos mejoran argumentos",
    "Fuentes locales respaldan análisis",
    "Hallazgos medidos orientan preguntas",
  ],
};

const longSentence = (language: DocLocale, fixtureIndex: number): string => {
  const words = Array.from(
    { length: language === "en" ? 43 : 48 },
    (_, index) => `${language}${fixtureIndex}term${index}`,
  );
  return `${words.join(" ")} ${
    language === "en" ? "because although while" : "porque aunque mientras"
  }.`;
};

function weakFixture(language: DocLocale, index: number): CoachCorpusFixture {
  const repetitionStem = REPETITION_STEMS[language][index]!;
  const repetitionMatch = repetitionStem.toLocaleLowerCase(language);
  const repetition = `${repetitionStem} revision ${
    index + 1
  }; ${repetitionMatch} revision ${index + 9}.`;
  const phrases = language === "en"
    ? {
      specificity:
        "The policy changed in many ways during the documented local review.",
      evidence:
        "The report clearly proves that daily practice improves every measured outcome.",
      economy: "The team met in order to compare the two documented methods.",
      repetition,
      voice:
        "It is important to note that the sample changed across every measured period.",
      specificityMatch: "in many ways",
      evidenceMatch: "clearly proves that",
      economyMatch: "in order to",
      repetitionMatch,
      voiceMatch: "It is important to note that",
    }
    : {
      specificity:
        "La propuesta cambió de alguna manera durante la revisión documentada.",
      evidence:
        "El informe demuestra claramente que la práctica diaria mejora cada resultado medido.",
      economy:
        "El equipo se reunió con el fin de comparar los métodos documentados.",
      repetition,
      voice:
        "Cabe señalar que la muestra cambió durante cada periodo medido del estudio.",
      specificityMatch: "de alguna manera",
      evidenceMatch: "demuestra claramente que",
      economyMatch: "con el fin de",
      repetitionMatch,
      voiceMatch: "Cabe señalar que",
    };
  const parts = [
    phrases.specificity,
    phrases.evidence,
    longSentence(language, index),
    phrases.economy,
    phrases.repetition,
    phrases.voice,
  ];
  const text = parts.join("\n\n");
  const observations: Array<[CoachCategory, string, boolean?]> = [
    ["specificity", phrases.specificityMatch],
    ["evidence", phrases.evidenceMatch],
    ["clarity", parts[2]!],
    ["economy", phrases.economyMatch],
    ["repetition", phrases.repetitionMatch, true],
    ["voice", phrases.voiceMatch],
  ];
  return {
    id: `${language}-weak-${String(index + 1).padStart(2, "0")}`,
    documentLanguage: language,
    cohort: "weak",
    text,
    origin: "tesina-lt03-synthetic-v1",
    license: "MIT",
    sourceUrl: null,
    attribution: "Tesina contributors",
    deIdentified: true,
    expectedClean: false,
    proposedObservations: observations.map(([category, observed, last]) => {
      const from = last
        ? text.toLocaleLowerCase(language).lastIndexOf(observed)
        : text.indexOf(observed);
      return {
        id: `${language}-${category}-${index + 1}`,
        category,
        from,
        to: from + observed.length,
      };
    }),
  };
}

const CLEAN_TEXT: Record<
  DocLocale,
  Record<Exclude<CorpusCohort, "weak">, string>
> = {
  en: {
    competent:
      "The study compared two samples and reported the measured difference with a cited table.",
    "ai-assisted":
      "This synthetic review stratum describes a measured change without making any claim about authorship.",
    "second-language":
      "The writer compares the local results carefully and explains the method in direct academic prose.",
  },
  es: {
    competent:
      "El estudio comparó dos muestras y presentó la diferencia medida en una tabla citada.",
    "ai-assisted":
      "Este estrato sintético describe un cambio medido sin afirmar nada sobre la autoría.",
    "second-language":
      "La persona compara los resultados locales con cuidado y explica el método en prosa académica directa.",
  },
};

const CLEAN_SUFFIX: Record<DocLocale, readonly string[]> = {
  en: [
    "Rainfall records came from a public measurement station.",
    "Each table reports one predefined measurement from the sample.",
    "Readers can compare the two documented procedures directly.",
    "The paragraph identifies the limits of its selected sample.",
    "All names and examples are synthetic and redistribution safe.",
    "The observation window covers one defined study period.",
    "The conclusion restates the measured comparison in direct terms.",
    "The appendix lists the documented steps in chronological order.",
  ],
  es: [
    "Los registros de lluvia provienen de una estación pública de medición.",
    "Cada tabla presenta una medida predefinida de la muestra.",
    "Las personas lectoras pueden comparar los dos procedimientos documentados.",
    "El párrafo identifica los límites de la muestra seleccionada.",
    "Todos los nombres y ejemplos son sintéticos y redistribuibles.",
    "La ventana de observación cubre un periodo definido del estudio.",
    "La conclusión resume la comparación medida con términos directos.",
    "El apéndice enumera los pasos documentados en orden cronológico.",
  ],
};

function cleanFixture(
  language: DocLocale,
  cohort: Exclude<CorpusCohort, "weak">,
  index: number,
): CoachCorpusFixture {
  return {
    id: `${language}-${cohort}-${String(index + 1).padStart(2, "0")}`,
    documentLanguage: language,
    cohort,
    text: `${CLEAN_TEXT[language][cohort]} ${CLEAN_SUFFIX[language][index]}`,
    origin: "tesina-lt03-synthetic-v1",
    license: "MIT",
    sourceUrl: null,
    attribution: "Tesina contributors",
    deIdentified: true,
    expectedClean: true,
    proposedObservations: [],
  };
}

export const COACH_CORPUS: CoachCorpusFixture[] = (["en", "es"] as const)
  .flatMap((language) => [
    ...Array.from({ length: 8 }, (_, index) => weakFixture(language, index)),
    ...(["competent", "ai-assisted", "second-language"] as const).flatMap((
      cohort,
    ) =>
      Array.from(
        { length: 8 },
        (_, index) => cleanFixture(language, cohort, index),
      )
    ),
  ]);

const EXPLANATIONS: Record<DocLocale, Record<CoachCategory, string>> = {
  en: {
    specificity:
      "This wording is broad and may benefit from a concrete detail.",
    evidence: "This assertion may need nearby support or explanation.",
    clarity: "This sentence combines many words and clause turns.",
    economy: "This phrase uses more words than the idea may require.",
    repetition: "This wording repeats within the same local passage.",
    voice: "This framing delays the passage's concrete point.",
  },
  es: {
    specificity:
      "Esta expresión es amplia y puede beneficiarse de un detalle concreto.",
    evidence: "Esta afirmación puede necesitar apoyo o explicación cercana.",
    clarity: "Esta oración combina muchas palabras y giros de cláusula.",
    economy: "Esta frase usa más palabras de las que puede requerir la idea.",
    repetition: "Esta formulación se repite dentro del mismo pasaje local.",
    voice: "Este marco retrasa el punto concreto del pasaje.",
  },
};
const QUESTIONS: Record<DocLocale, Record<CoachCategory, string>> = {
  en: {
    specificity: "Which concrete detail would make this wording more precise?",
    evidence:
      "What nearby support or explanation would help the reader assess this assertion?",
    clarity:
      "How could you divide or reorder this sentence while preserving its meaning?",
    economy: "Which shorter phrasing would preserve the exact meaning?",
    repetition:
      "Could one occurrence be varied or removed without losing emphasis?",
    voice: "Could the sentence begin with its concrete point?",
  },
  es: {
    specificity: "¿Qué detalle concreto haría más precisa esta expresión?",
    evidence:
      "¿Qué apoyo o explicación cercana ayudaría a evaluar esta afirmación?",
    clarity:
      "¿Cómo podrías dividir u ordenar esta oración sin cambiar su significado?",
    economy: "¿Qué formulación más breve conservaría el significado exacto?",
    repetition:
      "¿Podrías variar o quitar una repetición sin perder el énfasis?",
    voice: "¿Podría la oración comenzar con su punto concreto?",
  },
};

export function renderCoachMessage(
  descriptor: CoachMessageDescriptor,
  uiLocale: DocLocale,
): string {
  const category = descriptor.id.split(".")[1] as CoachCategory;
  return descriptor.id.endsWith(".question")
    ? QUESTIONS[uiLocale][category]
    : EXPLANATIONS[uiLocale][category];
}
