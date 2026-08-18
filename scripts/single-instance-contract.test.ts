import { describe, expect, it } from "vitest";

const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
const source = await Deno.readTextFile(
  `${root}apps/desktop/src-tauri/src/lib.rs`,
);

describe("single-instance window activation", () => {
  it("shows a hidden main window before focusing it on a second launch", () => {
    expect(source).toMatch(
      /tauri_plugin_single_instance::init\(\|app, _args, _cwd\| \{\s*if let Some\(window\) = app\.get_webview_window\("main"\) \{\s*let _ = window\.show\(\);\s*let _ = window\.set_focus\(\);\s*\}\s*\}\)\)/,
    );
  });
});
