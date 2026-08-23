import { describe, expect, it } from "vitest";
import { analyzeWriting } from "./rules.ts";
import type { ProtectedSpan } from "./types.ts";

const analyze = (
  text: string,
  documentLanguage: "en" | "es" = "en",
  protectedSpans: ProtectedSpan[] = [],
  documentStart = 0,
) => analyzeWriting({ text, documentLanguage, documentStart, protectedSpans });

describe("specificity rules", () => {
  it.each(
    [
      [
        "en",
        "The policy changed in many ways during the review.",
        "in many ways",
      ],
      [
        "en",
        "Various aspects shaped the final decision during review.",
        "Various aspects",
      ],
      [
        "es",
        "La propuesta cambió de alguna manera durante la revisión.",
        "de alguna manera",
      ],
      [
        "es",
        "En diversos sentidos, el acuerdo modificó la práctica cotidiana.",
        "En diversos sentidos",
      ],
    ] as const,
  )(
    "finds a reviewed %s phrase with an exact slice",
    (language, text, observedText) => {
      expect(analyze(text, language)).toEqual([
        expect.objectContaining({
          category: "specificity",
          observedText,
          from: text.indexOf(observedText),
          to: text.indexOf(observedText) + observedText.length,
          source: "deterministic",
          explanation: {
            id: "coach.specificity.explanation",
            params: { observedText },
          },
          learningQuestion: {
            id: "coach.specificity.question",
            params: { observedText },
          },
        }),
      ]);
    },
  );

  it("preserves absolute UTF-16 offsets after non-BMP text", () => {
    const text = "😀 The finding changed in many ways.";
    const [issue] = analyze(text, "en", [], 40);
    expect(issue).toMatchObject({
      from: 63,
      to: 75,
      observedText: "in many ways",
    });
    expect(text.slice(issue!.from - 40, issue!.to - 40)).toBe(
      issue!.observedText,
    );
  });

  it.each(
    [
      ["The method changed in a documented way.", "en"],
      ["El método cambió de una manera documentada.", "es"],
      ["La expresión 'diversos' no basta para activar una regla.", "es"],
    ] as const,
  )("does not flag a competent near-miss", (text, language) => {
    expect(analyze(text, language)).toEqual([]);
  });

  it("protects matching source text and proper names", () => {
    const text = "The title In Many Ways appears in the source catalog.";
    expect(analyze(text, "en", [{ from: 10, to: 22, kind: "source-title" }]))
      .toEqual([]);
    expect(analyze("Various Aspects Research Group met today.", "en", [{
      from: 0,
      to: 31,
      kind: "proper-name",
    }])).toEqual([]);
  });
});

describe("evidence rules", () => {
  it.each(
    [
      [
        "en",
        "The report clearly proves that daily practice improves every measured outcome.",
        "clearly proves that",
      ],
      [
        "es",
        "El informe demuestra claramente que la práctica diaria mejora cada resultado medido.",
        "demuestra claramente que",
      ],
    ] as const,
  )(
    "asks a non-accusatory question for a narrow %s assertion cue",
    (language, text, observedText) => {
      expect(analyze(text, language)).toContainEqual(expect.objectContaining({
        category: "evidence",
        observedText,
        explanation: {
          id: "coach.evidence.explanation",
          params: { observedText },
        },
        learningQuestion: {
          id: "coach.evidence.question",
          params: { observedText },
        },
      }));
    },
  );

  it("does not analyze an assertion fragment below eight lexical tokens", () => {
    expect(analyze("This clearly proves that practice works.", "en")).toEqual(
      [],
    );
  });

  it.each([
    "The report clearly proves that daily practice improves every measured outcome (Rivera, 2024).",
    "The report clearly proves that daily practice improves every measured outcome. (Rivera, 2024).",
  ])(
    "stays silent when citation protection is in the same or next sentence",
    (text) => {
      expect(
        analyze(text, "en").filter((issue) => issue.category === "evidence"),
      ).toEqual([]);
    },
  );

  it("does not treat support elsewhere beyond the next sentence as local support", () => {
    const text =
      "The report clearly proves that daily practice improves every measured outcome. Another point follows without a source. (Rivera, 2024).";
    expect(analyze(text, "en").some((issue) => issue.category === "evidence"))
      .toBe(true);
  });
});

