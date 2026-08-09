import desktopPackage from "../../../package.json" with { type: "json" };
import changelog from "../../../../../CHANGELOG.md?raw";
import { extractReleaseNotes } from "./extractReleaseNotes.ts";

export interface BundledReleaseNotes {
  readonly version: string;
  readonly body: string;
}

export function createBundledReleaseNotes(
  packageVersion: string,
  changelogSource: string,
): BundledReleaseNotes {
  if (packageVersion === "" || packageVersion.trim() !== packageVersion) {
    throw new Error(
      "Desktop package version must be a non-empty trimmed string.",
    );
  }

  return Object.freeze({
    version: packageVersion,
    body: extractReleaseNotes(changelogSource, packageVersion),
  });
}

export const bundledReleaseNotes = createBundledReleaseNotes(
  desktopPackage.version,
  changelog,
);
