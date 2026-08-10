/** One-shot helper: prints the golden archive digests for archive.test.ts. */
import { buildArchive, sha256Hex } from "../archive.ts";
import { assembleArchiveContent } from "../snapshot.ts";
import {
  emptyLibraryFixture,
  figureHeavyLibraryFixture,
  largeTextLibraryFixture,
} from "./libraries.ts";

const DEPS = { now: () => "2026-01-20T08:30:00.000Z", appVersion: "0.1.1" };
const profiles = [
  ["empty", emptyLibraryFixture()],
  ["large-text", largeTextLibraryFixture()],
  ["figure-heavy", figureHeavyLibraryFixture()],
] as const;
for (const [name, fixture] of profiles) {
  const bytes = await buildArchive(
    assembleArchiveContent({
      essays: fixture.essays,
      library: fixture.library,
      assets: new Map(Object.entries(fixture.assets)),
    }),
    DEPS,
  );
  console.log(name, await sha256Hex(bytes));
}
