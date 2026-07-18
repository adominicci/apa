import { describe, expect, it } from "vitest";
import { type Entry, parse } from "@retorquere/bibtex-parser";
import {
  type BibWarning,
  creatorToContributor,
  mapBibEntry,
  normalizeDoi,
  parseEdition,
  splitBibPages,
  stripDoiPrefix,
  stripMarkup,
} from "./map.ts";

/** Parse a snippet with the app's options and return its first entry. */
function entry(bib: string): Entry {
  const lib = parse(bib, { english: false, unsupported: "ignore" });
  return lib.entries[0];
}

function warns(bib: string): BibWarning[] {
  return mapBibEntry(entry(bib), "id-1").warnings;
}

describe("mapBibEntry — types", () => {
  it("maps @article to a journal article with de-escaped accents and pages", () => {
    const { ref } = mapBibEntry(
      entry(
        `@article{a, author={Garc{\\'i}a, Jos{\\'e} and Ríos, Ada},
          title={Lectura en pantallas}, journal={Revista Inventada},
          volume={12}, number={3}, pages={112--134}, year={2020}, month={jan},
          doi={https://doi.org/10.9999/inventado.123}}`,
      ),
      "ref-1",
    );
    expect(ref).toEqual({
      id: "ref-1",
      type: "journalArticle",
      authors: [
        { kind: "person", family: "García", given: "José" },
        { kind: "person", family: "Ríos", given: "Ada" },
      ],
      date: { year: 2020, month: 1 },
      title: "Lectura en pantallas",
      doi: "10.9999/inventado.123",
      journal: "Revista Inventada",
      volume: "12",
      issue: "3",
      pageStart: "112",
      pageEnd: "134",
    });
  });

  it("keeps a corporate author whole", () => {
    const { ref } = mapBibEntry(
      entry(
        `@book{b, author={{Fundación Inventada para la Lectura}},
          title={Manual de estilo}, publisher={Prensa Test}, year={2019}}`,
      ),
      "ref-2",
    );
    expect(ref.authors).toEqual([
      { kind: "group", name: "Fundación Inventada para la Lectura" },
    ]);
    expect(ref.type).toBe("book");
  });

  it("merges the nobiliary particle into the surname and keeps the suffix", () => {
    const { ref } = mapBibEntry(
      entry(
        `@incollection{c, author={van der Berg, Jr., Hans and Pérez Soto, Ana María},
          title={Un capítulo}, booktitle={Un libro editado}, editor={Ruiz, Ema},
          pages={5--20}, year={2018}}`,
      ),
      "ref-3",
    );
    expect(ref.type).toBe("bookChapter");
    expect(ref.authors).toEqual([
      { kind: "person", family: "van der Berg", given: "Hans", suffix: "Jr." },
      { kind: "person", family: "Pérez Soto", given: "Ana María" },
    ]);
    if (ref.type === "bookChapter") {
      expect(ref.bookTitle).toBe("Un libro editado");
      expect(ref.editors).toEqual([{
        kind: "person",
        family: "Ruiz",
        given: "Ema",
      }]);
      expect(ref.pageStart).toBe("5");
      expect(ref.pageEnd).toBe("20");
    }
  });

  it("maps @inreference to a reference entry using booktitle as the work title", () => {
    const { ref } = mapBibEntry(
      entry(
        `@inreference{r, title={Lectura}, booktitle={Enciclopedia Inventada}, year={2019}}`,
      ),
      "ref-4",
    );
    expect(ref.type).toBe("referenceEntry");
    if (ref.type === "referenceEntry") {
      expect(ref.workTitle).toBe("Enciclopedia Inventada");
    }
  });

  it("reads the thesis level from @thesis type and the maps @phdthesis/@mastersthesis", () => {
    const master = mapBibEntry(
      entry(
        `@thesis{t, author={Roa, Iris}, title={Estudio}, type={Master's thesis},
          institution={Universidad Inventada}, year={2021}}`,
      ),
      "ref-5",
    ).ref;
    expect(master.type).toBe("thesis");
    if (master.type === "thesis") {
      expect(master.thesisType).toBe("masters");
      expect(master.institution).toBe("Universidad Inventada");
    }
    const phd = mapBibEntry(
      entry(
        `@phdthesis{p, author={Sol, Uma}, title={Tesis}, school={U Test}, year={2020}}`,
      ),
      "ref-6",
    ).ref;
    expect(phd.type === "thesis" && phd.thesisType).toBe("doctoral");
  });

  it("sends @misc with a url to website and @misc without one to report+warning", () => {
    const web = mapBibEntry(
      entry(
        `@misc{m, title={Recurso}, url={https://ejemplo.test/x}, year={2023}}`,
      ),
      "ref-7",
    );
    expect(web.ref.type).toBe("website");
    // A url-bearing @misc is a clean website mapping — no "mapped as" flag.
    expect(web.warnings).not.toContainEqual({ code: "mappedAs", from: "misc" });

    const rep = mapBibEntry(
      entry(
        `@misc{m, title={Nota suelta}, organization={Grupo X}, year={2023}}`,
      ),
      "ref-8",
    );
    expect(rep.ref.type).toBe("report");
    expect(rep.warnings).toContainEqual({ code: "mappedAs", from: "misc" });
  });

  it("maps @online to a website with the organization as site name", () => {
    const { ref } = mapBibEntry(
      entry(
        `@online{o, title={Guía}, organization={Sitio X}, url={https://ejemplo.test/g},
          urldate={2024-03-11}, year={2023}}`,
      ),
      "ref-9",
    );
    expect(ref.type).toBe("website");
    if (ref.type === "website") expect(ref.siteName).toBe("Sitio X");
    expect(ref.retrievedDate).toEqual({ year: 2024, month: 3, day: 11 });
  });

  it("maps @artwork to an artwork with venue and medium", () => {
    const { ref, warnings } = mapBibEntry(
      entry(
        `@artwork{w, author={Vega, Leo}, title={Mural}, type={Pintura},
          organization={Museo Inventado}, year={2015}}`,
      ),
      "ref-10",
    );
    expect(ref.type).toBe("artwork");
    if (ref.type === "artwork") {
      expect(ref.medium).toBe("Pintura");
      expect(ref.venue).toBe("Museo Inventado");
    }
    expect(warnings).not.toContainEqual({ code: "mappedAs", from: "artwork" });
  });

  it("maps @music, @letter, magazine articles, and eprints to their real types", () => {
    const music = mapBibEntry(
      entry(
        `@music{m, author={Coro Test}, title={Álbum}, publisher={Sello X}, year={2020}}`,
      ),
      "ref-m",
    ).ref;
    expect(music.type).toBe("music");

    const letter = mapBibEntry(
      entry(
        `@letter{l, author={Paz, Ola}, title={Carta personal}, year={2021}}`,
      ),
      "ref-l",
    ).ref;
    expect(letter.type).toBe("personalCommunication");

    const mag = mapBibEntry(
      entry(
        `@article{a, author={Ríos, Ada}, title={Reportaje}, journal={Magacín X},
          entrysubtype={magazine}, year={2022}}`,
      ),
      "ref-mag",
    ).ref;
    expect(mag.type).toBe("newspaperArticle");

    const pre = mapBibEntry(
      entry(
        `@online{p, author={Sol, Uma}, title={Preprint}, eprint={2401.00123},
          archiveprefix={arXiv}, year={2024}}`,
      ),
      "ref-pre",
    ).ref;
    expect(pre.type).toBe("preprint");
    if (pre.type === "preprint") expect(pre.repository).toBe("arXiv");
  });

  it("warns and falls back to report for a genuinely unknown type", () => {
    const { ref, warnings } = mapBibEntry(
      entry(`@thingamajig{x, author={Paz, Ola}, title={Algo}, year={2020}}`),
      "ref-10b",
    );
    expect(ref.type).toBe("report");
    expect(warnings).toContainEqual({ code: "mappedAs", from: "thingamajig" });
  });
});

