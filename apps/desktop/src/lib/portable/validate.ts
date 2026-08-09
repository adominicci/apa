/**
 * Full semantic validation of an untrusted `.tesina` archive (design §4).
 * Layers on the structural reader: entry grammar, manifest counts, JSON
 * complexity and shapes, canonical identifiers, filename/payload binding,
 * bounded image headers, and complete relationship resolution (figures,
 * citations, snapshots, collection members). Discriminated `code` values are
 * the localization keys the UI maps to Paraglide messages.
 */

import type { Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import type { RefCollection } from "$lib/model/collections";
import {
  type ArchiveLimits,
  assertJsonWithinLimits,
  LimitError,
} from "./limits.ts";
import { readArchiveStructure } from "./archive.ts";
import { collectFigureSources } from "./snapshot.ts";
import {
  IMAGE_MEDIA_TYPES,
  type ImageHeader,
  ImageHeaderError,
  readImageHeader,
  SUPPORTED_IMAGE_EXTENSIONS,
} from "./imageHeaders.ts";
import { isCanonicalUuid, parseArchiveEntryPath, PathError } from "./paths.ts";
import {
  ArchiveError,
  type LibraryArchiveManifestV1,
  type SharedLibraryFile,
} from "./types.ts";

export class ValidateError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "ValidateError";
    this.code = code;
    this.detail = detail;
  }
}

export interface ValidatedAsset {
  bytes: Uint8Array;
  extension: string;
  width: number;
  height: number;
  frames: number;
  sha256: string;
}

export interface ValidatedArchive {
  manifest: LibraryArchiveManifestV1;
  essays: Essay[];
  library: Required<Pick<SharedLibraryFile, "schemaVersion" | "references">> & {
    collections: RefCollection[];
  };
  /** Keyed by archive path (`assets/<uuid>.<ext>`). */
  assets: Map<string, ValidatedAsset>;
}

function parseJsonPayload(
  bytes: Uint8Array,
  limits: ArchiveLimits,
  where: string,
): unknown {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ValidateError(
      "validate/json-parse",
      "payload is not JSON",
      where,
    );
  }
  try {
    assertJsonWithinLimits(value, limits);
  } catch (error) {
    if (error instanceof LimitError) {
      throw new ValidateError(
        "validate/json-limits",
        "payload exceeds JSON complexity limits",
        `${where}: ${error.code}`,
      );
    }
    throw error;
  }
  return value;
}

