import type { NativeHostMode } from "./nativeHostCommand.ts";

export interface NativeProofPhase {
  page: string;
  profileName: string;
  emitResult: boolean;
  mode: NativeHostMode;
}

const SHARED_PHASES: readonly NativeProofPhase[] = Object.freeze([
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
]);

export function nativeProofPhases(platform: string): NativeProofPhase[] {
  return [
    ...SHARED_PHASES,
    ...(platform === "win32"
      ? [{
        page: "nativeManualProof.html",
        profileName: "native-input",
        emitResult: true,
        mode: "windows-native-input" as const,
      }]
      : []),
  ];
}
