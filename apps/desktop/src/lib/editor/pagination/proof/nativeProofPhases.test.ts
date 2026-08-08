import { describe, expect, it } from "vitest";
import { nativeProofPhases } from "./nativeProofPhases.ts";

describe("native proof phase selection", () => {
  it("runs the Windows input proof after the shared checks in one lifecycle", () => {
    expect(nativeProofPhases("win32")).toEqual([
      {
        page: "nativeHarnessSelfTest.html",
        profileName: "self-test",
        emitResult: false,
        mode: "standard",
      },
      {
        page: "nativeProof.html",
        profileName: "proof",
        emitResult: true,
        mode: "standard",
      },
      {
        page: "nativeManualProof.html",
        profileName: "native-input",
        emitResult: true,
        mode: "windows-native-input",
      },
    ]);
  });

  it("leaves the existing macOS automated path unchanged", () => {
    expect(nativeProofPhases("darwin").map((phase) => phase.page)).toEqual([
      "nativeHarnessSelfTest.html",
      "nativeProof.html",
    ]);
  });
});
