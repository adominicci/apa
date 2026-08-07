import { beforeAll, describe, expect, it } from "vitest";

const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
const verifierRoot = `${root}scripts/updater-signature-verifier`;
const manifestPath = `${verifierRoot}/Cargo.toml`;
const binaryPath =
  `${verifierRoot}/target/debug/tesina-updater-signature-verifier`;
const publicKey =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgRTc2MjBGMTg0MkI0RTgxRgpSV1FmNkxSQ0dBOWk1M21sWWVjTzRJelQ1MVRHUHB2V3VjTlNDaDFDQk0wUVRhTG43M1k3R0ZPMw==";
const wrongPublicKey =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDM5RThCNjkzQTQyNzM0MQpSV1JCYzBJNmFZdWVBM0JacStMZTdINUlkUFpsNk5IMUM1R2xVdERRTWJWNk5RTlcvZ04yNEpvOAo=";
const signature =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIG1pbmlzaWduIHNlY3JldCBrZXkKUldRZjZMUkNHQTlpNTlTTE9GeHo2Tnh2QVNYREplUnR1Wnlrd1FlcGJERUd0ODdpZzFCTnBXYVZXdU5ybTczWWlJaUpicTcxV2krZFA5ZUtMOE9DMzUxdndJYXNTU2JYeHdBPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNTU1Nzc5OTY2CWZpbGU6dGVzdApRdEtNWFd5WWN3ZHBaQWxQRjd0RTJFTkprUmQxdWp2S2psajFtOVJ0SFRCblpQYTVXS1U1dVdSczVHb1A1TS9WcUU4MVFGdU1LSTVrL1NmTlFVYU9BQT09";
const decoder = new TextDecoder();

async function runVerifier(options: {
  archive?: string;
  signature?: string;
  publicKey?: string;
} = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const directory = await Deno.makeTempDir({
    prefix: "tesina-updater-signature-",
  });
  const archivePath = `${directory}/Tesina.app.tar.gz`;
  const signaturePath = `${archivePath}.sig`;
  const configPath = `${directory}/tauri.conf.json`;

  try {
    await Deno.writeTextFile(archivePath, options.archive ?? "test");
    await Deno.writeTextFile(signaturePath, options.signature ?? signature);
    await Deno.writeTextFile(
      configPath,
      JSON.stringify({
        plugins: { updater: { pubkey: options.publicKey ?? publicKey } },
      }),
    );

    const output = await new Deno.Command(binaryPath, {
      args: [
        archivePath,
        signaturePath,
        configPath,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

describe("updater signature verifier", () => {
  beforeAll(async () => {
    const output = await new Deno.Command("cargo", {
      args: [
        "build",
        "--quiet",
        "--locked",
        "--manifest-path",
        manifestPath,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!output.success) {
      throw new Error(decoder.decode(output.stderr));
    }
  }, 120_000);

  it("accepts a published Minisign verification vector in Tauri encoding", async () => {
    const result = await runVerifier();

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Updater signature verified");
    expect(result.stderr).toBe("");
  });

  it("rejects a valid but different public key", async () => {
    const result = await runVerifier({ publicKey: wrongPublicKey });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Updater signature verification failed");
  });

  it("rejects tampered archive bytes", async () => {
    const result = await runVerifier({ archive: "test-tampered" });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Updater signature verification failed");
  });

  it("rejects a tampered signature asset", async () => {
    const replacement = signature.endsWith("A") ? "B" : "A";
    const result = await runVerifier({
      signature: `${signature.slice(0, -1)}${replacement}`,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Updater signature verification failed");
  });
});
