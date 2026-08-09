import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface CargoMetadata {
  packages: Array<{
    name: string;
    dependencies: Array<{
      name: string;
      kind: string | null;
      req: string;
    }>;
    targets: Array<{
      name: string;
      kind: string[];
      crate_types: string[];
    }>;
  }>;
}

const proofDir = dirname(fileURLToPath(import.meta.url));
const tauriDir = resolve(proofDir, "../../../../../src-tauri");

function cargoMetadata(): CargoMetadata {
  return JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--locked", "--format-version=1", "--no-deps"],
      { cwd: tauriDir, encoding: "utf8" },
    ),
  ) as CargoMetadata;
}

describe("Windows native pagination host containment", () => {
  it("builds only as a test example from the already-locked Tao/Wry backend", () => {
    const metadata = cargoMetadata();
    const tesina = metadata.packages.find((entry) => entry.name === "tesina");
    expect(tesina).toBeDefined();

    const target = tesina?.targets.find((entry) =>
      entry.name === "webview2-proof-host"
    );
    expect(target).toMatchObject({ kind: ["example"], crate_types: ["bin"] });
    expect(tesina?.targets.filter((entry) => entry.kind.includes("bin")))
      .toEqual(
        [expect.objectContaining({ name: "tesina" })],
      );

    expect(tesina?.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "tao", kind: "dev", req: "=0.35.3" }),
      expect.objectContaining({ name: "url", kind: "dev", req: "=2.5.8" }),
      expect.objectContaining({ name: "wry", kind: "dev", req: "=0.55.1" }),
    ]));
  });
});
