import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "docx-export",
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
