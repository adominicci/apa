import { AlignmentType, Paragraph, TextRun } from "docx";
import { type APADate, buildStudentTitlePage, getTerms } from "@tesina/engine";
import type { ExportInput } from "./input.ts";

function centered(
  text: string,
  opts: { bold?: boolean } = {},
): Paragraph {
  return new Paragraph({
    style: "Normal",
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, ...(opts.bold ? { bold: true } : {}) })],
  });
}

function centeredRuns(children: TextRun[]): Paragraph {
  return new Paragraph({
    style: "Normal",
    alignment: AlignmentType.CENTER,
    children,
  });
}

function blankLine(): Paragraph {
  return new Paragraph({ style: "Normal", children: [] });
}

function isoToApaDate(iso: string): APADate | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number.parseInt(match[1]!, 10),
    month: Number.parseInt(match[2]!, 10),
    day: Number.parseInt(match[3]!, 10),
  };
}

/**
 * APA 7 title page (2.3): title bold in the upper third, one blank line,
 * then author, affiliation, course, instructor, and localized due date, all
 * centered and double-spaced. The professional variant appends the author
 * note toward the bottom of the page.
 */
export function titlePageParagraphs(input: ExportInput): Paragraph[] {
  const t = getTerms(input.settings.documentLanguage);
  const { titlePage } = input;
  const studentTitlePage = buildStudentTitlePage({
    locale: input.settings.documentLanguage,
    title: titlePage.title,
    authors: titlePage.authors,
    affiliations: titlePage.affiliations,
    course: titlePage.course ?? "",
    instructor: titlePage.instructor ?? "",
    dueDate: titlePage.dueDate ?? "",
  });
  const out: Paragraph[] = [];

  // Push the title to roughly the upper third of the page.
  out.push(blankLine(), blankLine(), blankLine());
  out.push(centered(titlePage.title, { bold: true }));
  out.push(blankLine());
  if (studentTitlePage.byline.authorLine.length > 0) {
    out.push(
      centeredRuns(
        studentTitlePage.byline.authorLine.map((token) =>
          new TextRun({
            text: token.text,
            ...(token.kind === "superscript" ? { superScript: true } : {}),
          })
        ),
      ),
    );
  }
  for (const affiliation of studentTitlePage.byline.affiliations) {
    out.push(
      centeredRuns([
        ...(affiliation.number === undefined ? [] : [
          new TextRun({
            text: String(affiliation.number),
            superScript: true,
          }),
        ]),
        new TextRun(affiliation.name),
      ]),
    );
  }
  if (titlePage.course) out.push(centered(titlePage.course));
  if (titlePage.instructor) out.push(centered(titlePage.instructor));
  if (titlePage.dueDate) {
    const date = isoToApaDate(titlePage.dueDate);
    if (date) out.push(centered(t.formatLongDate(date)));
  }

  if (input.settings.variant === "professional" && titlePage.authorNote) {
    out.push(blankLine(), blankLine(), blankLine());
    out.push(
      new Paragraph({
        style: "Normal",
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: t.headings.authorNote, bold: true })],
      }),
    );
    out.push(
      new Paragraph({
        style: "BodyText",
        children: [new TextRun(titlePage.authorNote)],
      }),
    );
  }

  return out;
}