describe("mapBibEntry — dates and fields", () => {
  it("reads a biblatex date field when no year field is present", () => {
    const { ref } = mapBibEntry(
      entry(`@article{e, title={T}, journal={J}, date={2021-05}}`),
      "ref-11",
    );
    expect(ref.date).toEqual({ year: 2021, month: 5 });
  });

  it("flags an unparseable year as no-date", () => {
    expect(warns(`@misc{d, title={Sin fecha}, year={MMXX}}`)).toContainEqual({
      code: "badDate",
      raw: "MMXX",
    });
    const { ref } = mapBibEntry(
      entry(`@misc{d, title={Sin fecha}, year={MMXX}}`),
      "ref-12",
    );
    expect(ref.date).toEqual({ noDate: true });
  });

  it("marks a title-less entry", () => {
    expect(warns(`@misc{n, author={Paz, Ola}, year={2020}}`)).toContainEqual({
      code: "noTitle",
    });
  });

  it("judges no-authors on the mapped reference, not the raw fields", () => {
    // Edited book: people live in `editors`, so it is not author-less.
    expect(
      warns(`@book{b, editor={Ruiz, Ema}, title={Libro editado}, year={2020}}`),
    ).not.toContainEqual({ code: "noAuthors" });
    // Patent: the holder is promoted into `authors` before the check.
    expect(
      warns(
        `@patent{p, holder={Vega, Leo}, title={Invento}, number={US-1}, year={2020}}`,
      ),
    ).not.toContainEqual({ code: "noAuthors" });
  });

  it("drops note and other APA-irrelevant fields", () => {
    const { ref } = mapBibEntry(
      entry(
        `@book{b, title={T}, publisher={P}, year={2020}, note={léeme}, isbn={123}, keywords={a,b}}`,
      ),
      "ref-13",
    );
    expect(ref.extra).toBeUndefined();
    expect(JSON.stringify(ref)).not.toContain("léeme");
  });

  it("strips markup from non-title fields too, not only titles", () => {
    const { ref } = mapBibEntry(
      entry(
        `@book{b, title={T}, publisher={\\emph{Prensa} Test}, year={2020}}`,
      ),
      "ref-14",
    );
    expect(ref.type).toBe("book");
    if (ref.type === "book") expect(ref.publisher).toBe("Prensa Test");
  });

  it("ignores an out-of-range urldate month/day", () => {
    const { ref } = mapBibEntry(
      entry(
        `@misc{m, title={T}, url={http://x.test}, urldate={2024-13-40}, year={2023}}`,
      ),
      "ref-15",
    );
    expect(ref.retrievedDate).toEqual({ year: 2024 });
  });
});

