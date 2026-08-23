import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import {
  auditProductionImports,
  findRuntimeRegistrations,
  type SourceFile,
} from "./boundaryAudit.ts";

const COACH_DIR = new URL("./", import.meta.url);
const APP_SRC_DIR = new URL("../../../", import.meta.url);
const TAURI_DIR = new URL("../../../../src-tauri/", import.meta.url);

async function sourceFiles(directory: URL): Promise<URL[]> {
  const result: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) result.push(...await sourceFiles(url));
    else if (/\.(?:js|rs|svelte|ts)$/u.test(entry.name)) result.push(url);
  }
  return result;
}

async function readSourceFiles(directory: URL): Promise<SourceFile[]> {
  return await Promise.all((await sourceFiles(directory)).map(async (file) => ({
    path: file.pathname,
    source: await readFile(file, "utf8"),
  })));
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
    const files = await readSourceFiles(COACH_DIR);
    expect(auditProductionImports(files, [
      new URL("rules.ts", COACH_DIR).pathname,
      new URL("unslopV1.ts", COACH_DIR).pathname,
    ], forbidden)).toEqual([]);
  });

  it("detects forbidden code in a transitively imported production helper", () => {
    const files: SourceFile[] = [
      { path: "/coach/rules.ts", source: 'import "./helper.ts";' },
      {
        path: "/coach/helper.ts",
        source: 'export const load = () => fetch("https://example.invalid");',
      },
    ];
    expect(auditProductionImports(files, ["/coach/rules.ts"], ["fetch("]))
      .toEqual([{ path: "/coach/helper.ts", token: "fetch(" }]);
  });

  it("is not registered in application routes, state, or Tauri", async () => {
    const files = [
      ...await readSourceFiles(APP_SRC_DIR),
      ...await readSourceFiles(TAURI_DIR),
    ].filter((file) => !file.path.includes("/learning/coach/"));
    expect(findRuntimeRegistrations(files)).toEqual([]);
  });

  it("detects route and Tauri registration mutations", () => {
    const files: SourceFile[] = [
      {
        path: "/app/src/routes/+page.ts",
        source:
          'import { analyzeWriting } from "$lib/learning/coach/rules.ts";',
      },
      {
        path: "/app/src-tauri/src/lib.rs",
        source: "tauri::generate_handler![writing_coach]",
      },
    ];
    expect(findRuntimeRegistrations(files)).toEqual([
      "/app/src-tauri/src/lib.rs",
      "/app/src/routes/+page.ts",
    ]);
  });
});
