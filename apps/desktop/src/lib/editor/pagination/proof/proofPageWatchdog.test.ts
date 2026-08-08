import { afterEach, describe, expect, it, vi } from "vitest";
import { startProofPageWatchdog } from "./proofPageWatchdog.ts";

afterEach(() => vi.useRealTimers());

describe("native proof page watchdog", () => {
  it("settles once at its deadline and can be cancelled after a result", () => {
    vi.useFakeTimers();
    const failures: string[] = [];
    const timedOut = startProofPageWatchdog(45_000, () => {
      failures.push("deadline");
    });

    vi.advanceTimersByTime(45_000);
    vi.advanceTimersByTime(45_000);
    expect(failures).toEqual(["deadline"]);

    const completed = startProofPageWatchdog(45_000, () => {
      failures.push("late");
    });
    completed.cancel();
    vi.advanceTimersByTime(45_000);
    expect(failures).toEqual(["deadline"]);
    timedOut.cancel();
  });
});