function requireCanonicalId(value: unknown, where: string): string {
  if (typeof value !== "string" || !isCanonicalUuid(value)) {
    throw new ValidateError(
      "validate/identifier",
      "an identifier is not a canonical lowercase UUID",
      where,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function referenceError(code: string, where: string): never {
  throw new ValidateError(code, "a reference entry is malformed", where);
}

function validOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function validOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function validOptionalInteger(value: unknown): boolean {
  return value === undefined || Number.isSafeInteger(value);
}

function validateDate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return validOptionalInteger(value.year) &&
    (value.month === undefined ||
      (Number.isSafeInteger(value.month) && Number(value.month) >= 1 &&
        Number(value.month) <= 12)) &&
    (value.day === undefined ||
      (Number.isSafeInteger(value.day) && Number(value.day) >= 1 &&
        Number(value.day) <= 31)) &&
    validOptionalBoolean(value.noDate) && validOptionalBoolean(value.inPress);
}

function validateContributors(value: unknown): boolean {
  return Array.isArray(value) && value.every((contributor) => {
    if (!isRecord(contributor)) return false;
    if (contributor.kind === "person") {
      return typeof contributor.family === "string" &&
        validOptionalString(contributor.given) &&
        validOptionalString(contributor.suffix);
    }
    return contributor.kind === "group" &&
      typeof contributor.name === "string" &&
      validOptionalString(contributor.abbreviation);
  });
}

function validateOptionalContributors(value: unknown): boolean {
  return value === undefined || validateContributors(value);
}

function validateReferencePayload(
  value: unknown,
  where: string,
  code: string,
): Reference {
  if (!isRecord(value)) referenceError(code, where);
  requireCanonicalId(value.id, `${where}: reference id`);
  if (
    typeof value.title !== "string" || !validateContributors(value.authors) ||
    !validateDate(value.date) || !validOptionalString(value.doi) ||
    !validOptionalString(value.url) || !validOptionalString(value.extra) ||
    (value.retrievedDate !== undefined && !validateDate(value.retrievedDate))
  ) referenceError(code, where);

  const strings = (...keys: string[]) =>
    keys.every((key) => validOptionalString(value[key]));
  const requiredStrings = (...keys: string[]) =>
    keys.every((key) => typeof value[key] === "string");
  let valid = false;
  switch (value.type) {
    case "journalArticle":
      valid = requiredStrings("journal") &&
        strings("volume", "issue", "pageStart", "pageEnd", "articleNumber");
      break;
    case "book":
      valid = strings("edition", "volume", "publisher", "descriptor") &&
        validateOptionalContributors(value.editors) &&
        validateOptionalContributors(value.translators) &&
        validateOptionalContributors(value.illustrators) &&
        validOptionalInteger(value.originalYear);
      break;
    case "bookChapter":
      valid = validateContributors(value.editors) &&
        requiredStrings("bookTitle") &&
        strings("edition", "volume", "pageStart", "pageEnd", "publisher");
      break;
    case "website":
      valid = strings("siteName");
      break;
    case "report":
      valid = strings(
        "institution",
        "reportNumber",
        "standardNumber",
        "descriptor",
      );
      break;
    case "thesis":
      valid =
        (value.thesisType === "doctoral" || value.thesisType === "masters") &&
        requiredStrings("institution") && strings("archive") &&
        validOptionalBoolean(value.unpublished);
      break;
    case "conferencePaper":
      valid = requiredStrings("conferenceName") &&
        strings("location", "contributionType") &&
        validOptionalInteger(value.dayEnd);
      break;
    case "newspaperArticle":
      valid = requiredStrings("publication") &&
        strings("volume", "issue", "pageStart", "pageEnd");
      break;
    case "referenceEntry":
      valid = requiredStrings("workTitle") && strings("edition", "publisher");
      break;
    case "video":
      valid = requiredStrings("platform") && strings("username", "descriptor");
      break;
    case "podcastEpisode":
      valid = (value.kind === undefined || value.kind === "episode" ||
        value.kind === "show") &&
        strings("episodeNumber", "showTitle", "platform") &&
        validOptionalInteger(value.yearEnd) &&
        validOptionalBoolean(value.ongoing);
      break;
    case "socialMedia":
      valid = requiredStrings("platform", "contentType") && strings("username");
      break;
    case "software":
      valid = (value.kind === "software" || value.kind === "dataset") &&
        strings("version", "publisher", "descriptor");
      break;
    case "film":
      valid = (value.kind === "film" || value.kind === "tvSeries") &&
        strings("productionCompany") && validOptionalInteger(value.yearEnd) &&
        validOptionalBoolean(value.ongoing);
      break;
    case "tvEpisode":
      valid = requiredStrings("seriesTitle") &&
        (value.credit === undefined || value.credit === "writer" ||
          value.credit === "director" || value.credit === "writerDirector") &&
        strings("season", "episode", "productionCompany") &&
        validateOptionalContributors(value.executiveProducers);
      break;
    case "music":
      valid = (value.kind === "album" || value.kind === "song") &&
        strings("albumTitle", "label");
      break;
    case "artwork":
      valid = strings("medium", "venue", "location");
      break;
    case "preprint":
      valid = requiredStrings("repository") && strings("itemNumber");
      break;
    case "unpublishedWork":
      valid =
        (value.status === "unpublished" || value.status === "inPreparation" ||
          value.status === "submitted") && strings("institution");
      break;
    case "personalCommunication":
      valid = strings("medium");
      break;
  }
  if (!valid) referenceError(code, where);
  return value as unknown as Reference;
}

function validateLibraryPayload(
  value: unknown,
  where: string,
): ValidatedArchive["library"] {
  const lib = value as Partial<SharedLibraryFile>;
  if (
    lib === null || typeof lib !== "object" || lib.schemaVersion !== 1 ||
    !Array.isArray(lib.references) ||
    (lib.collections !== undefined && !Array.isArray(lib.collections))
  ) {
    throw new ValidateError(
      "validate/library-schema",
      "library.json is not a valid schema-version-1 library",
      where,
    );
  }
  for (const reference of lib.references) {
    validateReferencePayload(reference, where, "validate/library-schema");
  }
  const collections = lib.collections ?? [];
  for (const collection of collections) {
    if (
      collection === null || typeof collection !== "object" ||
      typeof (collection as RefCollection).name !== "string" ||
      !Array.isArray((collection as RefCollection).refIds)
    ) {
      throw new ValidateError(
        "validate/library-schema",
        "a collection entry is malformed",
        where,
      );
    }
    requireCanonicalId(
      (collection as RefCollection).id,
      `${where}: collection id`,
    );
    for (const refId of (collection as RefCollection).refIds) {
      if (typeof refId !== "string") {
        throw new ValidateError(
          "validate/library-schema",
          "a collection member id is malformed",
          where,
        );
      }
    }
  }
  return {
    schemaVersion: 1,
    references: lib.references as Reference[],
    collections: collections as RefCollection[],
  };
}

function validateEssayPayload(
  value: unknown,
  expectedId: string,
  where: string,
): Essay {
  const essay = value as Partial<Essay> & {
    importedAt?: unknown;
    sourceEssayId?: unknown;
  };
  if (
    essay === null || typeof essay !== "object" || essay.schemaVersion !== 2
  ) {
    throw new ValidateError(
      "validate/essay-schema",
      "an essay payload is not schema version 2",
      where,
    );
  }
  validateEssaySettings(essay.settings, where);
  validateTitlePage(essay.titlePage, where);
  validateProseMirrorDoc(essay.content, where);
  const id = requireCanonicalId(essay.id, `${where}: essay id`);
  if (id !== expectedId) {
    throw new ValidateError(
      "validate/essay-id-mismatch",
      "essay id disagrees with its archive entry name",
      where,
    );
  }
  if (
    typeof essay.createdAt !== "string" ||
    typeof essay.updatedAt !== "string" ||
    typeof essay.settings !== "object" || essay.settings === null ||
    typeof essay.titlePage !== "object" || essay.titlePage === null ||
    essay.content === undefined || !Array.isArray(essay.referencesSnapshot)
  ) {
    throw new ValidateError(
      "validate/essay-schema",
      "an essay payload is missing required fields",
      where,
    );
  }
  if (essay.importedAt !== undefined && typeof essay.importedAt !== "string") {
    throw new ValidateError(
      "validate/essay-schema",
      "importedAt must be a string when present",
      where,
    );
  }
  if (essay.sourceEssayId !== undefined) {
    requireCanonicalId(essay.sourceEssayId, `${where}: sourceEssayId`);
  }
  for (const reference of essay.referencesSnapshot) {
    validateReferencePayload(reference, where, "validate/essay-schema");
  }
  return essay as Essay;
}

const DOCUMENT_LANGUAGES = new Set(["en", "es"]);
const PAPER_VARIANTS = new Set(["student", "professional"]);
const FONT_CHOICES = new Set([
  "times-new-roman-12",
  "georgia-11",
  "computer-modern-10",
  "aptos-12",
  "calibri-11",
  "arial-11",
  "lucida-sans-unicode-10",
]);
const PAPER_SIZES = new Set(["us-letter", "a4"]);

function validateEssaySettings(value: unknown, where: string): void {
  const settings = value as Record<string, unknown>;
  if (
    !DOCUMENT_LANGUAGES.has(String(settings.documentLanguage)) ||
    !PAPER_VARIANTS.has(String(settings.variant)) ||
    !FONT_CHOICES.has(String(settings.font)) ||
    !PAPER_SIZES.has(String(settings.paperSize)) ||
    typeof settings.includeUncitedReferences !== "boolean" ||
    (settings.runningHead !== undefined &&
      typeof settings.runningHead !== "string") ||
    (settings.wordGoal !== undefined &&
      (!Number.isSafeInteger(settings.wordGoal) ||
        (settings.wordGoal as number) <= 0))
  ) {
    throw new ValidateError(
      "validate/essay-schema",
      "an essay has malformed or unsupported settings",
      where,
    );
  }
}

function validateTitlePage(value: unknown, where: string): void {
  const titlePage = value as Record<string, unknown>;
  const optionalStrings = ["course", "instructor", "dueDate", "authorNote"];
  if (
    typeof titlePage.title !== "string" ||
    !Array.isArray(titlePage.authors) ||
    !titlePage.authors.every((item) => typeof item === "string") ||
    !Array.isArray(titlePage.affiliations) ||
    !titlePage.affiliations.every((item) => typeof item === "string") ||
    optionalStrings.some((key) =>
      titlePage[key] !== undefined && typeof titlePage[key] !== "string"
    )
  ) {
    throw new ValidateError(
      "validate/essay-schema",
      "an essay has a malformed title page",
      where,
    );
  }
}

const SUPPORTED_NODE_TYPES = new Set([
  "doc",
  "sectionAbstract",
  "sectionBody",
  "sectionAppendix",
  "keywordsLine",
  "paragraph",
  "text",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "hardBreak",
  "citation",
  "apaTable",
  "tableTitle",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "tableNote",
  "figure",
  "figureTitle",
  "figureImage",
  "figureNote",
  "apaEquation",
]);
const SUPPORTED_MARK_TYPES = new Set(["bold", "italic", "underline"]);

function validateProseMirrorDoc(value: unknown, where: string): void {
  if (value === null || typeof value !== "object") {
    throwEssayContent(where);
  }
  const doc = value as { type?: unknown; content?: unknown };
  if (doc.type !== "doc" || !Array.isArray(doc.content)) {
    throwEssayContent(where);
  }
  const sectionTypes = doc.content.map((node) =>
    node !== null && typeof node === "object"
      ? (node as { type?: unknown }).type
      : undefined
  );
  let index = sectionTypes[0] === "sectionAbstract" ? 1 : 0;
  if (sectionTypes[index] !== "sectionBody") throwEssayContent(where);
  index += 1;
  if (sectionTypes.slice(index).some((type) => type !== "sectionAppendix")) {
    throwEssayContent(where);
  }
  walkProseMirrorNode(doc, where);
}

function walkProseMirrorNode(value: unknown, where: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throwEssayContent(where);
  }
  const node = value as {
    type?: unknown;
    text?: unknown;
    attrs?: unknown;
    marks?: unknown;
    content?: unknown;
  };
  if (typeof node.type !== "string" || !SUPPORTED_NODE_TYPES.has(node.type)) {
    throwEssayContent(where);
  }
  if (node.type === "text" && typeof node.text !== "string") {
    throwEssayContent(where);
  }
  if (node.type !== "text" && node.text !== undefined) throwEssayContent(where);
  if (
    node.attrs !== undefined &&
    (node.attrs === null || typeof node.attrs !== "object" ||
      Array.isArray(node.attrs))
  ) throwEssayContent(where);
  if (node.type === "citation") validateCitationAttrs(node.attrs, where);
  if (node.type === "figureImage") validateFigureImageAttrs(node.attrs, where);
  if (node.type === "apaEquation") validateEquationAttrs(node.attrs, where);
  if (node.type === "tableCell" || node.type === "tableHeader") {
    validateTableCellAttrs(node.attrs, where);
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) throwEssayContent(where);
    for (const mark of node.marks) {
      if (
        mark === null || typeof mark !== "object" ||
        !SUPPORTED_MARK_TYPES.has(String((mark as { type?: unknown }).type))
      ) throwEssayContent(where);
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) throwEssayContent(where);
    for (const child of node.content) walkProseMirrorNode(child, where);
  }
  validateNodeChildren(node, where);
}