describe("clarity rules", () => {
  const fill = (count: number) =>
    Array.from({ length: count }, (_, index) => `term${index}`).join(" ");

  it("requires more than 45 English tokens and three reviewed clause cues", () => {
    const exactBoundary = `${fill(42)} because although while.`;
    expect(exactBoundary.match(/[\p{L}\p{N}]+/gu)).toHaveLength(45);
    expect(
      analyze(exactBoundary, "en").filter((issue) =>
        issue.category === "clarity"
      ),
    ).toEqual([]);
    const longComplex = `${fill(43)} because although while.`;
    const [issue] = analyze(longComplex, "en").filter((item) =>
      item.category === "clarity"
    );
    expect(issue).toMatchObject({
      from: 0,
      to: longComplex.length,
      observedText: longComplex,
    });
  });

  it("requires more than 50 Spanish tokens and native clause cues", () => {
    const longComplex = `${fill(48)} porque aunque mientras.`;
    const [issue] = analyze(longComplex, "es").filter((item) =>
      item.category === "clarity"
    );
    expect(issue).toMatchObject({
      category: "clarity",
      observedText: longComplex,
    });
  });

  it("does not flag a long simple sentence or a short complex fragment", () => {
    expect(
      analyze(`${fill(55)}.`, "en").filter((issue) =>
        issue.category === "clarity"
      ),
    ).toEqual([]);
    expect(
      analyze(
        "Because this changed, although it mattered, while people waited.",
        "en",
      ).filter((issue) => issue.category === "clarity"),
    ).toEqual([]);
  });

  it("excludes protected quotation tokens and keeps absolute non-BMP offsets", () => {
    const prefix = "😀 ";
    const quote = `“${fill(20)}”`;
    const text = `${prefix}${fill(28)} because although while ${quote}.`;
    const start = text.indexOf(quote);
    expect(
      analyze(text, "en", [{
        from: 70 + start,
        to: 70 + start + quote.length,
        kind: "quotation",
      }], 70)
        .filter((issue) => issue.category === "clarity"),
    ).toEqual([]);
  });
});

describe("economy rules", () => {
  it.each(
    [
      [
        "en",
        "The meeting was delayed due to the fact that the room was unavailable.",
        "due to the fact that",
      ],
      [
        "en",
        "The team met in order to compare the two documented methods.",
        "in order to",
      ],
      [
        "es",
        "El equipo se reunió con el fin de comparar los métodos documentados.",
        "con el fin de",
      ],
      [
        "es",
        "La sesión cambió debido al hecho de que faltaban los datos finales.",
        "debido al hecho de que",
      ],
    ] as const,
  )(
    "finds an exact reviewed %s construction",
    (language, text, observedText) => {
      expect(analyze(text, language)).toContainEqual(expect.objectContaining({
        category: "economy",
        from: text.indexOf(observedText),
        to: text.indexOf(observedText) + observedText.length,
        observedText,
      }));
    },
  );

  it.each(
    [
      ["The team met to compare methods.", "en"],
      ["The result was very different in the final sample.", "en"],
      ["Por lo tanto, el equipo comparó los métodos.", "es"],
    ] as const,
  )("does not ban isolated common words", (text, language) => {
    expect(
      analyze(text, language).filter((issue) => issue.category === "economy"),
    ).toEqual([]);
  });

  it("protects quotations, source titles, and proper names", () => {
    const text = "The source title In Order to Learn appears in the list.";
    expect(
      analyze(text, "en", [{ from: 17, to: 34, kind: "source-title" }])
        .filter((issue) => issue.category === "economy"),
    ).toEqual([]);
    expect(
      analyze("The author wrote “due to the fact that” in the excerpt.", "en")
        .filter((issue) => issue.category === "economy"),
    ).toEqual([]);
  });
});

