/**
 * Hard safety limits for untrusted `.tesina` archive work (task 1.3).
 *
 * Values are chosen from the measured representative fixtures in
 * `fixtures/libraries.ts` (empty, 120-essay large-text, figure-heavy):
 * the largest supported profile must fit with at least 4x headroom
 * (asserted in limits.test.ts) while every limit still bounds worst-case
 * memory to well under typical desktop RAM. Changing a number within a
 * supported range does not change the behavioral contract.
 */

export interface ArchiveLimits {
  /** Whole-file byte cap checked before any archive bytes are loaded. */
  maxArchiveBytes: number;
  /** Central-directory entry cap (essays + assets + 2 fixed files). */
  maxEntryCount: number;
  /** Cap for one expanded entry (largest realistic figure or essay JSON). */
  maxEntryExpandedBytes: number;
  /** Cap for the sum of all expanded entries. */
  maxTotalExpandedBytes: number;
  /** Expansion ratio above which a deflate stream is treated as a bomb. */
  maxCompressionRatio: number;
  /** Entries below this size are exempt from the ratio check (headers). */
  compressionRatioExemptBytes: number;
  /** Maximum nesting depth of any parsed JSON payload. */
  maxJsonDepth: number;
  /** Maximum total values (objects, arrays, primitives) in one payload. */
  maxJsonNodes: number;
  /** Maximum length of one JSON string value. */
  maxJsonStringLength: number;
  /** Content-entity caps. */
  maxEssays: number;
  maxReferences: number;
  maxCollections: number;
  maxAssets: number;
  maxFiguresPerEssay: number;
  /** Decoded-image cost caps (checked from headers, never by decoding). */
  maxImageDimension: number;
  maxImagePixels: number;
  maxImageFrames: number;
  maxTotalDecodedPixels: number;
  /** Identifier/entry-name caps. */
  maxIdLength: number;
  maxExtensionLength: number;
  maxEntryPathLength: number;
}

export const ARCHIVE_LIMITS: ArchiveLimits = {
  // Fixtures measure ~8 MiB (large-text) and ~1 MiB (figure-heavy) zipped;
  // 1 GiB supports image-rich libraries two orders of magnitude larger.
  maxArchiveBytes: 1024 * 1024 * 1024,
  // 120 essays + assets is ~160 entries; 20 000 covers 5 000 essays with
  // thousands of figures.
  maxEntryCount: 20_000,
  // The large-text essay JSON measures ~250 KiB; 128 MiB allows very large
  // single figures while keeping one entry's buffer bounded.
  maxEntryExpandedBytes: 128 * 1024 * 1024,
  maxTotalExpandedBytes: 2 * 1024 * 1024 * 1024,
  // Fixture text compresses ~17x; genuine bombs exceed 1000x. 200 is far
  // above legitimate prose yet stops a 1 GiB-from-5 MiB bomb.
  maxCompressionRatio: 200,
  compressionRatioExemptBytes: 4096,
  // Fixture documents nest ~10 levels (doc→section→figure→title→text).
  maxJsonDepth: 64,
  // The heaviest fixture essay holds ~21 000 JSON values.
  maxJsonNodes: 2_000_000,
  maxJsonStringLength: 16 * 1024 * 1024,
  maxEssays: 5_000,
  maxReferences: 50_000,
  maxCollections: 2_000,
  maxAssets: 10_000,
  maxFiguresPerEssay: 300,
  maxImageDimension: 16_384,
  maxImagePixels: 64_000_000,
  maxImageFrames: 1_000,
  maxTotalDecodedPixels: 512_000_000,
  maxIdLength: 64,
  maxExtensionLength: 5,
  maxEntryPathLength: 128,
};

export class LimitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LimitError";
    this.code = code;
  }
}

/**
 * Walks an already-parsed JSON value and enforces structural complexity
 * limits before any recursive consumer (planner, remapper) touches it.
 */
export function assertJsonWithinLimits(
  value: unknown,
  limits: ArchiveLimits,
): void {
  let nodes = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > limits.maxJsonDepth) {
      throw new LimitError(
        "limits/json-depth",
        `JSON nesting exceeds ${limits.maxJsonDepth}`,
      );
    }
    nodes += 1;
    if (nodes > limits.maxJsonNodes) {
      throw new LimitError(
        "limits/json-nodes",
        `JSON value count exceeds ${limits.maxJsonNodes}`,
      );
    }
    if (typeof node === "string") {
      if (node.length > limits.maxJsonStringLength) {
        throw new LimitError(
          "limits/json-string",
          `JSON string exceeds ${limits.maxJsonStringLength} characters`,
        );
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, item] of Object.entries(node)) {
        if (key.length > limits.maxJsonStringLength) {
          throw new LimitError(
            "limits/json-string",
            `JSON key exceeds ${limits.maxJsonStringLength} characters`,
          );
        }
        walk(item, depth + 1);
      }
    }
  };
  walk(value, 1);
}
