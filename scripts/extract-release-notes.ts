function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractReleaseNotes(
  changelog: string,
  version: string,
): string {
  const heading = new RegExp(
    `^## \\[${escapeRegExp(version)}\\](?: - \\d{4}-\\d{2}-\\d{2})?\\s*$`,
    "gm",
  );
  const matches = [...changelog.matchAll(heading)];

  if (matches.length === 0) {
    throw new Error(`No changelog section found for version "${version}".`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Changelog contains more than one section for version "${version}".`,
    );
  }

  const match = matches[0];
  const bodyStart = (match.index ?? 0) + match[0].length;
  const remainder = changelog.slice(bodyStart);
  const nextSection = /^## /m.exec(remainder);
  const linkDefinitions = /^\[[^\]]+\]:\s+\S+/m.exec(remainder);
  const bodyEnd = Math.min(
    nextSection?.index ?? remainder.length,
    linkDefinitions?.index ?? remainder.length,
  );

  return remainder.slice(0, bodyEnd).trim();
}

if (import.meta.main) {
  const [changelogPath, version] = Deno.args;
  if (!changelogPath || !version || Deno.args.length !== 2) {
    console.error(
      "Usage: deno run -A scripts/extract-release-notes.ts <changelog> <version>",
    );
    Deno.exit(1);
  }

  const changelog = await Deno.readTextFile(changelogPath);
  console.log(extractReleaseNotes(changelog, version));
}
