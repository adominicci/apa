import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

declare const Deno: {
  readTextFileSync(path: URL): string;
};

const config = JSON.parse(
  Deno.readTextFileSync(
    new URL("../../../src-tauri/tauri.conf.json", import.meta.url),
  ),
);

function readInterLicense(): string {
  try {
    return Deno.readTextFileSync(
      new URL(
        "../../../src-tauri/resources/Inter-OFL-1.1.txt",
        import.meta.url,
      ),
    );
  } catch {
    return "";
  }
}

describe("Inter font distribution", () => {
  it("bundles the complete upstream license at a stable resource path", () => {
    expect(config.bundle.resources).toEqual({
      "resources/Inter-OFL-1.1.txt": "Inter-OFL-1.1.txt",
    });

    const license = readInterLicense();
    expect(license).toContain(
      "Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)",
    );
    expect(license).toContain(
      "provided that each copy\ncontains the above copyright notice and this license.",
    );
    expect(license).toContain(
      'THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,',
    );
    expect(createHash("sha256").update(license).digest("hex")).toBe(
      "262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a",
    );
  });
});
