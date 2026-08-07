function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTerminalLinkDefinitions(section: string): string {
  const lineBreak = section.includes("\r\n") ? "\r\n" : "\n";
  const lines = section.trim().split(/\r?\n/);
  let cursor = lines.length;

  while (cursor > 0 && lines[cursor - 1].trim() === "") cursor -= 1;

  let foundDefinition = false;
  while (cursor > 0) {
    const line = lines[cursor - 1];
    if (/^\[[^\]]+\]:[ \t]+\S.*$/.test(line)) {
      foundDefinition = true;
      cursor -= 1;
      continue;
    }
    if (foundDefinition && line.trim() === "") {
      cursor -= 1;
      continue;
    }
    break;
  }

  return (foundDefinition ? lines.slice(0, cursor).join(lineBreak) : section)
    .trim();
}

export function extractReleaseNotes(
  changelog: string,
  version: string,
): string {
  const heading = new RegExp(
    `^## \\[${
      escapeRegExp(version)
    }\\](?: - \\d{4}-\\d{2}-\\d{2})?[ \\t]*\\r?$`,
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
  const bodyEnd = nextSection?.index ?? remainder.length;
  const notes = stripTerminalLinkDefinitions(remainder.slice(0, bodyEnd));

  if (notes === "") {
    throw new Error(`Changelog section for version "${version}" is empty.`);
  }

  return notes;
}

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
