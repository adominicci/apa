import { invoke } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";

interface PackagedProofDependencies {
  invoke(command: string): Promise<unknown>;
  exit(code: number): Promise<void>;
}

export async function runPackagedSpellingProof(
  dependencies: PackagedProofDependencies = { invoke, exit },
): Promise<void> {
  try {
    await dependencies.invoke("spelling_packaged_proof");
    await dependencies.exit(0);
  } catch {
    await dependencies.exit(1);
  }
}
