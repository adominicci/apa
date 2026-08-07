import { describe, expect, it, vi } from "vitest";
import { LatestLaunch, type LaunchValue } from "./latestLaunch.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

interface TestEssay {
  id: string;
}

describe("LatestLaunch", () => {
  it("lets a saved-paper click supersede an earlier pending creation", async () => {
    const launches = new LatestLaunch();
    const created = deferred<TestEssay>();
    const saved = deferred<TestEssay | null>();
    const applied: LaunchValue<TestEssay>[] = [];
    const discarded: TestEssay[] = [];

    const createRequest = launches.run(
      true,
      () => created.promise,
      (launch) => applied.push(launch),
      (essay) => {
        discarded.push(essay);
      },
    );
    const savedRequest = launches.run(
      false,
      () => saved.promise,
      (launch) => applied.push(launch),
    );

    saved.resolve({ id: "saved" });
    await savedRequest;
    created.resolve({ id: "created" });
    await createRequest;

    expect(applied).toEqual([{
      value: { id: "saved" },
      newlyCreated: false,
    }]);
    expect(discarded).toEqual([{ id: "created" }]);
  });

  it("lets a creation supersede an earlier pending saved-paper load", async () => {
    const launches = new LatestLaunch();
    const saved = deferred<TestEssay | null>();
    const created = deferred<TestEssay>();
    const applied: LaunchValue<TestEssay>[] = [];
    const discarded: TestEssay[] = [];

    const savedRequest = launches.run(
      false,
      () => saved.promise,
      (launch) => applied.push(launch),
    );
    const createRequest = launches.run(
      true,
      () => created.promise,
      (launch) => applied.push(launch),
      (essay) => {
        discarded.push(essay);
      },
    );

    created.resolve({ id: "created" });
    await createRequest;
    saved.resolve({ id: "saved" });
    await savedRequest;

    expect(applied).toEqual([{
      value: { id: "created" },
      newlyCreated: true,
    }]);
    expect(discarded).toEqual([]);
  });

  it("invalidates pending work when navigation leaves the launch surface", async () => {
    const launches = new LatestLaunch();
    const pending = deferred<TestEssay>();
    const apply = vi.fn();
    const discarded: TestEssay[] = [];
    const request = launches.run(
      true,
      () => pending.promise,
      apply,
      (essay) => {
        discarded.push(essay);
      },
    );

    launches.invalidate();
    pending.resolve({ id: "stale" });
    await request;

    expect(apply).not.toHaveBeenCalled();
    expect(discarded).toEqual([{ id: "stale" }]);
  });

  it("discards every superseded creation while applying the latest one", async () => {
    const launches = new LatestLaunch();
    const first = deferred<TestEssay>();
    const second = deferred<TestEssay>();
    const latest = deferred<TestEssay>();
    const applied: LaunchValue<TestEssay>[] = [];
    const discarded: string[] = [];
    const discard = (essay: TestEssay) => {
      discarded.push(essay.id);
    };

    const firstRequest = launches.run(
      true,
      () => first.promise,
      (launch) => applied.push(launch),
      discard,
    );
    const secondRequest = launches.run(
      true,
      () => second.promise,
      (launch) => applied.push(launch),
      discard,
    );
    const latestRequest = launches.run(
      true,
      () => latest.promise,
      (launch) => applied.push(launch),
      discard,
    );

    latest.resolve({ id: "latest" });
    await latestRequest;
    first.resolve({ id: "first" });
    second.resolve({ id: "second" });
    await Promise.all([firstRequest, secondRequest]);

    expect(applied).toEqual([{
      value: { id: "latest" },
      newlyCreated: true,
    }]);
    expect(discarded).toEqual(["first", "second"]);
  });

  it("surfaces a superseded-result cleanup failure", async () => {
    const launches = new LatestLaunch();
    const cleanupError = new Error("cleanup failed");
    const request = launches.run(
      true,
      () => Promise.resolve({ id: "created" }),
      vi.fn(),
      () => Promise.reject(cleanupError),
    );

    launches.invalidate();

    await expect(request).rejects.toBe(cleanupError);
  });
});