describe("bibtex helpers", () => {
  it("strips markup the parser emits from \\textit / \\textbf", () => {
    expect(stripMarkup("The <i>Aedes</i> and <b>bold</b>")).toBe(
      "The Aedes and bold",
    );
    expect(stripMarkup('a <span class="nocase">DNA</span> b')).toBe("a DNA b");
  });

  it("splits page ranges and leaves a single locator alone", () => {
    expect(splitBibPages("112--134")).toEqual({
      pageStart: "112",
      pageEnd: "134",
    });
    expect(splitBibPages("45-67")).toEqual({ pageStart: "45", pageEnd: "67" });
    expect(splitBibPages("e0193972")).toEqual({ pageStart: "e0193972" });
  });

  it("normalizes editions and DOIs", () => {
    expect(parseEdition("2nd")).toBe("2");
    expect(parseEdition("Second")).toBe("Second");
    expect(stripDoiPrefix("https://doi.org/10.1/AB")).toBe("10.1/AB");
    expect(normalizeDoi("https://doi.org/10.1/AB")).toBe("10.1/ab");
  });

  it("converts a lone creator", () => {
    expect(
      creatorToContributor({
        lastName: "Berg",
        firstName: "Ana",
        prefix: "de la",
      }),
    ).toEqual({
      kind: "person",
      family: "de la Berg",
      given: "Ana",
    });
    expect(creatorToContributor({ name: "Grupo Test" })).toEqual({
      kind: "group",
      name: "Grupo Test",
    });
  });
});
