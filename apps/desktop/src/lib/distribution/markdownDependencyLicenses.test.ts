import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

declare const Deno: {
  readTextFileSync(path: string | URL): string;
};

interface PackageMetadata {
  dependencies?: Record<string, string>;
  license?: string;
  optionalDependencies?: Record<string, string>;
}

function readJson(path: string | URL): PackageMetadata {
  return JSON.parse(Deno.readTextFileSync(path)) as PackageMetadata;
}

const desktopPackage = readJson(
  new URL("../../../package.json", import.meta.url),
);
const require = createRequire(import.meta.url);

describe("release-note Markdown dependency licenses", () => {
  it("pins the two audited runtime packages exactly", () => {
    expect(desktopPackage.dependencies?.marked).toBe("18.0.9");
    expect(desktopPackage.dependencies?.dompurify).toBe("3.4.13");
  });

  it("keeps Marked on its audited dependency-free MIT path", () => {
    const metadata = readJson(
      new URL(
        "../../../../../node_modules/marked/package.json",
        import.meta.url,
      ),
    );
    const license = Deno.readTextFileSync(
      new URL("../../../../../node_modules/marked/LICENSE", import.meta.url),
    );

    expect(metadata.license).toBe("MIT");
    expect(metadata.dependencies ?? {}).toEqual({});
    expect(metadata.optionalDependencies ?? {}).toEqual({});
    expect(license).toContain("Permission is hereby granted, free of charge");
  });

  it("selects DOMPurify's audited dependency-free Apache-2.0 path", () => {
    const metadata = readJson(
      new URL(
        "../../../../../node_modules/dompurify/package.json",
        import.meta.url,
      ),
    );
    const license = Deno.readTextFileSync(
      new URL("../../../../../node_modules/dompurify/LICENSE", import.meta.url),
    );

    expect(metadata.license).toBe("(MPL-2.0 OR Apache-2.0)");
    expect(metadata.dependencies ?? {}).toEqual({});
    expect(metadata.optionalDependencies).toEqual({
      "@types/trusted-types": "^2.0.7",
    });
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");

    const domPurifyEntry = require.resolve("dompurify");
    const declarationPackage = createRequire(pathToFileURL(domPurifyEntry))
      .resolve("@types/trusted-types/package.json");
    const declarationMetadata = readJson(declarationPackage);
    expect(declarationMetadata.license).toBe("MIT");
    expect(declarationMetadata.dependencies ?? {}).toEqual({});
  });
});
