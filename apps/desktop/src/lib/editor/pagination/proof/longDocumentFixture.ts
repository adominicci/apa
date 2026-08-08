import type { DocLocale, Reference } from "@tesina/engine";

type GeneratedLabels = {
  abstract: string;
  references: string;
  table: string;
  figure: string;
  appendix: string;
};

export interface LongDocumentFixture {
  locale: DocLocale;
  content: Record<string, unknown>;
  references: Reference[];
  expectedGeneratedLabels: GeneratedLabels;
  printableHeight: number;
  atomicHeights: Readonly<Record<string, number>>;
}

const PRINTABLE_HEIGHT = 864;

const COPY = {
  en: {
    abstract:
      "This invented study observes how volunteers organize a community seed archive during a simulated rainy season.",
    keywords: "seed archive, rainfall, community planning",
    opening:
      "The workshop began with paper cards, colored clips, and a shared calendar. Participants compared the cards before choosing a storage sequence",
    afterBreak:
      "A hard line break keeps this second line inside the same authored paragraph.",
    citationLead: "The recorded pattern remained consistent ",
    citationTail:
      " while each team adjusted its labels to match the invented catalog.",
    quote:
      "A useful archive makes the next action obvious even when the room is busy and the weather changes.",
    runIn: "Decision rule",
    runInBody:
      "Each volunteer checked the oldest packet first, then recorded moisture and location before moving anything.",
    listOne: "Inspect the shelf and record its current condition.",
    listTwo: "Compare the paper log with the color marker.",
    nested: "Flag a mismatch for a second independent reading.",
    tableTitle: "Simulated archive checks by round",
    tableNote:
      "Values are invented counts used only to exercise page-boundary behavior.",
    figureTitle: "Invented route through the archive room",
    figureNote:
      "The image placeholder is generated for this clean-room proof and contains no external artwork.",
    oversizeTitle: "Deliberately oversize proof block",
    oversizeNote:
      "This synthetic atomic block is taller than the printable area so bounded overflow can be tested.",
    appendix:
      "The appendix contains an invented checklist with enough detail to begin on a separate page and continue without stored page markers.",
    equationLead:
      "The synthetic balance score below is included only to exercise an atomic block equation.",
    labels: {
      abstract: "Abstract",
      references: "References",
      table: "Table 1",
      figure: "Figure 1",
      appendix: "Appendix",
    },
  },
  es: {
    abstract:
      "Este estudio inventado observa cómo un grupo organiza un archivo comunitario de semillas durante una temporada lluviosa simulada.",
    keywords: "archivo de semillas, lluvia, planificación comunitaria",
    opening:
      "El taller comenzó con tarjetas de papel, pinzas de colores y un calendario compartido. El grupo comparó las tarjetas antes de escoger una secuencia de almacenamiento",
    afterBreak:
      "Un salto de línea manual mantiene esta segunda línea dentro del mismo párrafo redactado.",
    citationLead: "El patrón registrado se mantuvo constante ",
    citationTail:
      " mientras cada equipo ajustaba sus rótulos al catálogo inventado.",
    quote:
      "Un archivo útil deja clara la próxima acción aun cuando el salón está ocupado y cambia el clima.",
    runIn: "Regla de decisión",
    runInBody:
      "Cada participante revisó primero el paquete más antiguo y luego anotó la humedad y la ubicación antes de moverlo.",
    listOne: "Inspeccionar el estante y registrar su condición actual.",
    listTwo: "Comparar la bitácora de papel con el marcador de color.",
    nested: "Marcar una diferencia para una segunda lectura independiente.",
    tableTitle: "Revisiones simuladas del archivo por ronda",
    tableNote:
      "Los valores son conteos inventados usados solamente para probar límites de página.",
    figureTitle: "Ruta inventada por el salón del archivo",
    figureNote:
      "La imagen de prueba se genera para esta prueba de diseño limpio y no contiene arte externo.",
    oversizeTitle: "Bloque de prueba deliberadamente sobredimensionado",
    oversizeNote:
      "Este bloque atómico sintético supera el área imprimible para probar un desborde limitado.",
    appendix:
      "El apéndice contiene una lista de cotejo inventada con suficiente detalle para comenzar en otra página y continuar sin marcadores de página almacenados.",
    equationLead:
      "El balance sintético siguiente se incluye únicamente para probar una ecuación atómica en bloque.",
    labels: {
      abstract: "Resumen",
      references: "Referencias",
      table: "Tabla 1",
      figure: "Figura 1",
      appendix: "Apéndice",
    },
  },
} as const;

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function tableCell(type: "tableHeader" | "tableCell", text: string) {
  return {
    type,
    attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
    content: [paragraph(text)],
  };
}

function longReferences(locale: DocLocale): Reference[] {
  const subjects = locale === "es"
    ? [
      "clasificación de sobres bajo lluvia simulada",
      "rotación de turnos en un archivo vecinal",
      "lectura de rótulos con iluminación variable",
      "registro de humedad mediante tarjetas de colores",
      "acuerdos para revisar paquetes sin duplicar conteos",
      "planificación de rutas cortas entre estantes móviles",
    ]
    : [
      "sorting envelopes during simulated rainfall",
      "rotating shifts in a neighborhood archive",
      "reading labels under changing light",
      "recording moisture with colored cards",
      "reviewing packets without duplicate counts",
      "planning short routes between movable shelves",
    ];

  return subjects.map((subject, index): Reference => ({
    id: `proof-ref-${index + 1}`,
    type: "website",
    authors: [{
      kind: "group",
      name: locale === "es"
        ? `Colectivo de Prueba ${index + 1}`
        : `Proof Collective ${index + 1}`,
    }],
    date: { year: 2020 + index, month: index + 1, day: index + 2 },
    title: locale === "es"
      ? `Informe completamente inventado sobre ${subject}, con observaciones repetibles para una prueba extensa de paginación y sin contenido tomado de manuales externos`
      : `A wholly invented report about ${subject}, with repeatable observations for an extended pagination fixture and no text taken from external manuals`,
    siteName: locale === "es"
      ? "Archivo Sintético Comunitario"
      : "Synthetic Community Archive",
    url: `https://example.invalid/tesina-pagination-proof/reference-${
      index + 1
    }`,
  }));
}

