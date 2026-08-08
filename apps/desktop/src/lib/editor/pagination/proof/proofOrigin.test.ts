import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { waitForProofOrigin } from "./proofOrigin.ts";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
  server = undefined;
});

describe("native proof loopback readiness", () => {
  it("waits for an HTTP success condition before returning the origin", async () => {
    let requests = 0;
    server = createServer((_request, response) => {
      requests += 1;
      response.statusCode = requests < 3 ? 503 : 200;
      response.end(requests < 3 ? "starting" : "ready");
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("missing port");
    }
    const url = new URL(`http://127.0.0.1:${address.port}/proof.html`);

    const readiness = await waitForProofOrigin(url, {
      timeoutMs: 2_000,
      retryIntervalMs: 1,
    });

    expect(readiness.url).toBe(url.href);
    expect(readiness.attempts).toBe(3);
  });

  it("fails closed before fetching a non-loopback origin", async () => {
    await expect(
      waitForProofOrigin(new URL("https://example.com/proof.html"), {
        timeoutMs: 100,
        retryIntervalMs: 1,
      }),
    ).rejects.toThrow("loopback");
  });

  it("rejects a credential-form URL whose actual host is remote", async () => {
    await expect(
      waitForProofOrigin(
        new URL("http://localhost:@example.com/proof.html"),
        { timeoutMs: 100, retryIntervalMs: 1 },
      ),
    ).rejects.toThrow("loopback");
  });
});
