import {
  AlignmentType,
  Document,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from "docx";

/**
 * De-risk spike (plan M0): a minimal document exercising every DOCX feature
 * the real APA exporter depends on — named paragraph styles, double spacing,
 * first-line and hanging indents in twips, a page-number header, and a native
 * footnote. Open the output in Word/LibreOffice to verify by hand; the test
 * suite asserts the same facts against the raw XML.
 */

const TWIPS_PER_HALF_INCH = 720;
const DOUBLE_SPACING = 480; // 240 twips = single line; 480 = double
const FONT = "Times New Roman";
const FONT_SIZE_HALF_POINTS = 24; // 12 pt

export function buildSpikeDocument(): Document {
  return new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: FONT_SIZE_HALF_POINTS } },
      },
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          quickFormat: true,
          run: { font: FONT, size: FONT_SIZE_HALF_POINTS },
          paragraph: {
            spacing: {
              line: DOUBLE_SPACING,
              lineRule: LineRuleType.AUTO,
              before: 0,
              after: 0,
            },
          },
        },
        {
          id: "BodyText",
          name: "Body Text",
          basedOn: "Normal",
          quickFormat: true,
          paragraph: { indent: { firstLine: TWIPS_PER_HALF_INCH } },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "BodyText",
          quickFormat: true,
          run: { bold: true },
          paragraph: { alignment: AlignmentType.CENTER },
        },
        {
          id: "ReferenceEntry",
          name: "Reference Entry",
          basedOn: "Normal",
          quickFormat: true,
          paragraph: {
            indent: {
              left: TWIPS_PER_HALF_INCH,
              hanging: TWIPS_PER_HALF_INCH,
            },
          },
        },
      ],
    },
    footnotes: {
      1: {
        children: [
          new Paragraph({
            children: [
              new TextRun(
                " Esta es una nota al pie de prueba con formato correcto.",
              ),
            ],
          }),
        ],
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // US Letter in twips
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                tabStops: [
                  { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
                ],
                children: [
                  new TextRun("TITULILLO EN MAYÚSCULAS"),
                  new TextRun({ children: ["\t", PageNumber.CURRENT] }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("El Título del Ensayo de Prueba")],
          }),
          new Paragraph({
            style: "BodyText",
            children: [
              new TextRun(
                "Este párrafo verifica la sangría de primera línea de media " +
                  "pulgada y el interlineado doble sin espacio adicional " +
                  "entre párrafos, tal como exige el estilo APA.",
              ),
              new FootnoteReferenceRun(1),
            ],
          }),
          new Paragraph({
            style: "BodyText",
            children: [
              new TextRun(
                "Un segundo párrafo confirma que el estilo se hereda y que " +
                  "las sangrías refluyen al editar el texto en Word.",
              ),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            pageBreakBefore: true,
            children: [new TextRun("Referencias")],
          }),
          new Paragraph({
            style: "ReferenceEntry",
            children: [
              new TextRun("García, J. M. (2020). "),
              new TextRun({
                text: "El gran libro de las pruebas",
                italics: true,
              }),
              new TextRun(" (2.ª ed.). Editorial Ficticia."),
            ],
          }),
          new Paragraph({
            style: "ReferenceEntry",
            children: [
              new TextRun(
                "Pérez Rodríguez, A., y López, M. (2021). Un artículo con " +
                  "una entrada lo bastante larga para comprobar que la " +
                  "sangría francesa aplica desde la segunda línea. ",
              ),
              new TextRun({ text: "Revista de Ejemplos", italics: true }),
              new TextRun({ text: ", 12", italics: true }),
              new TextRun("(3), 45–67. https://doi.org/10.0000/ejemplo"),
            ],
          }),
        ],
      },
    ],
  });
}

export async function exportSpikeDocx(): Promise<Uint8Array> {
  const doc = buildSpikeDocument();
  const arrayBuffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(arrayBuffer);
}