function validateEquationAttrs(value: unknown, where: string): void {
  if (!isRecord(value) || typeof value.latex !== "string") {
    throwEssayContent(where);
  }
}

const MAX_TABLE_SPAN = 1_000;
const MAX_TABLE_COLUMN_WIDTH = 100_000;

function validateTableCellAttrs(value: unknown, where: string): void {
  if (value !== undefined && !isRecord(value)) throwEssayContent(where);
  const attrs = value ?? {};
  const colspan = (attrs as Record<string, unknown>).colspan ?? 1;
  const rowspan = (attrs as Record<string, unknown>).rowspan ?? 1;
  if (
    !Number.isInteger(colspan) || Number(colspan) < 1 ||
    Number(colspan) > MAX_TABLE_SPAN ||
    !Number.isInteger(rowspan) || Number(rowspan) < 1 ||
    Number(rowspan) > MAX_TABLE_SPAN
  ) throwEssayContent(where);
  const colwidth = (attrs as Record<string, unknown>).colwidth;
  if (colwidth === undefined || colwidth === null) return;
  if (
    !Array.isArray(colwidth) || colwidth.length !== Number(colspan) ||
    colwidth.some((width) =>
      !Number.isInteger(width) || Number(width) < 1 ||
      Number(width) > MAX_TABLE_COLUMN_WIDTH
    )
  ) throwEssayContent(where);
}

