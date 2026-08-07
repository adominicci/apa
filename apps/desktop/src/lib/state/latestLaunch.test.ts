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

    const createRequest = launches.run(
      true,
      () => created.promise,
      (launch) => applied.push(launch),
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
  });

  it("lets a creation supersede an earlier pending saved-paper load", async () => {
    const launches = new LatestLaunch();
    const saved = deferred<TestEssay | null>();
    const created = deferred<TestEssay>();
    const applied: LaunchValue<TestEssay>[] = [];

    const savedRequest = launches.run(
      false,
      () => saved.promise,
      (launch) => applied.push(launch),
    );
    const createRequest = launches.run(
      true,
      () => created.promise,
      (launch) => applied.push(launch),
    );

    created.resolve({ id: "created" });
    await createRequest;
    saved.resolve({ id: "saved" });
    await savedRequest;

    expect(applied).toEqual([{
      value: { id: "created" },
      newlyCreated: true,
    }]);
  });

  it("invalidates pending work when navigation leaves the launch surface", async () => {
    const launches = new LatestLaunch();
    const pending = deferred<TestEssay>();
    const apply = vi.fn();
    const request = launches.run(true, () => pending.promise, apply);

    launches.invalidate();
    pending.resolve({ id: "stale" });
    await request;

    expect(apply).not.toHaveBeenCalled();
  });
});
