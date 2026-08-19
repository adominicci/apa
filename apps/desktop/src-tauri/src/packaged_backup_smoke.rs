use serde::Serialize;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_fs::FsExt;

const PHASE_ENV: &str = "TESINA_PACKAGED_BACKUP_SMOKE_PHASE";
const PROOF_COMMIT_SHA_ENV: &str = "TESINA_PROOF_COMMIT_SHA";
const TRANSIENT_ENV: &str = "TESINA_PACKAGED_BACKUP_SMOKE_TRANSIENT";

#[derive(Default)]
pub(crate) struct PackagedBackupSmokeState {
    transient_scope_consumed: AtomicBool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackagedBackupSmokeContext {
    phase: String,
    proof_commit_sha: String,
}

fn context_from_values(
    phase: Option<String>,
    proof_commit_sha: Option<String>,
) -> Result<PackagedBackupSmokeContext, String> {
    let phase = phase.ok_or("the packaged backup smoke phase is not configured")?;
    if !matches!(
        phase.as_str(),
        "configure" | "restart" | "reconfigure" | "restore"
    ) {
        return Err("the packaged backup smoke phase is invalid".to_owned());
    }
    let proof_commit_sha =
        proof_commit_sha.ok_or("the packaged backup smoke proof commit is not configured")?;
    if proof_commit_sha.is_empty() {
        return Err("the packaged backup smoke proof commit must not be empty".to_owned());
    }
    Ok(PackagedBackupSmokeContext {
        phase,
        proof_commit_sha,
    })
}

fn seed_transient_scope_with<F>(
    state: &PackagedBackupSmokeState,
    transient: Option<OsString>,
    allow_file: F,
) -> Result<String, String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let transient =
        transient.ok_or("the packaged backup smoke transient file is not configured")?;
    let path = PathBuf::from(transient);
    if !path.is_absolute() {
        return Err(
            "the packaged backup smoke transient file must use an absolute path".to_owned(),
        );
    }
    let exact_path = path
        .to_str()
        .ok_or("the packaged backup smoke transient path is not valid Unicode")?
        .to_owned();
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        format!("cannot inspect the packaged backup smoke transient file: {error}")
    })?;
    if !metadata.file_type().is_file() {
        return Err("the packaged backup smoke transient path must be a regular file".to_owned());
    }
    state
        .transient_scope_consumed
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "the packaged backup smoke transient scope was already consumed".to_owned())?;
    allow_file(&path)?;
    Ok(exact_path)
}

#[tauri::command]
pub(crate) fn packaged_backup_smoke_context() -> Result<PackagedBackupSmokeContext, String> {
    context_from_values(
        std::env::var(PHASE_ENV).ok(),
        std::env::var(PROOF_COMMIT_SHA_ENV).ok(),
    )
}

#[tauri::command]
pub(crate) fn packaged_backup_smoke_seed_transient_scope(
    window: tauri::Window,
    state: tauri::State<'_, PackagedBackupSmokeState>,
) -> Result<String, String> {
    seed_transient_scope_with(&state, std::env::var_os(TRANSIENT_ENV), |path| {
        window
            .fs_scope()
            .allow_file(path)
            .map_err(|error| format!("cannot extend transient file scope: {error}"))
    })
}

#[tauri::command]
pub(crate) fn packaged_backup_smoke_picker_call_count() -> usize {
    crate::backup_directory::packaged_backup_smoke_picker_invocations()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use tempfile::TempDir;

    #[test]
    fn context_requires_an_allowed_phase_and_proof_commit() {
        for phase in ["configure", "restart", "reconfigure", "restore"] {
            let context =
                context_from_values(Some(phase.to_owned()), Some("proof-commit".to_owned()))
                    .expect("an allowed smoke phase must be accepted");
            assert_eq!(context.phase, phase);
            assert_eq!(context.proof_commit_sha, "proof-commit");
            assert_eq!(
                serde_json::to_value(context).unwrap(),
                serde_json::json!({
                    "phase": phase,
                    "proofCommitSha": "proof-commit",
                })
            );
        }

        for (phase, proof_commit_sha) in [
            (None, Some("proof-commit".to_owned())),
            (Some("unknown".to_owned()), Some("proof-commit".to_owned())),
            (Some("configure".to_owned()), None),
            (Some("configure".to_owned()), Some(String::new())),
        ] {
            assert!(context_from_values(phase, proof_commit_sha).is_err());
        }
    }

    #[test]
    fn transient_seed_rejects_missing_relative_and_non_file_paths_before_scope_change() {
        let root = TempDir::new().unwrap();
        let state = PackagedBackupSmokeState::default();
        let allowed = AtomicUsize::new(0);
        let allow = |_: &std::path::Path| {
            allowed.fetch_add(1, Ordering::SeqCst);
            Ok(())
        };

        for value in [
            None,
            Some(OsString::from("relative.txt")),
            Some(root.path().as_os_str().to_owned()),
            Some(root.path().join("missing.txt").into_os_string()),
        ] {
            assert!(seed_transient_scope_with(&state, value, allow).is_err());
        }
        assert_eq!(allowed.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn transient_seed_allows_the_exact_regular_file_once() {
        let root = TempDir::new().unwrap();
        let transient = root.path().join("transient proof.txt");
        fs::write(&transient, b"process-local scope proof").unwrap();
        let state = PackagedBackupSmokeState::default();
        let allowed = Mutex::new(Vec::<PathBuf>::new());

        let seeded =
            seed_transient_scope_with(&state, Some(transient.clone().into_os_string()), |path| {
                allowed.lock().unwrap().push(path.to_owned());
                Ok(())
            })
            .unwrap();

        assert_eq!(seeded, transient.to_str().unwrap());
        assert_eq!(*allowed.lock().unwrap(), vec![transient.clone()]);
        let repeated = seed_transient_scope_with(&state, Some(transient.into_os_string()), |_| {
            panic!("a repeated seed must fail before extending scope")
        })
        .unwrap_err();
        assert!(repeated.contains("already consumed"));
    }
}