describe("repetition rules", () => {
  it("finds the later four-content-token sequence within one paragraph", () => {
    const text =
      "Careful local evidence supports revision today; careful local evidence supports revision tomorrow.";
    const issues = analyze(text, "en").filter((issue) =>
      issue.category === "repetition"
    );
    const later = text.lastIndexOf("careful local evidence supports");
    expect(issues).toContainEqual(expect.objectContaining({
      from: later,
      to: later + "careful local evidence supports".length,
      observedText: "careful local evidence supports",
    }));
  });

  it("does not join a repeated sequence across paragraphs", () => {
    const text =
      "Careful local evidence supports revision today.\n\nCareful local evidence supports revision tomorrow.";
    expect(
      analyze(text, "en").filter((issue) => issue.category === "repetition"),
    ).toEqual([]);
  });

  it("finds a three-content-token opening in exactly three consecutive sentences", () => {
    const text =
      "This careful analysis compares every result in the sample. This careful analysis explains every change in the sample. This careful analysis documents every limit in the sample.";
    expect(
      analyze(text, "en").filter((issue) => issue.category === "repetition"),
    ).toHaveLength(1);
    expect(
      analyze(
        text.replace(
          /\. This careful analysis documents.*$/u,
          ". A different opening documents every limit in the sample.",
        ),
        "en",
      )
        .filter((issue) => issue.category === "repetition"),
    ).toEqual([]);
  });

  it("normalizes case but preserves Spanish diacritics", () => {
    const repeated =
      "Método crítico reúne información nueva; método crítico reúne información válida.";
    expect(
      analyze(repeated, "es").some((issue) => issue.category === "repetition"),
    ).toBe(true);
    const nearMiss =
      "Método crítico reúne información nueva; metodo critico reune informacion válida.";
    expect(
      analyze(nearMiss, "es").filter((issue) =>
        issue.category === "repetition"
      ),
    ).toEqual([]);
  });

  it("does not count protected tokens in a repetition match", () => {
    const text =
      "Careful local evidence supports today; careful local evidence supports tomorrow.";
    const second = text.lastIndexOf("careful");
    expect(
      analyze(text, "en", [{
        from: second,
        to: second + 5,
        kind: "proper-name",
      }])
        .filter((issue) => issue.category === "repetition"),
    ).toEqual([]);
  });
});

describe("voice rules", () => {
  it.each(
    [
      [
        "en",
        "It is important to note that the sample changed across every measured period.",
        "It is important to note that",
      ],
      [
        "en",
        "Needless to say, the sample changed across every measured period in the study.",
        "Needless to say",
      ],
      [
        "es",
        "Cabe señalar que la muestra cambió durante cada periodo medido del estudio.",
        "Cabe señalar que",
      ],
      [
        "es",
        "Huelga decir que la muestra cambió durante cada periodo medido del estudio.",
        "Huelga decir que",
      ],
    ] as const,
  )(
    "finds a reviewed %s formulaic construction",
    (language, text, observedText) => {
      expect(analyze(text, language)).toContainEqual(expect.objectContaining({
        category: "voice",
        observedText,
      }));
    },
  );

  it.each(
    [
      ["I compare the two samples in the following section.", "en"],
      [
        "The samples were compared after collection by the research team.",
        "en",
      ],
      ["However, the second sample produced a different estimate.", "en"],
      ["Yo comparo las dos muestras en la sección siguiente.", "es"],
    ] as const,
  )("does not infer voice from ordinary academic grammar", (text, language) => {
    expect(
      analyze(text, language).filter((issue) => issue.category === "voice"),
    ).toEqual([]);
  });

  it("suppresses fragments and protected quotations", () => {
    expect(
      analyze("Needless to say, results changed.", "en").filter((issue) =>
        issue.category === "voice"
      ),
    ).toEqual([]);
    expect(
      analyze(
        "The article says “it is important to note that” before presenting evidence.",
        "en",
      )
        .filter((issue) => issue.category === "voice"),
    ).toEqual([]);
  });

  it("allows observable cross-category overlap", () => {
    const text =
      "It is important to note that in many ways the measured sample changed over time.";
    expect(analyze(text, "en").map((issue) => issue.category)).toEqual([
      "voice",
      "specificity",
    ]);
  });
});