function validateFigureImageAttrs(value: unknown, where: string): void {
  if (
    !isRecord(value) || typeof value.src !== "string" ||
    typeof value.alt !== "string"
  ) {
    throwEssayContent(where);
  }
  try {
    if (parseArchiveEntryPath(value.src).kind !== "asset") {
      throwEssayContent(where);
    }
  } catch (error) {
    if (error instanceof ValidateError) throw error;
    throwEssayContent(where);
  }
}

const CITATION_MODES = new Set(["parenthetical", "narrative"]);
const LOCATOR_TYPES = new Set(["page", "pages", "paragraph", "timestamp"]);

function validateCitationAttrs(value: unknown, where: string): void {
  if (
    !isRecord(value) || !Array.isArray(value.items) ||
    !CITATION_MODES.has(String(value.mode))
  ) {
    throwEssayContent(where);
  }
  for (const item of value.items) {
    if (!isRecord(item)) throwEssayContent(where);
    requireCanonicalId(item.refId, `${where}: citation refId`);
    if (
      !validOptionalString(item.prefix) || !validOptionalString(item.suffix) ||
      !validOptionalBoolean(item.suppressAuthor)
    ) throwEssayContent(where);
    if (item.locator !== undefined) {
      if (
        !isRecord(item.locator) ||
        !LOCATOR_TYPES.has(String(item.locator.type)) ||
        typeof item.locator.value !== "string"
      ) throwEssayContent(where);
    }
  }
}

