/**
 * Ambient declaration for `@retorquere/bibtex-parser` v10.
 *
 * The published 10.0.0 tarball ships `dist/{cjs,esm,data}` but omits the
 * `dist/types` directory its `package.json` "types" points at, so
 * `svelte-check`/`tsc` cannot resolve the module on its own. We declare only
 * the surface Tesina consumes; shapes verified against the shipped ESM bundle.
 */
declare module "@retorquere/bibtex-parser" {
  /** A parsed name: `name` is set for corporate/literal authors (`{{…}}`). */
  export interface Creator {
    /** Literal/corporate name, kept whole (from `author = {{…}}`). */
    name?: string;
    lastName?: string;
    firstName?: string;
    /** Nobiliary particle ("von", "de la"). */
    prefix?: string;
    /** Generational suffix ("Jr.", "III"). */
    suffix?: string;
    initial?: string;
    useprefix?: boolean;
    juniorcomma?: boolean;
  }

  /** Creator fields arrive as `Creator[]`, list fields as `string[]`, the rest as `string`. */
  export type FieldValue = string | string[] | Creator[];

  export interface Entry {
    /** Lower-cased entry type without the `@` ("article", "incollection"). */
    type: string;
    /** BibTeX citation key. */
    key: string;
    fields: Record<string, FieldValue>;
    mode: Record<string, string>;
    input: string;
  }

  export interface ParseError {
    error: string;
    input?: string;
  }

  export interface Library {
    entries: Entry[];
    errors: ParseError[];
    comments: string[];
    strings: Record<string, string>;
    preamble: string[];
    jabref?: unknown;
  }

  export interface Options {
    /**
     * Langids treated as English for sentence-casing. `false` (or `[]`)
     * disables sentence-casing entirely — Tesina keeps titles verbatim.
     */
    english?: string[] | boolean;
    /** `"ignore"` skips unknown TeX commands instead of throwing. */
    unsupported?:
      | "ignore"
      | ((node: unknown, tex: string, entry: Entry) => void);
    sentenceCase?:
      | boolean
      | { guess?: boolean; subSentence?: boolean; preserveQuoted?: boolean };
    raw?: boolean;
    applyCrossRef?: boolean;
    fieldMode?: Record<string, string>;
    languageAsLangid?: boolean;
  }

  export function parse(input: string, options?: Options): Library;
  export function parseAsync(
    input: string,
    options?: Options,
  ): Promise<Library>;
}
