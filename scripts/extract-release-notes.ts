import { extractReleaseNotes } from "../apps/desktop/src/lib/update/extractReleaseNotes.ts";

if (import.meta.main) {
  try {
    const [changelogPath, version] = Deno.args;
    if (!changelogPath || !version || Deno.args.length !== 2) {
      throw new Error(
        "Usage: deno run -A scripts/extract-release-notes.ts <changelog> <version>",
      );
    }

    const changelog = await Deno.readTextFile(changelogPath);
    console.log(extractReleaseNotes(changelog, version));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}
