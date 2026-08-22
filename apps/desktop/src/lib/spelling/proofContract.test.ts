import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("native spelling diagnostic reports the fixed proof contract on both hosted platforms", async () => {
  const workflow = await readFile(
    ".github/workflows/spelling-native-diagnostic.yml",
    "utf8",
  );

  expect(workflow).toContain("macos-latest");
  expect(workflow).toContain("windows-latest");
  expect(workflow).toContain("cargo run --locked --example spelling-proof");
  expect(workflow).toContain("spelling-proof-${{ matrix.platform }}.json");
  expect(workflow).toContain(
    "Hosted diagnostics do not replace packaged acceptance targets",
  );
});
