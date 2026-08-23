import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/desktop",
      "apps/desktop/vitest.spelling-ordinary.config.ts",
      "apps/desktop/vitest.spelling-proof.config.ts",
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.ts"],
        },
      },
    ],
  },
});
