import { describe, expect, it, vi } from "vitest";
import { runPackagedSpellingProof } from "./packagedProof";

describe("packaged spelling proof bootstrap", () => {
  it("runs the hidden packaged command and exits successfully", async () => {
    const invoke = vi.fn().mockResolvedValue({ status: "pass" });
    const exit = vi.fn().mockResolvedValue(undefined);

    await runPackagedSpellingProof({ invoke, exit });

    expect(invoke).toHaveBeenCalledWith("spelling_packaged_proof");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits unsuccessfully when the packaged command rejects", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("redacted"));
    const exit = vi.fn().mockResolvedValue(undefined);

    await runPackagedSpellingProof({ invoke, exit });

    expect(exit).toHaveBeenCalledWith(1);
  });
});