function validateNodeChildren(
  node: { type?: unknown; attrs?: unknown; content?: unknown },
  where: string,
): void {
  const type = String(node.type);
  const children = Array.isArray(node.content) ? node.content : [];
  const childTypes = children.map((child) =>
    String((child as { type?: unknown }).type)
  );
  const all = (allowed: Set<string>) =>
    childTypes.every((childType) => allowed.has(childType));
  const inline = new Set(["text", "citation", "hardBreak"]);
  const blocks = new Set([
    "paragraph",
    "heading",
    "blockquote",
    "bulletList",
    "orderedList",
    "apaTable",
    "figure",
  ]);
  const nonEmptyBlocks = new Set([...blocks, "apaEquation"]);
  let valid = true;
  switch (type) {
    case "doc":
      // The exact section ordering is checked by validateProseMirrorDoc.
      valid = children.length > 0;
      break;
    case "sectionAbstract":
      valid = children.length > 0 && childTypes[0] === "paragraph" &&
        childTypes.every((childType, index) =>
          childType === "paragraph" ||
          (childType === "keywordsLine" && index === childTypes.length - 1)
        );
      break;
    case "sectionBody":
    case "sectionAppendix":
      valid = children.length > 0 && all(nonEmptyBlocks);
      break;
    case "paragraph":
    case "heading":
    case "keywordsLine":
    case "tableTitle":
    case "tableNote":
    case "figureTitle":
    case "figureNote":
      valid = all(inline);
      break;
    case "blockquote":
    case "tableCell":
    case "tableHeader":
      valid = children.length > 0 && all(blocks);
      break;
    case "bulletList":
    case "orderedList":
      valid = children.length > 0 && childTypes.every((t) => t === "listItem");
      break;
    case "listItem":
      valid = children.length > 0 && childTypes[0] === "paragraph" &&
        all(blocks);
      break;
    case "apaTable":
      valid = childTypes.length === 3 && childTypes[0] === "tableTitle" &&
        childTypes[1] === "table" && childTypes[2] === "tableNote";
      break;
    case "table":
      valid = children.length > 0 && childTypes.every((t) => t === "tableRow");
      break;
    case "tableRow":
      valid = children.length > 0 &&
        childTypes.every((t) => t === "tableHeader" || t === "tableCell");
      break;
    case "figure":
      valid = childTypes.length === 3 && childTypes[0] === "figureTitle" &&
        childTypes[1] === "figureImage" && childTypes[2] === "figureNote";
      break;
    case "text":
    case "citation":
    case "hardBreak":
    case "figureImage":
    case "apaEquation":
      valid = children.length === 0;
      break;
  }
  if (!valid) throwEssayContent(where);
}

