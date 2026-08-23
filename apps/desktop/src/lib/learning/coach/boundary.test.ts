import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  auditProductionImports,
  findRuntimeRegistrations,
  type SourceFile,
} from "./boundaryAudit.ts";

const COACH_DIR = new URL("./", import.meta.url);
const COACH_EXPERIENCE_DIR = new URL("../coachExperience/", import.meta.url);
const APP_SRC_DIR = new URL("../../../", import.meta.url);
const TAURI_DIR = new URL("../../../../src-tauri/", import.meta.url);
const ARCHIVED_TASKS = new URL(
  "../../../../../../openspec/changes/archive/2026-08-23-add-writing-coach-experience/tasks.md",
  import.meta.url,
);

async function sourceFiles(directory: URL): Promise<URL[]> {
  const result: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) result.push(...await sourceFiles(url));
    else if (/\.(?:js|rs|svelte|tsx?)$/u.test(entry.name)) result.push(url);
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
  it("keeps the archived manual evidence link resolvable", async () => {
    const tasks = await readFile(ARCHIVED_TASKS, "utf8");
    const href = tasks.match(
      /\[assistive-technology and overflow evidence\]\(([^)]+)\)/u,
    )?.[1];
    expect(href).toBeDefined();
    const evidence = await readFile(new URL(href!, ARCHIVED_TASKS), "utf8");
    expect(evidence).toContain(
      "# LT-04 Writing Coach experience manual evidence",
    );
  });

  it("does not delegate deterministic ordering to locale collation", async () => {
    for (const file of ["normalization.ts", "unslopV1.ts"]) {
      const source = await readFile(new URL(file, COACH_DIR), "utf8");
      expect(source, file).not.toContain(".localeCompare(");
    }
  });

  it("includes TSX files in application registration scans", async () => {
    const directory = await mkdtemp(
      resolve(tmpdir(), "tesina-coach-boundary-"),
    );
    try {
      await writeFile(`${directory}/registration.tsx`, "export {};\n");
      const files = await sourceFiles(pathToFileURL(`${directory}/`));
      expect(files.map((file) => file.pathname)).toContain(
        `${directory}/registration.tsx`,
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });

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

  it("keeps the desktop experience free of persistence, network, model, quiz, telemetry, APA, and export authority", async () => {
    const forbidden = [
      "@tauri",
      "fetch(",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "$lib/persist",
      "$lib/state",
      "$lib/model",
      "$lib/export",
      "apaCheck",
      "checkApa",
      "telemetry",
      "analytics",
      "quiz",
    ];
    const files = (await readSourceFiles(APP_SRC_DIR)).filter((file) =>
      !file.path.includes(".test.")
    );
    const entryPoints = files.filter((file) =>
      file.path.startsWith(COACH_EXPERIENCE_DIR.pathname)
    ).map((file) => file.path);
    expect(auditProductionImports(files, entryPoints, forbidden)).toEqual([]);
  });

  it("detects forbidden code in a transitively imported production helper", () => {
    const files: SourceFile[] = [
      {
        path: "/app/coachExperience/controller.ts",
        source: 'import "../shared/helper.ts";',
      },
      {
        path: "/app/shared/helper.ts",
        source: 'export const load = () => fetch("https://example.invalid");',
      },
    ];
    expect(
      auditProductionImports(
        files,
        ["/app/coachExperience/controller.ts"],
        ["fetch("],
      ),
    ).toEqual([{ path: "/app/shared/helper.ts", token: "fetch(" }]);
  });

  it("is registered only through the sanctioned desktop editor seams, never routes, state, or Tauri", async () => {
    const sanctioned = new Set([
      new URL("../../components/Editor.svelte", COACH_DIR).pathname,
      new URL("../../components/EditorScreen.svelte", COACH_DIR).pathname,
      new URL("../../components/WritingCoachStudy.svelte", COACH_DIR).pathname,
      new URL("../../editor/createEditor.ts", COACH_DIR).pathname,
    ]);
    const files = [
      ...await readSourceFiles(APP_SRC_DIR),
      ...await readSourceFiles(TAURI_DIR),
    ].filter((file) =>
      !file.path.includes("/learning/coach/") &&
      !file.path.includes("/learning/coachExperience/") &&
      !file.path.includes(".test.") &&
      !sanctioned.has(file.path)
    );
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
