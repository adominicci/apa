import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages";
import { describeBackupError } from "./backupErrorMessage.ts";

describe("describeBackupError", () => {
  it("maps the native archive cap to actionable retention guidance", () => {
    expect(describeBackupError({ code: "resource_limit" })).toBe(
      m.bk_retention_help(),
    );
  });
});