function longBodyParagraph(locale: DocLocale, index: number): string {
  return locale === "es"
    ? `Párrafo inventado ${index}. Durante la ronda simulada, dos personas compararon tarjetas, revisaron el orden de los sobres y anotaron una diferencia pequeña antes de continuar. La secuencia se repite con palabras controladas para producir un documento largo y determinista sin reutilizar texto de guías, manuales o productos ajenos.`
    : `Invented paragraph ${index}. During the simulated round, two people compared cards, checked the envelope order, and recorded one small difference before continuing. The sequence repeats with controlled wording to produce a long deterministic document without reusing text from guides, manuals, or other products.`;
}

function buildContent(locale: DocLocale): Record<string, unknown> {
  const copy = COPY[locale];
  const tableRows = Array.from({ length: 7 }, (_, index) => ({
    type: "tableRow",
    content: [
      tableCell("tableCell", `${index + 1}`),
      tableCell("tableCell", `${(index + 1) * 3}`),
      tableCell("tableCell", `${(index + 1) * 5}`),
    ],
  }));

  return {
    type: "doc",
    content: [
      {
        type: "sectionAbstract",
        content: [
          paragraph(copy.abstract),
          {
            type: "keywordsLine",
            content: [{
              type: "text",
              marks: [{ type: "italic" }],
              text: copy.keywords,
            }],
          },
        ],
      },
      {
        type: "sectionBody",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: copy.opening },
              { type: "hardBreak" },
              { type: "text", text: copy.afterBreak },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: copy.citationLead },
              {
                type: "citation",
                attrs: {
                  items: [{ refId: "proof-ref-1" }],
                  mode: "parenthetical",
                },
              },
              { type: "text", text: copy.citationTail },
            ],
          },
          {
            type: "blockquote",
            content: [paragraph(copy.quote)],
          },
          {
            type: "heading",
            attrs: { level: 4 },
            content: [{ type: "text", text: copy.runIn }],
          },
          paragraph(copy.runInBody),
          ...Array.from(
            { length: 6 },
            (_, index) => paragraph(longBodyParagraph(locale, index + 1)),
          ),
          {
            type: "orderedList",
            attrs: { start: 1, type: null, listStyle: "decimal" },
            content: [
              {
                type: "listItem",
                content: [
                  paragraph(copy.listOne),
                  {
                    type: "bulletList",
                    content: [{
                      type: "listItem",
                      content: [paragraph(copy.nested)],
                    }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [paragraph(copy.listTwo)],
              },
            ],
          },
          {
            type: "apaTable",
            content: [
              {
                type: "tableTitle",
                content: [{ type: "text", text: copy.tableTitle }],
              },
              {
                type: "table",
                content: [
                  {
                    type: "tableRow",
                    content: [
                      tableCell(
                        "tableHeader",
                        locale === "es" ? "Ronda" : "Round",
                      ),
                      tableCell(
                        "tableHeader",
                        locale === "es" ? "Tarjetas" : "Cards",
                      ),
                      tableCell(
                        "tableHeader",
                        locale === "es" ? "Sobres" : "Envelopes",
                      ),
                    ],
                  },
                  ...tableRows,
                ],
              },
              {
                type: "tableNote",
                content: [{ type: "text", text: copy.tableNote }],
              },
            ],
          },
          {
            type: "figure",
            content: [
              {
                type: "figureTitle",
                content: [{ type: "text", text: copy.figureTitle }],
              },
              {
                type: "figureImage",
                attrs: { src: "", alt: "proof-standard-figure" },
              },
              {
                type: "figureNote",
                content: [{ type: "text", text: copy.figureNote }],
              },
            ],
          },
          paragraph(copy.equationLead),
          {
            type: "apaEquation",
            attrs: { latex: "B = \\frac{r + c}{2}" },
          },
          {
            type: "figure",
            content: [
              {
                type: "figureTitle",
                content: [{ type: "text", text: copy.oversizeTitle }],
              },
              {
                type: "figureImage",
                attrs: { src: "", alt: "proof-oversize-figure" },
              },
              {
                type: "figureNote",
                content: [{ type: "text", text: copy.oversizeNote }],
              },
            ],
          },
        ],
      },
      {
        type: "sectionAppendix",
        content: [
          paragraph(copy.appendix),
          paragraph(longBodyParagraph(locale, 7)),
          paragraph(longBodyParagraph(locale, 8)),
        ],
      },
    ],
  };
}

function fixture(locale: DocLocale): LongDocumentFixture {
  return {
    locale,
    content: buildContent(locale),
    references: longReferences(locale),
    expectedGeneratedLabels: { ...COPY[locale].labels },
    printableHeight: PRINTABLE_HEIGHT,
    atomicHeights: {
      "proof-standard-figure": 320,
      "proof-oversize-figure": 960,
    },
  };
}

/**
 * Clean-room fixtures for the feasibility proof. Every sentence, source,
 * number, and label expectation in this module was authored for Tesina's
 * pagination tests; it does not reproduce APA-manual or competitor content.
 */
export function createLongDocumentFixtures(): Readonly<
  Record<DocLocale, LongDocumentFixture>
> {
  return { en: fixture("en"), es: fixture("es") };
}
