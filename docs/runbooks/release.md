# Release, updater, and signing runbook

This runbook records Tesina's current release contract. It separates ordinary
code verification from installer construction, updater signing, Apple signing
and notarization, and manual publication. `CHANGELOG.md` is the single source
for release notes.

## Authorization boundary

A local implementation or release-readiness task does not authorize a tag,
GitHub release, publication, deployment, branch deletion, or changes to
repository secrets. Those are external writes and require explicit owner
authorization after the exact repository, commit, version, and target have been
verified.

The tag-triggered workflow creates a **draft** release. A green workflow is
evidence that the draft passed its automated contract; it is not authorization
to publish it. Do not print, copy, commit, or include secret values in evidence.

## Version and release-note contract

Before building a release candidate, synchronize the version in:

- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`
- the `tesina` package entry in `apps/desktop/src-tauri/Cargo.lock`
- the current-version statement in `README.md`
- the dated version section and comparison links in `CHANGELOG.md`

Regenerate `Cargo.lock` through Cargo; do not edit unrelated locked
dependencies. Keep `[Unreleased]` available for later work and give the release
section nonempty, user-facing notes.

`scripts/verify-release-version.ts` is the tag gate. Given `vX.Y.Z`, it requires
the exact `X.Y.Z` value in the Tauri config, desktop package, Cargo manifest,
and the single `tesina` Cargo.lock entry. It then extracts the matching
`CHANGELOG.md` section. A missing, empty, duplicated, or mismatched section
fails the release before packaging. Both platform jobs use those exact notes;
the Windows job does not reconstruct them independently.

Run the focused version and release-note tests after any of these surfaces
change:

```bash
deno run -A npm:vitest run \
  scripts/verify-release-version.test.ts \
  scripts/extract-release-notes.test.ts \
  apps/desktop/src/lib/update/bundledReleaseNotes.test.ts \
  apps/desktop/src/lib/update/releaseNotesController.test.ts \
  scripts/release-workflow-contract.test.ts
```

## Verification and packaging boundaries

The workflows prove different things and must not be substituted for one
another.

| Surface                                 | Trigger                             | What it proves                                                                                                                                                                    | What it does not prove                                                                                                |
| --------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`              | Pull requests and pushes to `main`  | Frozen install and dependency audit, formatting, lint, Svelte checks, unit tests, locked Rust formatting/compile/tests, and native pagination proofs                              | Installer construction, signing, notarization, or updater artifacts                                                   |
| `.github/workflows/build-artifacts.yml` | Pushes to `main` or manual dispatch | macOS, Windows, and Linux installers can be built with updater artifacts disabled; expected artifact types exist; the packaged macOS executable launches and remains live briefly | Apple Developer ID signing, notarization, updater signatures, publication, editing, IPC, persistence, or installer UX |
| `.github/workflows/release.yml`         | Push of a `v*` tag                  | Version parity, universal macOS draft artifacts, Windows installers, Apple signing/notarization checks, updater artifacts and signatures, and the final draft/manifest contract   | Manual publication or broad interactive product acceptance                                                            |

The packaged macOS smoke intentionally claims only bundle metadata, executable
launch, and process liveness. Editing, IPC, plugin persistence, backups, import
and export, and installer UX require separate evidence on the named candidate.

A contributor build uses the committed ad-hoc macOS signing identity. It can
provide compile and packaging evidence, but it cannot prove Developer ID
signing, notarization, Gatekeeper acceptance, or updater signature validity.

## Installer-build verification

The main-branch installer workflow disables updater artifact creation and builds
these platform packages:

- universal macOS `.app` and `.dmg`
- Windows `.msi` and NSIS `-setup.exe`
- Linux `.AppImage` and `.deb`

`scripts/verify-installer-artifacts.ts` requires exactly one existing artifact
for each expected suffix, rejects duplicate or missing paths, requires `.app` to
be a directory, and requires installers to be files. This is structural evidence
only. Linux packages are built in CI but are not currently published.

The macOS job additionally runs `scripts/run-packaged-macos-smoke.ts`. The
script records bundle identifier, app version, commit SHA, macOS version, WebKit
version, and bounded liveness, then terminates only the child it started.

## Tag-triggered draft pipeline

After explicit authorization to create the exact release tag, the release
workflow performs the following sequence.

### 1. Version and notes

The workflow checks out the tagged source without persisted Git credentials,
verifies tag/metadata parity, and writes only the matching changelog body to a
temporary notes file. A generated GitHub-output delimiter is rejected if it
appears in the notes.

