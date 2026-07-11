/**
 * Writes the manual-verification artifacts to samples/ (repo root):
 * - tesina-spike.docx — the minimal M0 feature spike
 * - tesina-ensayo.docx — a full sample essay through the real exporter
 *
 * Run from the repo root: `deno task spike:docx`, then open both in Word,
 * LibreOffice, and Google Docs against docs/verification-checklist.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportDocx, exportSpikeDocx } from "../src/index.ts";
import { sampleEssayInput } from "../src/sample.ts";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const outDir = join(repoRoot, "samples");
await mkdir(outDir, { recursive: true });

const spike = await exportSpikeDocx();
await writeFile(join(outDir, "tesina-spike.docx"), spike);
console.log(`Escrito: samples/tesina-spike.docx (${spike.length} bytes)`);

const essay = await exportDocx(sampleEssayInput());
await writeFile(join(outDir, "tesina-ensayo.docx"), essay);
console.log(`Escrito: samples/tesina-ensayo.docx (${essay.length} bytes)`);
