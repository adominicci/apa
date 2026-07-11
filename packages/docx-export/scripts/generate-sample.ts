/**
 * Writes the spike document to samples/tesina-spike.docx (repo root) so it
 * can be opened by hand in Word, LibreOffice, and Google Docs.
 *
 * Run from the repo root: `deno task spike:docx`
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportSpikeDocx } from "../src/index.ts";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const outDir = join(repoRoot, "samples");
const outFile = join(outDir, "tesina-spike.docx");

const bytes = await exportSpikeDocx();
await mkdir(outDir, { recursive: true });
await writeFile(outFile, bytes);
console.log(`Escrito: ${outFile} (${bytes.length} bytes)`);
