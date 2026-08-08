import { describe, expect, it } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import type { PaginationReason } from "./types.ts";
import {
  createPaginationMeasurer,
  type PaginationLayoutAdapter,
} from "./measure.ts";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { promise, resolve };
}

function fakeView(): EditorView {
  return { dom: {} } as unknown as EditorView;
}

function adapterWithReadiness(
  readiness: Promise<void>,
): PaginationLayoutAdapter & {
  reads: number;
  observing: boolean;
  invalidate?: (reason: PaginationReason) => void;
} {
  return {
    reads: 0,
    observing: false,
    async waitUntilReady(_view, signal) {
      await readiness;
      if (signal.aborted) throw signal.reason;
    },
    readLayout() {
      this.reads += 1;
      return {
        fragments: [{
          id: "body-line-1",
          from: 2,
          to: 12,
          section: "body",
          kind: "line",
          height: 24,
          breakBefore: { kind: "line", pos: 2, section: "body" },
          lineGroup: { id: "p:1", index: 0, count: 1 },
        }],
        emptySections: [],
      };
    },
    observe(_view, onInvalidate) {
      this.observing = true;
      this.invalidate = onInvalidate;
      return () => this.observing = false;
    },
    invalidate: undefined as ((reason: PaginationReason) => void) | undefined,
  } as PaginationLayoutAdapter & {
    reads: number;
    observing: boolean;
    invalidate?: (reason: PaginationReason) => void;
  };
}

describe("pagination DOM measurement lifecycle", () => {
  it("discards an epoch superseded while fonts or images are becoming ready", async () => {
    const ready = deferred();
    const adapter = adapterWithReadiness(ready.promise);
    let latestEpoch = 1;
    const measurer = createPaginationMeasurer({
      view: fakeView(),
      adapter,
      onInvalidate: () => {},
    });
    const pending = measurer.read({
      epoch: 1,
      signal: new AbortController().signal,
      latestEpoch: () => latestEpoch,
    });

    latestEpoch = 2;
    ready.resolve();

    await expect(pending).resolves.toEqual({
      status: "stale",
      epoch: 1,
      latestEpoch: 2,
    });
    expect(adapter.reads).toBe(0);
    measurer.destroy();
  });

  it("returns adapter geometry only for the current epoch", async () => {
    const adapter = adapterWithReadiness(Promise.resolve());
    const measurer = createPaginationMeasurer({
      view: fakeView(),
      adapter,
      onInvalidate: () => {},
    });

    const result = await measurer.read({
      epoch: 7,
      signal: new AbortController().signal,
      latestEpoch: () => 7,
    });

    expect(result).toMatchObject({
      status: "measured",
      epoch: 7,
      fragments: [{ id: "body-line-1", height: 24 }],
    });
    measurer.destroy();
  });

  it("disconnects observers and ignores invalidation callbacks after teardown", () => {
    const adapter = adapterWithReadiness(Promise.resolve());
    const invalidations: PaginationReason[] = [];
    const measurer = createPaginationMeasurer({
      view: fakeView(),
      adapter,
      onInvalidate: (reason) => invalidations.push(reason),
    });

    adapter.invalidate?.("asset");
    expect(invalidations).toEqual(["asset"]);
    expect(adapter.observing).toBe(true);

    measurer.destroy();
    adapter.invalidate?.("canonical-layout");
    expect(adapter.observing).toBe(false);
    expect(invalidations).toEqual(["asset"]);
  });
});
