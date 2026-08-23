import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    conditions: ["browser"],
    alias: {
      // Mirror SvelteKit's $lib alias for pure-TS tests in this project.
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      "$tesina-editor-addon": fileURLToPath(
        new URL("./src/lib/editor/TestEditorAddon.svelte", import.meta.url),
      ),
      "$tesina-spelling-settings": fileURLToPath(
        new URL(
          "./src/lib/spelling/ProofSpellingSettings.ts",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    name: "desktop",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
