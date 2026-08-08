import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const rustHost = await readFile(
  resolve(proofDir, "../../../../../src-tauri/examples/webview2-proof-host.rs"),
  "utf8",
);
const swiftHost = await readFile(
  resolve(proofDir, "WKWebViewProofRunner.swift"),
  "utf8",
);

describe("direct native host origin validation", () => {
  it("parses the Rust host URL instead of trusting a string prefix", () => {
    expect(rustHost).toContain("Url::parse");
    expect(rustHost).toContain('url.scheme() != "http"');
    expect(rustHost).toContain("url.host_str()");
    expect(rustHost).not.toContain('value.starts_with("http://127.0.0.1:")');
  });

  it("requires parsed HTTP loopback components in the Swift host", () => {
    expect(swiftHost).toContain("URLComponents(url: url");
    expect(swiftHost).toContain('components.scheme?.lowercased() == "http"');
    expect(swiftHost).toContain("components.host?.lowercased()");
    expect(swiftHost).toContain('"127.0.0.1", "localhost", "::1"');
  });
});
