import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  define: { __TESINA_SPELLING_PROOF_TEST__: "false" },
  resolve: {
    conditions: ["browser"],
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      "$tesina-editor-addon": fileURLToPath(
        new URL("./src/lib/editor/NoopEditorAddon.svelte", import.meta.url),
      ),
      "$tesina-spelling-settings": fileURLToPath(
        new URL("./src/lib/editor/NoopSpellingSettings.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "desktop-spelling-ordinary",
    include: [
      "src/lib/spelling/ordinary/**/*.test.ts",
      "src/lib/spelling/integration/**/*.test.ts",
    ],
    environment: "node",
  },
});
