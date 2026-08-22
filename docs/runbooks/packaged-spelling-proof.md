# Packaged spelling proof

This maintainer-only build runs fixed English and Spanish misspellings through
the packaged Tauri application's native spelling state. It has no visible
editor integration and creates no updater or release artifact.

## Build the installers

Dispatch the existing artifact workflow from the LT-01 branch:

```sh
gh workflow run build-artifacts.yml \
  --ref features/add-bilingual-spelling-service \
  -f packagedSpellingProof=true
```

After both jobs pass, download these workflow artifacts:

- `tesina-spelling-proof-macos-universal`
- `tesina-spelling-proof-windows-x64`

Record the workflow run, job, artifact, and head SHA with every manual report.
These artifacts are proof installers, not releases.

## Run on macOS

Mount the DMG and copy `Tesina Spelling Proof.app` to `/Applications`. Choose a
new report filename because the proof refuses to replace existing evidence.

```sh
PROOF_OUT="$PWD/lt-01-macos12-intel.json"
TESINA_PACKAGED_SPELLING_PROOF_OUTPUT="$PROOF_OUT" \
  "/Applications/Tesina Spelling Proof.app/Contents/MacOS/tesina"
cat "$PROOF_OUT"
```

The process exits after writing the report. The JSON must record the expected
macOS version and architecture, both language entries, and either `pass` or an
exact capability `block`.

## Run on Windows

Open PowerShell in the downloaded artifact directory. The commands install the
proof build into a dedicated current-user directory and create one report.

```powershell
$install = Join-Path $env:LOCALAPPDATA "TesinaSpellingProofManual"
$installers = @(Get-ChildItem -File "*-setup.exe")
if ($installers.Count -ne 1) { throw "Expected exactly one proof installer" }

Start-Process $installers[0].FullName `
  -ArgumentList "/S", "/NS", "/D=$install" `
  -Wait

$out = Join-Path $PWD "lt-01-windows11-bilingual.json"
$env:TESINA_PACKAGED_SPELLING_PROOF_OUTPUT = $out
& "$install\tesina.exe"
Get-Content $out
```

Use distinct filenames for Windows 10 x64, Windows 11 x64, and the separate
missing-Spanish-dictionary case. The bilingual acceptance runs require both
English and Spanish system language features. The missing-dictionary run must
retain the structured `install-system-dictionary` block.

Building an installer or collecting a report does not complete OpenSpec task
7.2 or 7.3. Check a task only after its named machine and dictionary state have
produced and recorded the required report.
