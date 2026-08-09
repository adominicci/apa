import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

describe("native proof runner allocation containment", () => {
  it.each(["runNativeProof.ts", "runNativeManualProof.ts"])(
    "allocates every temporary directory inside the cleanup lifecycle in %s",
    async (file) => {
      const source = await readFile(resolve(proofDir, file), "utf8");
      const lifecycleStart = source.indexOf(
        "await runProofLifecycle(async () => {",
      );
      const allocations = [...source.matchAll(/await mkdtemp/g)].map(
        (match) => match.index,
      );

      expect(lifecycleStart).toBeGreaterThan(-1);
      expect(allocations).toHaveLength(3);
      expect(allocations.every((index) => index > lifecycleStart)).toBe(true);
      expect(source).toContain("proofDirectories.push(");
    },
  );
});
