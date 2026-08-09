import { describe, expect, it, vi } from "vitest";
import { runStartupSafetyPhase } from "./startup.ts";

describe("runStartupSafetyPhase", () => {
  it("loads saved UI settings before startup recovery can block", async () => {
    const order: string[] = [];
    const loadUiSettings = vi.fn(() => {
      order.push("locale");
      return Promise.resolve();
    });
    const runRecovery = vi.fn(() => {
      order.push("recovery");
      return Promise.resolve();
    });

    await runStartupSafetyPhase({ loadUiSettings, runRecovery });

    expect(order).toEqual(["locale", "recovery"]);
  });
});
