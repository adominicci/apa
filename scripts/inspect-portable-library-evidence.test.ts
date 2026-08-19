import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { buildArchive } from "../apps/desktop/src/lib/portable/archive.ts";
import { fullLibraryFixture } from "../apps/desktop/src/lib/portable/fixtures/libraries.ts";
import { ARCHIVE_LIMITS } from "../apps/desktop/src/lib/portable/limits.ts";
import { assembleArchiveContent } from "../apps/desktop/src/lib/portable/snapshot.ts";
import {
  inspectPortableLibraryEvidence,
  readEvidenceFileBounded,
} from "./inspect-portable-library-evidence.ts";

const FIXED_TIME = "2026-08-18T12:00:00.000Z";
const decoder = new TextDecoder();
const scriptPath = fileURLToPath(
  new URL("./inspect-portable-library-evidence.ts", import.meta.url),
);

async function fullLibraryArchive(
  appVersion = "0.1.17",
): Promise<Uint8Array> {
  const fixture = fullLibraryFixture();
  return await buildArchive(
    assembleArchiveContent({
      essays: fixture.essays,
      library: fixture.library,
      assets: new Map(Object.entries(fixture.assets)),
    }),
    {
      appVersion,
      now: () => FIXED_TIME,
    },
  );
}

async function runInspector(archivePath: string): Promise<Deno.CommandOutput> {
  const canonicalPath = await Deno.realPath(archivePath);
  return await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--quiet",
      `--allow-read=${canonicalPath}`,
      scriptPath,
      canonicalPath,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
}

describe("portable-library evidence inspector", () => {
  it("reports deterministic redacted metrics after full semantic validation", async () => {
    const archive = await fullLibraryArchive();
    const evidence = await inspectPortableLibraryEvidence(
      archive,
      ARCHIVE_LIMITS,
    );
    expect(
      await inspectPortableLibraryEvidence(archive, ARCHIVE_LIMITS),
    ).toEqual(evidence);

    expect(evidence).toEqual({
      valid: true,
      archive: {
        byteLength: 32_099,
        sha256:
          "94ed82e76ec70b739c9869621a32d78bb6546c43c353109a92c523ef943531ac",
      },
      manifest: {
        kind: "tesina-library",
        formatVersion: 1,
        appVersion: "0.1.17",
        counts: {
          essays: 16,
          references: 30,
          collections: 1,
          assets: 38,
        },
        verifiedPayloadFiles: 55,
        payloadAggregateSha256:
          "c89eda74b688712cf5033b37ca274f297bff225c119855cc09e43a0a8ae2ff97",
      },
      relationships: {
        citationNodes: 54,
        citationItems: 63,
        figures: 38,
      },
      assets: {
        byteLength: 95_818,
        aggregateSha256:
          "54e5c06f621dcce65778ca15595505259f09220a92a1a91e74b39f8e94583e71",
        formats: { bmp: 9, gif: 9, jpg: 9, png: 11 },
      },
    });

    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("Ensayo sintético");
    expect(serialized).not.toContain("Estudiante Ejemplo");
    expect(serialized).not.toContain("00000000-0000-4000");
    expect(serialized).not.toContain("assets/");
  });

  it("prints only redacted JSON from the command line", async () => {
    const directory = await Deno.makeTempDir({
      prefix: "tesina-private-evidence-",
    });
    const archivePath = `${directory}/private-title.tesina`;
    try {
      await Deno.writeFile(archivePath, await fullLibraryArchive());
      const output = await runInspector(archivePath);
      const stdout = decoder.decode(output.stdout);

      expect(output.code).toBe(0);
      expect(decoder.decode(output.stderr)).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        valid: true,
        manifest: { appVersion: "0.1.17" },
      });
      expect(stdout).not.toContain("private-title");
      expect(stdout).not.toContain(directory);
      expect(stdout).not.toContain("Ensayo sintético");
      expect(stdout).not.toContain("00000000-0000-4000");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("redacts invalid-archive failures", async () => {
    const directory = await Deno.makeTempDir({
      prefix: "tesina-private-invalid-",
    });
    const archivePath = `${directory}/secret-essay-title.tesina`;
    try {
      await Deno.writeTextFile(archivePath, "private document contents");
      const output = await runInspector(archivePath);
      const stdout = decoder.decode(output.stdout);

      expect(output.code).toBe(1);
      expect(decoder.decode(output.stderr)).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        valid: false,
        error: { code: expect.any(String) },
      });
      expect(stdout).not.toContain("secret-essay-title");
      expect(stdout).not.toContain("private document contents");
      expect(stdout).not.toContain(directory);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("rejects private text smuggled through the manifest version", async () => {
    const directory = await Deno.makeTempDir({
      prefix: "tesina-private-version-",
    });
    const archivePath = `${directory}/archive.tesina`;
    const privateVersion = "Private User Name";
    try {
      await Deno.writeFile(
        archivePath,
        await fullLibraryArchive(privateVersion),
      );
      const output = await runInspector(archivePath);
      const stdout = decoder.decode(output.stdout);

      expect(output.code).toBe(1);
      expect(JSON.parse(stdout)).toEqual({
        valid: false,
        error: { code: "evidence/app-version" },
      });
      expect(stdout).not.toContain(privateVersion);
      expect(decoder.decode(output.stderr)).toBe("");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("stops a file that grows after its opened-handle size check", async () => {
    const reads: Array<Uint8Array | null> = [
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
      null,
    ];
    let closed = false;

    await expect(
      readEvidenceFileBounded("ignored", 3, () =>
        Promise.resolve({
          stat: () => Promise.resolve({ isFile: true, size: 2 }),
          read: (buffer) => {
            const next = reads.shift() ?? null;
            if (next === null) return Promise.resolve(null);
            buffer.set(next);
            return Promise.resolve(next.byteLength);
          },
          close: () => {
            closed = true;
          },
        })),
    ).rejects.toMatchObject({ code: "archive/intake-limit" });
    expect(closed).toBe(true);
  });
});
