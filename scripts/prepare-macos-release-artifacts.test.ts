import { describe, expect, it } from "vitest";

import { prepareMacosReleaseArtifacts } from "./prepare-macos-release-artifacts.ts";

async function withArtifacts(
  run: (paths: {
    app: string;
    dmg: string;
    archive: string;
    signature: string;
    output: string;
  }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "tesina-macos-release-" });
  const paths = {
    app: `${directory}/Tesina.app`,
    dmg: `${directory}/Tesina_0.1.0_universal.dmg`,
    archive: `${directory}/Tesina.app.tar.gz`,
    signature: `${directory}/Tesina.app.tar.gz.sig`,
    output: `${directory}/github-output.txt`,
  };

  try {
    await Deno.mkdir(paths.app);
    await Deno.writeTextFile(paths.dmg, "dmg bytes");
    await Deno.writeTextFile(paths.archive, "archive bytes");
    await Deno.writeTextFile(paths.signature, "signature bytes");
    await run(paths);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

describe("prepareMacosReleaseArtifacts", () => {
  it("emits the exact validated paths as GitHub step outputs", async () => {
    await withArtifacts(async (paths) => {
      const result = await prepareMacosReleaseArtifacts(
        JSON.stringify([
          paths.dmg,
          paths.app,
          paths.archive,
          paths.signature,
        ]),
        paths.output,
      );

      expect(result).toEqual({
        app: paths.app,
        dmg: paths.dmg,
        archive: paths.archive,
        signature: paths.signature,
      });
      expect(await Deno.readTextFile(paths.output)).toBe(
        `app=${paths.app}\ndmg=${paths.dmg}\narchive=${paths.archive}\nsignature=${paths.signature}\n`,
      );
    });
  });

  it("rejects an empty DMG, updater archive, or signature", async () => {
    await withArtifacts(async (paths) => {
      await Deno.writeTextFile(paths.archive, "");

      await expect(
        prepareMacosReleaseArtifacts(
          JSON.stringify([
            paths.app,
            paths.dmg,
            paths.archive,
            paths.signature,
          ]),
          paths.output,
        ),
      ).rejects.toThrow("artifact must be nonempty");
    });
  });

  it("rejects paths that could inject another GitHub output", async () => {
    await withArtifacts(async (paths) => {
      const injectedDmg = `${paths.dmg}\nforged=value`;
      await Deno.rename(paths.dmg, injectedDmg);

      await expect(
        prepareMacosReleaseArtifacts(
          JSON.stringify([
            paths.app,
            injectedDmg,
            paths.archive,
            paths.signature,
          ]),
          paths.output,
        ),
      ).rejects.toThrow("artifact path contains a line break");
    });
  });
});