### 2. macOS signing and notarization

The macOS job builds one universal `arm64` plus `x86_64` app and DMG. The
committed Tauri configuration keeps `bundle.macOS.signingIdentity` set to `-`
for contributor builds. Only the release job creates a temporary keychain,
imports the Developer ID material supplied by repository secrets, verifies the
expected signing identity is present, and passes a temporary signing override to
Tauri.

The release job supplies Apple notarization credentials only to the macOS
release action. It removes the temporary certificate and deletes the temporary
keychain in an `always()` cleanup step.

The job verifies both the built app and the app mounted from the DMG:

- the executable exists and contains exactly `arm64` and `x86_64`;
- `codesign --verify --deep --strict` succeeds;
- the signature authority matches the configured Developer ID identity;
- the notarization ticket passes `xcrun stapler validate`;
- Gatekeeper assessment passes with `spctl`;
- the DMG verifies, mounts read-only, and contains `Tesina.app`.

Only this release-job evidence supports the README claim that the published
macOS app is Developer ID signed and notarized. An ad-hoc local signature does
not.

### 3. Updater artifacts

`tauri.conf.json` enables updater artifacts and embeds the public verification
key plus the published `latest.json` endpoint. The private updater key and its
password exist only as release-job secrets.

The macOS action creates and uploads:

- `Tesina-macos-universal.dmg`
- `Tesina-macos-universal.app.tar.gz`
- `Tesina-macos-universal.app.tar.gz.sig`
- `latest.json`

`scripts/prepare-macos-release-artifacts.ts` requires exactly one app, DMG,
updater archive, and signature, rejects ambiguous or line-breaking paths, and
requires the file artifacts to be nonempty.

The workflow downloads the draft metadata and updater inputs in a token-bearing
step. Later verification receives only local file paths. The locked Rust updater
verifier checks the downloaded archive bytes against the downloaded signature
using the public key in `tauri.conf.json`; matching names or manifest text alone
are not treated as cryptographic proof.

### 4. Windows draft completion

The Windows job depends on the macOS draft and appends `.msi` and NSIS
installers to the same release. Both receive updater signatures, and the NSIS
installer is the preferred in-app updater payload. The installer files remain
unsigned by a Windows code-signing certificate; that user-facing limitation is
documented in `README.md`. Updater Minisign signatures are a separate integrity
control and do not remove the Windows warning.

The job verifies the MSI, NSIS, and their `.sig` artifacts, downloads the final
draft inputs, and runs `scripts/verify-release-draft.ts` in `full` mode. It then
uses the locked updater verifier against both Windows installer bytes.

### 5. Draft contract

`scripts/verify-release-draft.ts` requires:

- a draft, non-prerelease release with tag `vX.Y.Z`;
- release body and `latest.json` notes equal to the extracted changelog notes;
- `latest.json` version equal to `X.Y.Z`;
- the exact expected macOS and Windows asset names, with no extras;
- every expected updater platform key and no unexpected keys;
- each platform URL to target the correct draft asset;
- each manifest signature to match its downloaded signature asset.

The final release stays a draft after all checks pass.

## Evidence record

For a candidate or draft, retain privacy-safe evidence sufficient to identify
what was tested:

- repository commit SHA and exact version/tag;
- workflow name, run ID, job result, and candidate platform;
- artifact names and package digests when computed;
- app bundle version and identifier;
- signing, notarization, Gatekeeper, DMG, draft-contract, and updater-verifier
  outcomes;
- explicit exclusions for scenarios not exercised.

Do not record private keys, passwords, certificate bytes, secret values,
temporary keychain contents, essay content, user names, or private folder names.
A package produced from a different commit or version is not evidence for the
candidate. Any later application, build-configuration, dependency, version, or
bundled-release-note change requires a new package and the affected verification
again.

## Failure and rollback

If any version, build, signing, notarization, Gatekeeper, artifact, updater, or
draft check fails, stop before publication. Keep the release as a draft and fix
forward from a reviewed source change. Deleting a draft or moving/deleting a tag
is a separate external or destructive action and requires explicit owner
authorization.

After a release is published, do not unpublish or delete it: an updater may
already have served it. Roll forward with a higher patch version. If portable
library export, import, or backups are involved, also follow
`docs/runbooks/portable-library-backups-rollback.md` so archive readability,
startup recovery, unfinished journals, and user-owned files are preserved.

Publication is a final manual decision only after the exact draft and its
evidence have been reviewed. A green release workflow never publishes by itself.
