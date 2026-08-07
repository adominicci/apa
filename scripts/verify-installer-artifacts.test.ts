import { describe, expect, it } from "vitest";

const decoder = new TextDecoder();
const scriptPath = decodeURIComponent(
  new URL("./verify-installer-artifacts.ts", import.meta.url).pathname,
);

async function runVerifier(
  artifactPaths: string,
  expectedSuffixes: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env=TAURI_ARTIFACT_PATHS,EXPECTED_INSTALLER_SUFFIXES",
      "--allow-read",
      scriptPath,
    ],
    env: {
      TAURI_ARTIFACT_PATHS: artifactPaths,
      EXPECTED_INSTALLER_SUFFIXES: expectedSuffixes,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({
    prefix: "tesina-installer-artifacts-",
  });

  try {
    await run(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

describe("verify installer artifacts CLI", () => {
  it("rejects a blank tauri-action output", async () => {
    const result = await runVerifier("", '[".dmg"]');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("TAURI_ARTIFACT_PATHS is blank");
  });

  it("rejects malformed tauri-action JSON", async () => {
    const result = await runVerifier("not-json", '[".dmg"]');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "TAURI_ARTIFACT_PATHS must be a JSON array of paths",
    );
  });

  it("rejects a missing expected suffix", async () => {
    await withTemporaryDirectory(async (directory) => {
      const dmg = `${directory}/Tesina.dmg`;
      await Deno.writeTextFile(dmg, "dmg");

      const result = await runVerifier(
        JSON.stringify([dmg]),
        '[".app",".dmg"]',
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('missing artifact ending in ".app"');
    });
  });

  it("rejects a reported installer path that does not exist", async () => {
    await withTemporaryDirectory(async (directory) => {
      const result = await runVerifier(
        JSON.stringify([`${directory}/missing.dmg`]),
        '[".dmg"]',
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("reported artifact does not exist");
    });
  });

  it("requires a macOS app artifact to be a directory", async () => {
    await withTemporaryDirectory(async (directory) => {
      const app = `${directory}/Tesina.app`;
      const dmg = `${directory}/Tesina.dmg`;
      await Deno.writeTextFile(app, "not an app bundle directory");
      await Deno.writeTextFile(dmg, "dmg");

      const result = await runVerifier(
        JSON.stringify([app, dmg]),
        '[".app",".dmg"]',
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(".app artifact must be a directory");
    });
  });

  it("accepts a real macOS app directory and DMG file", async () => {
    await withTemporaryDirectory(async (directory) => {
      const app = `${directory}/Tesina.app`;
      const dmg = `${directory}/Tesina.dmg`;
      await Deno.mkdir(app);
      await Deno.writeTextFile(dmg, "dmg");

      const result = await runVerifier(
        JSON.stringify([app, dmg]),
        '[".app",".dmg"]',
      );

      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Verified 2 installer artifacts");
    });
  });

  it("accepts Windows MSI and NSIS installer files", async () => {
    await withTemporaryDirectory(async (directory) => {
      const msi = `${directory}/Tesina_0.1.0_x64_en-US.msi`;
      const nsis = `${directory}/Tesina_0.1.0_x64-setup.exe`;
      await Deno.writeTextFile(msi, "msi");
      await Deno.writeTextFile(nsis, "nsis");

      const result = await runVerifier(
        JSON.stringify([msi, nsis]),
        '[".msi","-setup.exe"]',
      );

      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
    });
  });

  it("accepts Linux AppImage and Debian installer files", async () => {
    await withTemporaryDirectory(async (directory) => {
      const appImage = `${directory}/Tesina_0.1.0_amd64.AppImage`;
      const deb = `${directory}/Tesina_0.1.0_amd64.deb`;
      await Deno.writeTextFile(appImage, "appimage");
      await Deno.writeTextFile(deb, "deb");

      const result = await runVerifier(
        JSON.stringify([appImage, deb]),
        '[".AppImage",".deb"]',
      );

      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
    });
  });

  it("accepts tauri-action v1 JSON output with non-installer candidates", async () => {
    await withTemporaryDirectory(async (directory) => {
      const app = `${directory}/Tesina.app`;
      const dmg = `${directory}/Tesina_0.1.0_universal.dmg`;
      await Deno.mkdir(app);
      await Deno.writeTextFile(dmg, "dmg");

      const actionOutput = JSON.stringify([
        dmg,
        app,
        `${app}.tar.gz`,
        `${app}.tar.gz.sig`,
      ]);
      const result = await runVerifier(
        actionOutput,
        '[".app",".dmg"]',
      );

      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
    });
  });

  it("rejects duplicate reported paths", async () => {
    await withTemporaryDirectory(async (directory) => {
      const dmg = `${directory}/Tesina.dmg`;
      await Deno.writeTextFile(dmg, "dmg");

      const result = await runVerifier(
        JSON.stringify([dmg, dmg]),
        '[".dmg"]',
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("duplicate reported artifact path");
    });
  });

  it("rejects ambiguous artifacts for one expected suffix", async () => {
    await withTemporaryDirectory(async (directory) => {
      const first = `${directory}/Tesina-arm64.dmg`;
      const second = `${directory}/Tesina-x64.dmg`;
      await Deno.writeTextFile(first, "arm64");
      await Deno.writeTextFile(second, "x64");

      const result = await runVerifier(
        JSON.stringify([first, second]),
        '[".dmg"]',
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        'found 2 artifacts ending in ".dmg"; expected exactly one',
      );
    });
  });
});
