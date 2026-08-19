import { describe, expect, it, vi } from "vitest";
import { runPackagedPortableSmoke } from "./packagedPortableSmoke.ts";

describe("packaged portable smoke bootstrap", () => {
  it("exits successfully only after the production export resolves", async () => {
    const calls: string[] = [];
    await runPackagedPortableSmoke({
      exportLibrary: (name) => {
        calls.push(`export:${name}`);
        return Promise.resolve({ path: "/tmp/Library.tesina" });
      },
      exit: (code) => {
        calls.push(`exit:${code}`);
        return Promise.resolve();
      },
      reportError: vi.fn(),
    });

    expect(calls).toEqual(["export:Tesina Library.tesina", "exit:0"]);
  });

  it("exits nonzero when the feature-gated destination is unavailable", async () => {
    const exit = vi.fn(() => Promise.resolve());
    const reportError = vi.fn();

    await runPackagedPortableSmoke({
      exportLibrary: () => Promise.resolve(null),
      exit,
      reportError,
    });

    expect(reportError).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
