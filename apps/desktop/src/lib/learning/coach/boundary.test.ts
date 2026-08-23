import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";

const COACH_DIR = new URL("./", import.meta.url);
const LIB_DIR = new URL("../../", import.meta.url);
const runtimeFiles = [
  "types.ts",
  "segmentation.ts",
  "normalization.ts",
  "rules.ts",
  "unslopV1.ts",
];

async function sourceFiles(directory: URL): Promise<URL[]> {
  const result: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) result.push(...await sourceFiles(url));
    else if (/\.(?:ts|svelte)$/u.test(entry.name)) result.push(url);
  }
  return result;
}

describe("hidden coach module boundary", () => {
  it("keeps the runtime graph pure and independent of evaluator fixtures", async () => {
    const forbidden = [
      "@tauri",
      "svelte",
      "$lib/editor",
      "fetch(",
      "localStorage",
      "indexedDB",
      "settings",
      "model",
      "generation",
      "quiz",
      "telemetry",
      "./fixtures",
      "./evaluate",
      "./reviewBundle",
    ];
    for (const file of runtimeFiles) {
      const source = await readFile(new URL(file, COACH_DIR), "utf8");
      expect(forbidden.filter((token) => source.includes(token)), file).toEqual(
        [],
      );
    }
  });

  it("is not registered anywhere outside its own hidden directory", async () => {
    const files = (await sourceFiles(LIB_DIR)).filter((file) =>
      !file.pathname.includes("/learning/coach/")
    );
    const imports = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/learning\/coach|from\s+["'][^"']*coach/u.test(source)) {
        imports.push(file.pathname);
      }
    }
    expect(imports).toEqual([]);
  });
});
