import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror SvelteKit's $lib alias for pure-TS tests in this project.
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    name: "desktop",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