function throwEssayContent(where: string): never {
  throw new ValidateError(
    "validate/essay-schema",
    "an essay contains an unsupported ProseMirror document",
    where,
  );
}

interface DocNode {
  type?: string;
  attrs?: { items?: { refId?: unknown }[] };
  content?: unknown[];
}

function collectCitationRefIds(docJson: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as DocNode;
    if (n.type === "citation" && Array.isArray(n.attrs?.items)) {
      for (const item of n.attrs.items) {
        if (item && typeof item.refId === "string") ids.push(item.refId);
      }
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        walk(child);
      }
    }
  };
  walk(docJson);
  return ids;
}

/** Validates untrusted archive bytes end to end. Throws on the first defect. */
export async function validateArchive(
  bytes: Uint8Array,
  limits: ArchiveLimits,
): Promise<ValidatedArchive> {
  const { manifest, files } = await readArchiveStructure(bytes, limits);
  const records = new Map(manifest.files.map((f) => [f.path, f]));

  // 1. Entry grammar; collect the typed sets.
  const essayIds: string[] = [];
  const assetPaths = new Map<string, string>(); // path -> extension
  let hasLibrary = false;
  for (const path of files.keys()) {
    let parsed;
    try {
      parsed = parseArchiveEntryPath(path);
    } catch (error) {
      if (error instanceof PathError) {
        throw new ValidateError(
          "validate/entry-path",
          "an archive entry is outside the allowed path grammar",
          path,
        );
      }
      throw error;
    }
    if (parsed.kind === "library") hasLibrary = true;
    if (parsed.kind === "essay") essayIds.push(parsed.id);
    if (parsed.kind === "asset") {
      if (!SUPPORTED_IMAGE_EXTENSIONS[parsed.extension]) {
        throw new ValidateError(
          "validate/asset-extension",
          "an asset uses an unsupported figure extension",
          path,
        );
      }
      assetPaths.set(path, parsed.extension);
    }
  }
  if (!hasLibrary) {
    throw new ValidateError(
      "validate/library-missing",
      "the archive has no library.json",
    );
  }

  // 2. Entity count limits.
  if (essayIds.length > limits.maxEssays) {
    throw new ValidateError("validate/entity-limit", "too many essays");
  }
  if (assetPaths.size > limits.maxAssets) {
    throw new ValidateError("validate/entity-limit", "too many assets");
  }

  // 3. Library payload.
  const library = validateLibraryPayload(
    parseJsonPayload(files.get("library.json")!, limits, "library.json"),
    "library.json",
  );
  if (library.references.length > limits.maxReferences) {
    throw new ValidateError("validate/entity-limit", "too many references");
  }
  if (library.collections.length > limits.maxCollections) {
    throw new ValidateError("validate/entity-limit", "too many collections");
  }

  // 4. Essay payloads.
  const essays: Essay[] = [];
  for (const id of essayIds) {
    const path = `essays/${id}.json`;
    essays.push(
      validateEssayPayload(
        parseJsonPayload(files.get(path)!, limits, path),
        id,
        path,
      ),
    );
  }

  // 5. Image headers under the decoded-cost limits.
  const assets = new Map<string, ValidatedAsset>();
  let totalPixels = 0;
  for (const [path, extension] of assetPaths) {
    const payload = files.get(path)!;
    const record = records.get(path)!;
    let header: ImageHeader;
    try {
      header = readImageHeader(payload, extension, limits.maxImageFrames);
    } catch (error) {
      if (error instanceof ImageHeaderError) {
        throw new ValidateError(
          "validate/image-signature",
          "an asset's bytes do not match its declared format",
          path,
        );
      }
      throw error;
    }
    if (record.mediaType !== IMAGE_MEDIA_TYPES[header.kind]) {
      throw new ValidateError(
        "validate/media-type",
        "a manifest media type disagrees with the asset format",
        path,
      );
    }
    if (
      header.width > limits.maxImageDimension ||
      header.height > limits.maxImageDimension ||
      header.frames > limits.maxImageFrames ||
      header.width * header.height > limits.maxImagePixels
    ) {
      throw new ValidateError(
        "validate/image-limit",
        "an image exceeds the supported dimensions or frame count",
        path,
      );
    }
    totalPixels += header.width * header.height * Math.max(1, header.frames);
    if (totalPixels > limits.maxTotalDecodedPixels) {
      throw new ValidateError(
        "validate/image-limit",
        "the archive's cumulative decoded pixels exceed the safety limit",
        path,
      );
    }
    assets.set(path, {
      bytes: payload,
      extension,
      width: header.width,
      height: header.height,
      frames: header.frames,
      sha256: record.sha256,
    });
  }

  // 6. Manifest counts must agree with the validated payload.
  if (
    manifest.counts.essays !== essays.length ||
    manifest.counts.references !== library.references.length ||
    manifest.counts.collections !== library.collections.length ||
    manifest.counts.assets !== assets.size
  ) {
    throw new ValidateError(
      "validate/counts-mismatch",
      "manifest counts disagree with the archive content",
    );
  }

  // 7. Relationships: figures, citations, collection members.
  const referenceIds = new Set(library.references.map((r) => r.id));
  for (const essay of essays) {
    let figures = 0;
    for (const src of collectFigureSources(essay.content)) {
      figures += 1;
      if (!assets.has(src)) {
        throw new ValidateError(
          "validate/missing-asset",
          "an essay references a figure that is not in the archive",
          `${essay.id}: ${src}`,
        );
      }
    }
    if (figures > limits.maxFiguresPerEssay) {
      throw new ValidateError(
        "validate/entity-limit",
        "an essay exceeds the figure limit",
        essay.id,
      );
    }
    const snapshotIds = new Set(essay.referencesSnapshot.map((r) => r.id));
    for (const refId of collectCitationRefIds(essay.content)) {
      if (!referenceIds.has(refId) && !snapshotIds.has(refId)) {
        throw new ValidateError(
          "validate/unresolved-citation",
          "a citation references an id that resolves nowhere in the archive",
          `${essay.id}: ${refId}`,
        );
      }
    }
  }
  for (const collection of library.collections) {
    for (const refId of collection.refIds) {
      if (!referenceIds.has(refId)) {
        throw new ValidateError(
          "validate/unresolved-collection-member",
          "a collection member resolves nowhere in the archive",
          `${collection.id}: ${refId}`,
        );
      }
    }
  }

  return { manifest, essays, library, assets };
}

export { ArchiveError };
