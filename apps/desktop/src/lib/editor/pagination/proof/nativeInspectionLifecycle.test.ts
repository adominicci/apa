import { describe, expect, it, vi } from "vitest";
import { settleStableInspectionEditor } from "./nativeInspectionLifecycle.ts";

describe("stable native-proof inspection lifecycle", () => {
  it.each([
    {
      name: "default route",
      requested: false,
      localPassed: true,
      accepted: true,
    },
    {
      name: "failed proof",
      requested: true,
      localPassed: false,
      accepted: true,
    },
    {
      name: "watchdog already won",
      requested: true,
      localPassed: true,
      accepted: false,
    },
  ])(
    "destroys the editor for $name",
    ({ requested, localPassed, accepted }) => {
      const destroy = vi.fn();
      const markReady = vi.fn();

      expect(settleStableInspectionEditor({
        requested,
        localPassed,
        resultAccepted: accepted,
        destroy,
        markReady,
      })).toBe(false);
      expect(destroy).toHaveBeenCalledOnce();
      expect(markReady).not.toHaveBeenCalled();
    },
  );

  it("preserves and marks ready only when the requested passing result wins", () => {
    const destroy = vi.fn();
    const markReady = vi.fn();

    expect(settleStableInspectionEditor({
      requested: true,
      localPassed: true,
      resultAccepted: true,
      destroy,
      markReady,
    })).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
    expect(markReady).toHaveBeenCalledOnce();
  });
});
