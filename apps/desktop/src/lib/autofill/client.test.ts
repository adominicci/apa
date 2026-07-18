import { describe, expect, it } from "vitest";
import { readCapped } from "./client.ts";

/** Chunked response with no content-length, tracking how many chunks were
 * pulled so the cap's early cancel is observable. */
function chunkedResponse(chunks: string[]): {
  res: Response;
  pulled: () => number;
} {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
  return { res: new Response(stream), pulled: () => i };
}

describe("readCapped", () => {
  it("reads a whole chunked body under the cap (no content-length)", async () => {
    const { res } = chunkedResponse(["<html><head>", "<title>Hola</title>"]);
    expect(await readCapped(res, 1000)).toBe(
      "<html><head><title>Hola</title>",
    );
  });

  it("stops pulling once the byte cap is reached", async () => {
    const chunks = Array.from({ length: 10 }, () => "x".repeat(100));
    const { res, pulled } = chunkedResponse(chunks);
    const text = await readCapped(res, 250);
    expect(text).toBe("x".repeat(300));
    expect(pulled()).toBe(3);
  });

  it("decodes multibyte characters split across chunk boundaries", async () => {
    const bytes = new TextEncoder().encode("año 😀 fin");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 3-byte splits guarantee cuts inside the ñ and emoji sequences.
        for (let i = 0; i < bytes.length; i += 3) {
          controller.enqueue(bytes.slice(i, i + 3));
        }
        controller.close();
      },
    });
    expect(await readCapped(new Response(stream), 1000)).toBe("año 😀 fin");
  });

  it("returns empty for a bodyless response", async () => {
    expect(await readCapped(new Response(null, { status: 204 }), 1000)).toBe(
      "",
    );
  });
});
