import { describe, expect, it } from "vitest";

const capability = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../apps/desktop/src-tauri/capabilities/default.json",
      import.meta.url,
    ),
  ),
) as { permissions: unknown[] };

const granted = new Set(
  capability.permissions.filter((entry): entry is string =>
    typeof entry === "string"
  ),
);

describe("main window capability", () => {
  // A denied command rejects at the IPC boundary, so the UI simply does
  // nothing and the only report is a console error that a packaged build has
  // nowhere to show. Both of these shipped missing once, which made the close
  // button dead on every platform.
  it.each([
    ["process:allow-exit", "the Quit entry and the non-macOS close button"],
    ["core:window:allow-hide", "the macOS close button"],
  ])("grants %s, which backs %s", (permission) => {
    expect(granted).toContain(permission);
  });

  it("keeps the relaunch permission the updater installs with", () => {
    expect(granted).toContain("process:allow-restart");
  });
});
