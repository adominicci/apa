//! Rust-owned backup-directory adapter (OpenSpec `add-portable-library-backups`,
//! design decisions 8 and 10).
//!
//! Rust exclusively owns two atomic app-data JSON records:
//!
//! - `backup-directory.json` — the single selected-folder authorization. Its
//!   presence means backup is configured; there is no `enabled` flag. Turn off
//!   deletes the record and leaves archive bytes untouched.
//! - `backup-ledger.json` — the successful-write ledger keyed by
//!   `backupSetId`, used for ledger-first retention classification.
//!
//! The module is split into a plain testable core (`BackupDirectoryCore`, no
//! Tauri types) plus thin `#[tauri::command]` wrappers so unit tests can run
//! against temp directories without a Tauri runtime.

use same_file::Handle as FileIdentity;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const BACKUP_SUBFOLDER_NAME: &str = "Tesina Backups";
const DIRECTORY_FILE_NAME: &str = "backup-directory.json";
const LEDGER_FILE_NAME: &str = "backup-ledger.json";
const ARCHIVE_EXTENSION: &str = ".tesina";
const MAX_FILE_NAME_LENGTH: usize = 120;
const SELECTED_FOLDER_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Stable, serializable error codes for the TypeScript side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupErrorCode {
    NotConfigured,
    PendingMissing,
    FolderUnavailable,
    InsideAppData,
    SymlinkRejected,
    InvalidFileName,
    NameTaken,
    HashMismatch,
    FileTooLarge,
    Timeout,
    Io,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupError {
    pub code: BackupErrorCode,
    pub detail: String,
}

impl BackupError {
    fn new(code: BackupErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    fn io(context: &str, error: &std::io::Error) -> Self {
        Self::new(BackupErrorCode::Io, format!("{context}: {error}"))
    }
}

impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.detail)
    }
}

impl std::error::Error for BackupError {}

// ---------------------------------------------------------------------------
// Persisted records
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupDirectoryConfig {
    schema_version: u32,
    canonical_folder_path: String,
    backup_set_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub file_name: String,
    pub sha256: String,
    pub created_at: String,
    pub backup_set_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ledger {
    schema_version: u32,
    entries: Vec<LedgerEntry>,
}

impl Ledger {
    fn empty() -> Self {
        Self {
            schema_version: 1,
            entries: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Command payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingConfiguration {
    pub canonical_folder_path: String,
    pub backup_subfolder_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveConfiguration {
    pub canonical_folder_path: String,
    pub backup_set_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_set_id: Option<String>,
    pub folder_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListing {
    pub file_name: String,
    pub byte_length: u64,
}

// ---------------------------------------------------------------------------
// Core state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct ActiveState {
    canonical_folder_path: PathBuf,
    backup_set_id: String,
}

#[derive(Debug)]
struct PendingState {
    canonical_folder_path: PathBuf,
    /// (file name, sha256) of every test archive written this pending session.
    test_archives: Vec<(String, String)>,
}

#[derive(Debug, Default)]
struct Inner {
    active: Option<ActiveState>,
    pending: Option<PendingState>,
}

/// Plain core with no Tauri types; managed as Tauri state by `lib.rs`.
#[derive(Clone)]
pub struct BackupDirectoryCore {
    app_data_dir: PathBuf,
    state: Arc<Mutex<Inner>>,
    configuration_epoch: Arc<AtomicU64>,
}

impl BackupDirectoryCore {
    /// Loads and validates `backup-directory.json`. Invalid or missing means
    /// unconfigured. A record whose folder no longer canonicalizes still loads
    /// as configured; operations report `folder_unavailable` so the UI can
    /// offer Retry / Choose another folder.
    pub fn new(app_data_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&app_data_dir);
        let active = load_directory_config(&app_data_dir).map(|config| ActiveState {
            canonical_folder_path: PathBuf::from(config.canonical_folder_path),
            backup_set_id: config.backup_set_id,
        });
        Self {
            app_data_dir,
            state: Arc::new(Mutex::new(Inner {
                active,
                pending: None,
            })),
            configuration_epoch: Arc::new(AtomicU64::new(0)),
        }
    }

    fn configuration_epoch(&self) -> u64 {
        self.configuration_epoch.load(Ordering::SeqCst)
    }

    fn invalidate_configuration_epoch(&self, expected: u64) -> bool {
        self.configuration_epoch
            .compare_exchange(
                expected,
                expected.wrapping_add(2),
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    fn invalidate_current_configuration_epoch(&self) {
        let mut current = self.configuration_epoch();
        loop {
            let next = if current % 2 == 0 {
                current.wrapping_add(2)
            } else {
                current.wrapping_add(1)
            };
            match self.configuration_epoch.compare_exchange(
                current,
                next,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => return,
                Err(actual) => current = actual,
            }
        }
    }

    fn start_configuration_operation(&self) -> u64 {
        self.invalidate_current_configuration_epoch();
        self.configuration_epoch()
    }

    fn require_configuration_epoch(&self, expected: u64) -> Result<(), BackupError> {
        if self.configuration_epoch() != expected {
            return Err(BackupError::new(
                BackupErrorCode::Timeout,
                "the folder configuration operation expired",
            ));
        }
        Ok(())
    }

    fn claim_configuration_commit(&self, expected: u64) -> Result<(), BackupError> {
        if expected % 2 != 0
            || self
                .configuration_epoch
                .compare_exchange(
                    expected,
                    expected.wrapping_add(1),
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                )
                .is_err()
        {
            return Err(BackupError::new(
                BackupErrorCode::Timeout,
                "the folder configuration operation expired",
            ));
        }
        Ok(())
    }

    // -- Configuration flow -------------------------------------------------

    /// Validates a picker-provided folder, creates the `Tesina Backups`
    /// subfolder, and stores it as the pending selection without persisting.
    #[cfg(test)]
    fn begin_configuration(&self, path: &str) -> Result<PendingConfiguration, BackupError> {
        let epoch = self.start_configuration_operation();
        self.begin_configuration_at_epoch(path, epoch)
    }

    fn begin_configuration_at_epoch(
        &self,
        path: &str,
        epoch: u64,
    ) -> Result<PendingConfiguration, BackupError> {
        self.require_configuration_epoch(epoch)?;
        let selected = PathBuf::from(path);
        let metadata = fs::symlink_metadata(&selected)
            .map_err(|error| BackupError::io("selected folder is not accessible", &error))?;
        if metadata.file_type().is_symlink() {
            return Err(BackupError::new(
                BackupErrorCode::SymlinkRejected,
                "the selected path is a symlink or reparse point",
            ));
        }
        if !metadata.is_dir() {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "the selected path is not a directory",
            ));
        }
        let canonical = fs::canonicalize(&selected)
            .map_err(|error| BackupError::io("selected folder cannot be canonicalized", &error))?;
        let canonical_app_data = fs::canonicalize(&self.app_data_dir).map_err(|error| {
            BackupError::io("application data directory cannot be canonicalized", &error)
        })?;
        if canonical == canonical_app_data
            || canonical.starts_with(&canonical_app_data)
            || canonical_app_data.starts_with(&canonical)
        {
            return Err(BackupError::new(
                BackupErrorCode::InsideAppData,
                "a backup folder must live outside the application's own storage",
            ));
        }
        let subfolder = canonical.join(BACKUP_SUBFOLDER_NAME);
        fs::create_dir_all(&subfolder).map_err(|error| {
            BackupError::io("cannot create the Tesina Backups subfolder", &error)
        })?;
        let subfolder = fs::canonicalize(&subfolder).map_err(|error| {
            BackupError::io("Tesina Backups subfolder cannot be canonicalized", &error)
        })?;

        let payload = PendingConfiguration {
            canonical_folder_path: canonical.to_string_lossy().into_owned(),
            backup_subfolder_path: subfolder.to_string_lossy().into_owned(),
        };
        let mut inner = self.lock();
        self.claim_configuration_commit(epoch)?;
        inner.pending = Some(PendingState {
            canonical_folder_path: canonical,
            test_archives: Vec::new(),
        });
        Ok(payload)
    }

    /// Writes a test archive exclusively into the PENDING subfolder and
    /// records it for this pending session. Returns the archive's sha256.
    pub fn write_test_archive(&self, file_name: &str, bytes: &[u8]) -> Result<String, BackupError> {
        validate_file_name(file_name)?;
        let mut inner = self.lock();
        let pending = inner.pending.as_mut().ok_or_else(|| {
            BackupError::new(
                BackupErrorCode::PendingMissing,
                "no folder configuration is in progress",
            )
        })?;
        let subfolder = resolve_subfolder(&pending.canonical_folder_path)?;
        write_exclusive(&subfolder, file_name, bytes)?;
        let sha = sha256_hex(bytes);
        pending
            .test_archives
            .push((file_name.to_owned(), sha.clone()));
        Ok(sha)
    }

    /// Requires a pending selection with at least one successful test write.
    /// Generates a fresh `backupSetId`, atomically persists the authorization
    /// record, records the test archive(s) in the ledger, drops any previous
    /// active authorization (old files untouched), and clears pending.
    #[cfg(test)]
    fn activate_configuration(&self) -> Result<ActiveConfiguration, BackupError> {
        let epoch = self.start_configuration_operation();
        self.activate_configuration_at_epoch(epoch)
    }

    fn activate_configuration_at_epoch(
        &self,
        epoch: u64,
    ) -> Result<ActiveConfiguration, BackupError> {
        self.require_configuration_epoch(epoch)?;
        let mut inner = self.lock();
        let pending = inner.pending.as_ref().ok_or_else(|| {
            BackupError::new(
                BackupErrorCode::PendingMissing,
                "no folder configuration is in progress",
            )
        })?;
        if pending.test_archives.is_empty() {
            return Err(BackupError::new(
                BackupErrorCode::PendingMissing,
                "a successful test backup is required before activation",
            ));
        }
        let backup_set_id = Uuid::new_v4().to_string();
        let canonical_folder_path = pending.canonical_folder_path.clone();
        let config = BackupDirectoryConfig {
            schema_version: 1,
            canonical_folder_path: canonical_folder_path.to_string_lossy().into_owned(),
            backup_set_id: backup_set_id.clone(),
        };
        let subfolder = resolve_subfolder(&canonical_folder_path)?;
        let mut validated_tests = Vec::with_capacity(pending.test_archives.len());
        for (file_name, expected_sha256) in &pending.test_archives {
            let path = subfolder.join(file_name);
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| BackupError::io("test archive is not accessible", &error))?;
            if !metadata.is_file() {
                return Err(BackupError::new(
                    BackupErrorCode::Io,
                    "the test archive is not a regular file",
                ));
            }
            let current_sha256 =
                sha256_file_bounded(&path, "cannot reopen test archive", MAX_ARCHIVE_BYTES)?;
            if !current_sha256.eq_ignore_ascii_case(expected_sha256) {
                return Err(BackupError::new(
                    BackupErrorCode::HashMismatch,
                    "the validated test archive changed before activation",
                ));
            }
            validated_tests.push((file_name.clone(), current_sha256));
        }
        let created_at = rfc3339_now();
        let mut ledger = load_ledger(&self.app_data_dir);
        for (file_name, sha256) in &validated_tests {
            ledger.entries.push(LedgerEntry {
                file_name: file_name.clone(),
                sha256: sha256.clone(),
                created_at: created_at.clone(),
                backup_set_id: backup_set_id.clone(),
            });
        }
        self.claim_configuration_commit(epoch)?;
        // The ledger is non-authorizing metadata. Persist it first so any
        // failure leaves setup inactive; once the authorization record lands,
        // both durable halves already describe the same backup set.
        write_json_atomic(&self.app_data_dir, LEDGER_FILE_NAME, &ledger)?;
        write_json_atomic(&self.app_data_dir, DIRECTORY_FILE_NAME, &config)?;

        inner.active = Some(ActiveState {
            canonical_folder_path: canonical_folder_path.clone(),
            backup_set_id: backup_set_id.clone(),
        });
        inner.pending = None;
        Ok(ActiveConfiguration {
            canonical_folder_path: canonical_folder_path.to_string_lossy().into_owned(),
            backup_set_id,
        })
    }

    /// Clears the pending selection and removes ONLY the exact test file(s)
    /// this pending session wrote (best-effort; never touches other files).
    pub fn cancel_configuration(&self) -> Result<(), BackupError> {
        self.invalidate_current_configuration_epoch();
        let mut inner = self.lock();
        if let Some(pending) = inner.pending.take() {
            if let Ok(subfolder) = resolve_subfolder(&pending.canonical_folder_path) {
                for (file_name, expected_sha256) in &pending.test_archives {
                    if validate_file_name(file_name).is_ok() {
                        let _ = quarantine_and_remove_archive(
                            &subfolder.join(file_name),
                            expected_sha256,
                            |_| Ok(()),
                        );
                    }
                }
            }
        }
        Ok(())
    }

    // -- Post-configuration operations --------------------------------------

    /// Exclusive-create write of a new archive into the active subfolder.
    /// Never clobbers an existing file (`name_taken` on collision). Returns
    /// the Rust-computed authoritative sha256. The caller must reopen and
    /// validate the archive before `confirm_archive` records it in the ledger.
    pub fn write_archive(&self, file_name: &str, bytes: &[u8]) -> Result<String, BackupError> {
        validate_file_name(file_name)?;
        let inner = self.lock();
        let active = require_active(&inner)?;
        let subfolder = resolve_subfolder(&active.canonical_folder_path)?;
        write_exclusive(&subfolder, file_name, bytes)?;
        let sha = sha256_hex(bytes);
        drop(inner);
        Ok(sha)
    }

    /// Records a written archive only after the TypeScript caller has reopened
    /// and fully validated it. The current bytes are hashed again here so the
    /// ledger can never authorize retention of different or truncated bytes.
    pub fn confirm_archive(
        &self,
        file_name: &str,
        expected_sha256: &str,
    ) -> Result<(), BackupError> {
        validate_file_name(file_name)?;
        let inner = self.lock();
        let active = require_active(&inner)?;
        let backup_set_id = active.backup_set_id.clone();
        let subfolder = resolve_subfolder(&active.canonical_folder_path)?;
        let current = sha256_file_bounded(
            &subfolder.join(file_name),
            "cannot reopen archive for confirmation",
            MAX_ARCHIVE_BYTES,
        )?;
        if !current.eq_ignore_ascii_case(expected_sha256) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the validated archive bytes changed before ledger confirmation",
            ));
        }
        let mut ledger = load_ledger(&self.app_data_dir);
        ledger.entries.retain(|entry| {
            !(entry.file_name == file_name && entry.backup_set_id == backup_set_id)
        });
        ledger.entries.push(LedgerEntry {
            file_name: file_name.to_owned(),
            sha256: current,
            created_at: rfc3339_now(),
            backup_set_id,
        });
        write_json_atomic(&self.app_data_dir, LEDGER_FILE_NAME, &ledger)?;
        drop(inner);
        Ok(())
    }

    /// Reads an automatic backup only from the active subfolder.
    pub fn read_archive(&self, file_name: &str) -> Result<Vec<u8>, BackupError> {
        self.read_archive_with_limit(file_name, MAX_ARCHIVE_BYTES)
    }

    /// Reads a setup-wizard test only from the pending subfolder.
    pub fn read_test_archive(&self, file_name: &str) -> Result<Vec<u8>, BackupError> {
        validate_file_name(file_name)?;
        let inner = self.lock();
        let pending = inner.pending.as_ref().ok_or_else(|| {
            BackupError::new(
                BackupErrorCode::PendingMissing,
                "no folder configuration is in progress",
            )
        })?;
        let subfolder = resolve_subfolder(&pending.canonical_folder_path)?;
        Self::read_archive_file(&subfolder, file_name, MAX_ARCHIVE_BYTES)
    }

    fn read_archive_with_limit(
        &self,
        file_name: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>, BackupError> {
        validate_file_name(file_name)?;
        let inner = self.lock();
        let active = require_active(&inner)?;
        let subfolder = resolve_subfolder(&active.canonical_folder_path)?;
        Self::read_archive_file(&subfolder, file_name, max_bytes)
    }

    fn read_archive_file(
        subfolder: &Path,
        file_name: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>, BackupError> {
        let path = subfolder.join(file_name);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| BackupError::io("archive is not accessible", &error))?;
        if !metadata.is_file() {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "the requested archive is not a regular file",
            ));
        }
        let file = fs::File::open(&path)
            .map_err(|error| BackupError::io("cannot read archive", &error))?;
        let mut bytes = Vec::with_capacity(
            usize::try_from(metadata.len())
                .unwrap_or(max_bytes)
                .min(max_bytes),
        );
        file.take((max_bytes as u64).saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|error| BackupError::io("cannot read archive", &error))?;
        if bytes.len() > max_bytes {
            return Err(BackupError::new(
                BackupErrorCode::FileTooLarge,
                "the archive exceeds the supported size limit",
            ));
        }
        Ok(bytes)
    }

    /// Non-recursive listing of `*.tesina` regular files in the active
    /// subfolder. Directories and symlinks are skipped.
    pub fn list_archives(&self) -> Result<Vec<ArchiveListing>, BackupError> {
        let inner = self.lock();
        let active = require_active(&inner)?;
        let subfolder = resolve_subfolder(&active.canonical_folder_path)?;
        let mut listings = Vec::new();
        let entries = fs::read_dir(&subfolder)
            .map_err(|error| BackupError::io("cannot list the Tesina Backups subfolder", &error))?;
        for entry in entries {
            let entry =
                entry.map_err(|error| BackupError::io("cannot read directory entry", &error))?;
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_symlink() || !file_type.is_file() {
                continue;
            }
            let name = match entry.file_name().into_string() {
                Ok(name) => name,
                Err(_) => continue,
            };
            if !name.ends_with(ARCHIVE_EXTENSION) {
                continue;
            }
            let byte_length = match entry.metadata() {
                Ok(metadata) => metadata.len(),
                Err(_) => continue,
            };
            listings.push(ArchiveListing {
                file_name: name,
                byte_length,
            });
        }
        listings.sort_by(|a, b| a.file_name.cmp(&b.file_name));
        Ok(listings)
    }

    /// Deletes an archive only after recomputing its current sha256 and
    /// matching it against `expected_sha256`. On success also drops the
    /// matching ledger entry.
    pub fn remove_archive(
        &self,
        file_name: &str,
        expected_sha256: &str,
    ) -> Result<(), BackupError> {
        validate_file_name(file_name)?;
        let inner = self.lock();
        let active = require_active(&inner)?;
        let backup_set_id = active.backup_set_id.clone();
        let subfolder = resolve_subfolder(&active.canonical_folder_path)?;
        let path = subfolder.join(file_name);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| BackupError::io("archive is not accessible", &error))?;
        if !metadata.is_file() {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "the removal candidate is not a regular file",
            ));
        }
        quarantine_and_remove_archive(&path, expected_sha256, |_| Ok(()))?;
        let mut ledger = load_ledger(&self.app_data_dir);
        ledger.entries.retain(|entry| {
            !(entry.file_name == file_name && entry.backup_set_id == backup_set_id)
        });
        write_json_atomic(&self.app_data_dir, LEDGER_FILE_NAME, &ledger)?;
        drop(inner);
        Ok(())
    }

    /// Ledger entries belonging to the CURRENT `backupSetId` only.
    pub fn ledger_entries(&self) -> Result<Vec<LedgerEntry>, BackupError> {
        let inner = self.lock();
        let active = require_active(&inner)?;
        let ledger = load_ledger(&self.app_data_dir);
        Ok(ledger
            .entries
            .into_iter()
            .filter(|entry| entry.backup_set_id == active.backup_set_id)
            .collect())
    }

    pub fn status(&self) -> BackupStatus {
        let inner = self.lock();
        match inner.active.as_ref() {
            Some(active) => BackupStatus {
                configured: true,
                folder_path: Some(active.canonical_folder_path.to_string_lossy().into_owned()),
                backup_set_id: Some(active.backup_set_id.clone()),
                folder_available: resolve_subfolder(&active.canonical_folder_path).is_ok(),
            },
            None => BackupStatus {
                configured: false,
                folder_path: None,
                backup_set_id: None,
                folder_available: false,
            },
        }
    }

    /// Deletes `backup-directory.json` and drops the active authorization.
    /// The ledger file is retained: it only ever authorizes pruning of
    /// matching set ids, and a fresh set id never matches old entries.
    pub fn disable(&self) -> Result<(), BackupError> {
        self.invalidate_current_configuration_epoch();
        let mut inner = self.lock();
        let record = self.app_data_dir.join(DIRECTORY_FILE_NAME);
        match fs::remove_file(&record) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(BackupError::io(
                    "cannot delete the backup authorization record",
                    &error,
                ))
            }
        }
        inner.active = None;
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn require_active(inner: &Inner) -> Result<&ActiveState, BackupError> {
    inner.active.as_ref().ok_or_else(|| {
        BackupError::new(
            BackupErrorCode::NotConfigured,
            "automatic backup is not configured",
        )
    })
}

// ---------------------------------------------------------------------------
// Path resolution and validation
// ---------------------------------------------------------------------------

/// Re-resolves the stored canonical folder before every operation. Denies the
/// operation with `folder_unavailable` whenever the folder or its `Tesina
/// Backups` subfolder is missing, has been replaced by a symlink, or no longer
/// canonicalizes to the exact stored identity.
fn resolve_subfolder(stored_canonical_folder: &Path) -> Result<PathBuf, BackupError> {
    let unavailable = |detail: &str| BackupError::new(BackupErrorCode::FolderUnavailable, detail);

    let folder_metadata = fs::symlink_metadata(stored_canonical_folder)
        .map_err(|_| unavailable("the configured backup folder is not accessible"))?;
    if folder_metadata.file_type().is_symlink() || !folder_metadata.is_dir() {
        return Err(unavailable(
            "the configured backup folder is no longer a real directory",
        ));
    }
    let canonical = fs::canonicalize(stored_canonical_folder)
        .map_err(|_| unavailable("the configured backup folder cannot be canonicalized"))?;
    if canonical != stored_canonical_folder {
        return Err(unavailable(
            "the configured backup folder no longer resolves to its authorized identity",
        ));
    }
    let subfolder = stored_canonical_folder.join(BACKUP_SUBFOLDER_NAME);
    let subfolder_metadata = fs::symlink_metadata(&subfolder)
        .map_err(|_| unavailable("the Tesina Backups subfolder is not accessible"))?;
    if subfolder_metadata.file_type().is_symlink() || !subfolder_metadata.is_dir() {
        return Err(unavailable(
            "the Tesina Backups subfolder is no longer a real directory",
        ));
    }
    let canonical_subfolder = fs::canonicalize(&subfolder)
        .map_err(|_| unavailable("the Tesina Backups subfolder cannot be canonicalized"))?;
    if canonical_subfolder != subfolder {
        return Err(unavailable(
            "the Tesina Backups subfolder no longer resolves to its authorized identity",
        ));
    }
    Ok(canonical_subfolder)
}

/// Strict bare-file-name grammar: `^[A-Za-z0-9 ._-]+\.tesina$`, no path
/// separators, no leading dot, at most 120 bytes.
fn validate_file_name(file_name: &str) -> Result<(), BackupError> {
    let invalid = |detail: &str| {
        Err(BackupError::new(
            BackupErrorCode::InvalidFileName,
            detail.to_owned(),
        ))
    };
    if file_name.is_empty() {
        return invalid("file name is empty");
    }
    if file_name.len() > MAX_FILE_NAME_LENGTH {
        return invalid("file name is longer than 120 bytes");
    }
    if file_name.starts_with('.') {
        return invalid("file name must not start with a dot");
    }
    if !file_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'))
    {
        return invalid("file name contains a character outside [A-Za-z0-9 ._-]");
    }
    if !file_name.ends_with(ARCHIVE_EXTENSION) {
        return invalid("file name must end with .tesina");
    }
    if file_name.len() == ARCHIVE_EXTENSION.len() {
        return invalid("file name needs a non-empty stem before .tesina");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/// Exclusive-create write with no clobbering: write a `.tmp-<uuid>` sibling,
/// fsync it, then hard-link it to the final name (falling back to
/// `create_new` + copy where hard links are unsupported), and remove the temp.
/// An existing final name yields `name_taken` and leaves it untouched.
fn write_exclusive(dir: &Path, file_name: &str, bytes: &[u8]) -> Result<(), BackupError> {
    let final_path = dir.join(file_name);
    let tmp_path = dir.join(format!(".tmp-{}", Uuid::new_v4()));
    let name_taken = || {
        BackupError::new(
            BackupErrorCode::NameTaken,
            "a file with this name already exists in the backup folder",
        )
    };

    let write_result = (|| -> Result<(), BackupError> {
        let mut tmp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(|error| BackupError::io("cannot create temporary archive file", &error))?;
        tmp.write_all(bytes)
            .map_err(|error| BackupError::io("cannot write archive bytes", &error))?;
        tmp.sync_all()
            .map_err(|error| BackupError::io("cannot sync archive bytes", &error))?;
        drop(tmp);

        match fs::hard_link(&tmp_path, &final_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => Err(name_taken()),
            Err(_) => {
                // Hard links unsupported on this filesystem: exclusive create
                // plus copy preserves the no-clobber guarantee.
                copy_exclusive_file(&final_path, |file| {
                    file.write_all(bytes)
                        .map_err(|error| BackupError::io("cannot write archive bytes", &error))
                })
            }
        }
    })();

    let _ = fs::remove_file(&tmp_path);
    write_result
}

fn copy_exclusive_file<F>(final_path: &Path, write: F) -> Result<(), BackupError>
where
    F: FnOnce(&mut fs::File) -> Result<(), BackupError>,
{
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(final_path)
        .map_err(|error| {
            if error.kind() == ErrorKind::AlreadyExists {
                BackupError::new(
                    BackupErrorCode::NameTaken,
                    "a file with this name already exists in the backup folder",
                )
            } else {
                BackupError::io("cannot create archive file", &error)
            }
        })?;
    let owned_identity = file
        .try_clone()
        .and_then(FileIdentity::from_file)
        .map_err(|error| BackupError::io("cannot identify archive file", &error))?;
    let result = write(&mut file).and_then(|()| {
        file.sync_all()
            .map_err(|error| BackupError::io("cannot sync archive bytes", &error))
    });
    drop(file);
    if result.is_err() {
        let _ = cleanup_created_file_with_hook(final_path, &owned_identity, || Ok(()));
    }
    result
}

fn cleanup_created_file_with_hook<F>(
    path: &Path,
    owned_identity: &FileIdentity,
    before_quarantine: F,
) -> Result<(), BackupError>
where
    F: FnOnce() -> Result<(), BackupError>,
{
    before_quarantine()?;
    if !path.exists() {
        return Ok(());
    }
    let parent = path.parent().ok_or_else(|| {
        BackupError::new(BackupErrorCode::Io, "the created archive has no parent")
    })?;
    let quarantine = parent.join(format!(".failed-{}", Uuid::new_v4()));
    fs::rename(path, &quarantine)
        .map_err(|error| BackupError::io("cannot quarantine incomplete archive", &error))?;
    let current = FileIdentity::from_path(&quarantine)
        .map_err(|error| BackupError::io("cannot identify quarantined archive", &error))?;
    if owned_identity == &current {
        return fs::remove_file(&quarantine)
            .map_err(|error| BackupError::io("cannot remove incomplete archive", &error));
    }
    if !path.exists() {
        let _ = fs::rename(&quarantine, path);
    }
    Err(BackupError::new(
        BackupErrorCode::Io,
        "the incomplete archive pathname now belongs to another file",
    ))
}

/// Atomic app-data JSON write: temporary sibling, fsync, rename over target.
fn write_json_atomic(
    app_data_dir: &Path,
    file_name: &str,
    value: &impl Serialize,
) -> Result<(), BackupError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| BackupError::new(BackupErrorCode::Io, format!("serialize: {error}")))?;
    let tmp_path = app_data_dir.join(format!(".tmp-{}", Uuid::new_v4()));
    let final_path = app_data_dir.join(file_name);
    let result = (|| -> Result<(), BackupError> {
        let mut tmp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(|error| BackupError::io("cannot create temporary record file", &error))?;
        tmp.write_all(&bytes)
            .map_err(|error| BackupError::io("cannot write record", &error))?;
        tmp.sync_all()
            .map_err(|error| BackupError::io("cannot sync record", &error))?;
        drop(tmp);
        recover_record_replacement(&final_path)?;
        match fs::rename(&tmp_path, &final_path) {
            Ok(()) => Ok(()),
            Err(_first) if cfg!(windows) && final_path.exists() => {
                replace_record_preserving(&tmp_path, &final_path)
            }
            Err(error) => Err(BackupError::io("cannot atomically replace record", &error)),
        }
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    result
}

fn record_previous_path(final_path: &Path) -> PathBuf {
    let name = final_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("record");
    final_path.with_file_name(format!(".{name}.previous"))
}

fn recover_record_replacement(final_path: &Path) -> Result<(), BackupError> {
    let previous_path = record_previous_path(final_path);
    if !previous_path.exists() {
        return Ok(());
    }
    if final_path.exists() {
        fs::remove_file(&previous_path)
            .map_err(|error| BackupError::io("cannot retire previous record", &error))
    } else {
        fs::rename(&previous_path, final_path)
            .map_err(|error| BackupError::io("cannot restore previous record", &error))
    }
}

fn replace_record_preserving(tmp_path: &Path, final_path: &Path) -> Result<(), BackupError> {
    let previous_path = record_previous_path(final_path);
    recover_record_replacement(final_path)?;
    fs::rename(final_path, &previous_path)
        .map_err(|error| BackupError::io("cannot preserve existing record", &error))?;
    match fs::rename(tmp_path, final_path) {
        Ok(()) => fs::remove_file(&previous_path)
            .map_err(|error| BackupError::io("cannot retire previous record", &error)),
        Err(install_error) => {
            fs::rename(&previous_path, final_path)
                .map_err(|error| BackupError::io("cannot restore previous record", &error))?;
            Err(BackupError::io(
                "cannot install replacement record",
                &install_error,
            ))
        }
    }
}

fn load_directory_config(app_data_dir: &Path) -> Option<BackupDirectoryConfig> {
    let path = app_data_dir.join(DIRECTORY_FILE_NAME);
    recover_record_replacement(&path).ok()?;
    let bytes = fs::read(path).ok()?;
    let config: BackupDirectoryConfig = serde_json::from_slice(&bytes).ok()?;
    if config.schema_version != 1 {
        return None;
    }
    if config.canonical_folder_path.is_empty() {
        return None;
    }
    Uuid::parse_str(&config.backup_set_id).ok()?;
    Some(config)
}

fn load_ledger(app_data_dir: &Path) -> Ledger {
    let path = app_data_dir.join(LEDGER_FILE_NAME);
    if recover_record_replacement(&path).is_err() {
        return Ledger::empty();
    }
    let Ok(bytes) = fs::read(path) else {
        return Ledger::empty();
    };
    match serde_json::from_slice::<Ledger>(&bytes) {
        Ok(ledger) if ledger.schema_version == 1 => ledger,
        _ => Ledger::empty(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

fn sha256_file_bounded(
    path: &Path,
    context: &str,
    max_bytes: usize,
) -> Result<String, BackupError> {
    let mut file = fs::File::open(path).map_err(|error| BackupError::io(context, &error))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut total = 0_usize;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| BackupError::io(context, &error))?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read);
        if total > max_bytes {
            return Err(BackupError::new(
                BackupErrorCode::FileTooLarge,
                "the archive exceeds the supported size limit",
            ));
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

/// Moves the pathname out of service before hashing so a sync provider may
/// recreate the public name without making us delete unverified bytes. The
/// hook is a deterministic test seam for that post-quarantine race.
fn quarantine_and_remove_archive<F>(
    path: &Path,
    expected_sha256: &str,
    after_quarantine: F,
) -> Result<(), BackupError>
where
    F: FnOnce(&Path) -> Result<(), BackupError>,
{
    let parent = path.parent().ok_or_else(|| {
        BackupError::new(BackupErrorCode::Io, "the archive has no parent directory")
    })?;
    let quarantine = parent.join(format!(".delete-{}", Uuid::new_v4()));
    fs::rename(path, &quarantine)
        .map_err(|error| BackupError::io("cannot quarantine archive", &error))?;

    let outcome = (|| {
        after_quarantine(&quarantine)?;
        let metadata = fs::symlink_metadata(&quarantine)
            .map_err(|error| BackupError::io("quarantined archive is not accessible", &error))?;
        if !metadata.is_file() {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "the quarantined removal candidate is not a regular file",
            ));
        }
        let current = sha256_file_bounded(
            &quarantine,
            "cannot read quarantined archive",
            MAX_ARCHIVE_BYTES,
        )?;
        if !current.eq_ignore_ascii_case(expected_sha256) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the quarantined bytes do not match the recorded hash; nothing was deleted",
            ));
        }
        fs::remove_file(&quarantine)
            .map_err(|error| BackupError::io("cannot remove quarantined archive", &error))
    })();

    if outcome.is_err() && quarantine.exists() && !path.exists() {
        let _ = fs::rename(&quarantine, path);
    }
    outcome
}

// ---------------------------------------------------------------------------
// RFC 3339 timestamp (UTC, second precision) without a date-time dependency
// ---------------------------------------------------------------------------

fn rfc3339_now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    rfc3339_from_unix(seconds)
}

fn rfc3339_from_unix(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        seconds_of_day / 3600,
        (seconds_of_day % 3600) / 60,
        seconds_of_day % 60,
    )
}

/// Howard Hinnant's `civil_from_days` algorithm (public-domain reference).
fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year_of_era = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if month <= 2 {
        year_of_era + 1
    } else {
        year_of_era
    };
    (year, month, day)
}

// ---------------------------------------------------------------------------
// Tauri command wrappers (thin; all logic lives in the core above)
// ---------------------------------------------------------------------------

async fn run_selected_folder<T, F>(operation: F) -> Result<T, BackupError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, BackupError> + Send + 'static,
{
    run_selected_folder_with_timeout(SELECTED_FOLDER_TIMEOUT, operation).await
}

async fn run_selected_folder_with_timeout<T, F>(
    timeout: Duration,
    operation: F,
) -> Result<T, BackupError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, BackupError> + Send + 'static,
{
    let mut task = tauri::async_runtime::spawn_blocking(operation);
    match tokio::time::timeout(timeout, &mut task).await {
        Err(_) => match task.await {
            Err(error) => Err(BackupError::new(
                BackupErrorCode::Io,
                format!("selected-folder worker failed: {error}"),
            )),
            Ok(result) => result,
        },
        Ok(Err(error)) => Err(BackupError::new(
            BackupErrorCode::Io,
            format!("selected-folder worker failed: {error}"),
        )),
        Ok(Ok(result)) => result,
    }
}

async fn run_activation_with_timeout(
    timeout: Duration,
    core: BackupDirectoryCore,
) -> Result<ActiveConfiguration, BackupError> {
    let epoch = core.start_configuration_operation();
    let worker = core.clone();
    let mut task =
        tauri::async_runtime::spawn_blocking(move || worker.activate_configuration_at_epoch(epoch));
    match tokio::time::timeout(timeout, &mut task).await {
        Err(_) => {
            if core.invalidate_configuration_epoch(epoch) {
                return Err(BackupError::new(
                    BackupErrorCode::Timeout,
                    "the selected backup folder did not respond before the timeout",
                ));
            }
            if core.configuration_epoch() == epoch.wrapping_add(1) {
                match task.await {
                    Err(error) => Err(BackupError::new(
                        BackupErrorCode::Io,
                        format!("selected-folder worker failed: {error}"),
                    )),
                    Ok(result) => result,
                }
            } else {
                Err(BackupError::new(
                    BackupErrorCode::Timeout,
                    "the selected backup folder did not respond before the timeout",
                ))
            }
        }
        Ok(Err(error)) => Err(BackupError::new(
            BackupErrorCode::Io,
            format!("selected-folder worker failed: {error}"),
        )),
        Ok(Ok(result)) => result,
    }
}

async fn run_begin_configuration_with_timeout(
    timeout: Duration,
    core: BackupDirectoryCore,
    path: String,
) -> Result<PendingConfiguration, BackupError> {
    let epoch = core.start_configuration_operation();
    let worker = core.clone();
    let mut task = tauri::async_runtime::spawn_blocking(move || {
        worker.begin_configuration_at_epoch(&path, epoch)
    });
    match tokio::time::timeout(timeout, &mut task).await {
        Err(_) => {
            if core.invalidate_configuration_epoch(epoch) {
                return Err(BackupError::new(
                    BackupErrorCode::Timeout,
                    "the selected backup folder did not respond before the timeout",
                ));
            }
            if core.configuration_epoch() == epoch.wrapping_add(1) {
                match task.await {
                    Err(error) => Err(BackupError::new(
                        BackupErrorCode::Io,
                        format!("selected-folder worker failed: {error}"),
                    )),
                    Ok(result) => result,
                }
            } else {
                Err(BackupError::new(
                    BackupErrorCode::Timeout,
                    "the selected backup folder did not respond before the timeout",
                ))
            }
        }
        Ok(Err(error)) => Err(BackupError::new(
            BackupErrorCode::Io,
            format!("selected-folder worker failed: {error}"),
        )),
        Ok(Ok(result)) => result,
    }
}

#[tauri::command]
pub async fn backup_begin_configuration(
    state: tauri::State<'_, BackupDirectoryCore>,
    path: String,
) -> Result<PendingConfiguration, BackupError> {
    let core = state.inner().clone();
    run_begin_configuration_with_timeout(SELECTED_FOLDER_TIMEOUT, core, path).await
}

#[tauri::command]
pub async fn backup_write_test_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, BackupError> {
    let file_name = request_file_name(&request)?;
    let bytes = request_bytes(&request)?;
    let core = state.inner().clone();
    run_selected_folder(move || core.write_test_archive(&file_name, &bytes)).await
}

#[tauri::command]
pub async fn backup_activate_configuration(
    state: tauri::State<'_, BackupDirectoryCore>,
) -> Result<ActiveConfiguration, BackupError> {
    let core = state.inner().clone();
    run_activation_with_timeout(SELECTED_FOLDER_TIMEOUT, core).await
}

#[tauri::command]
pub async fn backup_cancel_configuration(
    state: tauri::State<'_, BackupDirectoryCore>,
) -> Result<(), BackupError> {
    let core = state.inner().clone();
    run_selected_folder(move || core.cancel_configuration()).await
}

#[tauri::command]
pub async fn backup_write_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, BackupError> {
    let file_name = request_file_name(&request)?;
    let bytes = request_bytes(&request)?;
    let core = state.inner().clone();
    run_selected_folder(move || core.write_archive(&file_name, &bytes)).await
}

#[tauri::command]
pub async fn backup_confirm_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    file_name: String,
    expected_sha256: String,
) -> Result<(), BackupError> {
    let core = state.inner().clone();
    run_selected_folder(move || core.confirm_archive(&file_name, &expected_sha256)).await
}

#[tauri::command]
pub async fn backup_read_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, BackupError> {
    let file_name = request_file_name(&request)?;
    let core = state.inner().clone();
    let bytes = run_selected_folder(move || core.read_archive(&file_name)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn backup_read_test_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, BackupError> {
    let file_name = request_file_name(&request)?;
    let core = state.inner().clone();
    let bytes = run_selected_folder(move || core.read_test_archive(&file_name)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn request_file_name(request: &tauri::ipc::Request<'_>) -> Result<String, BackupError> {
    request
        .headers()
        .get("x-tesina-file-name")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| {
            BackupError::new(
                BackupErrorCode::InvalidFileName,
                "binary archive request is missing its file name",
            )
        })
}

fn request_bytes(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, BackupError> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(_) => Err(BackupError::new(
            BackupErrorCode::Io,
            "archive bytes must use Tauri's raw binary IPC body",
        )),
    }
}

#[tauri::command]
pub async fn backup_list_archives(
    state: tauri::State<'_, BackupDirectoryCore>,
) -> Result<Vec<ArchiveListing>, BackupError> {
    let core = state.inner().clone();
    run_selected_folder(move || core.list_archives()).await
}

#[tauri::command]
pub async fn backup_remove_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    file_name: String,
    expected_sha256: String,
) -> Result<(), BackupError> {
    let core = state.inner().clone();
    run_selected_folder(move || core.remove_archive(&file_name, &expected_sha256)).await
}

#[tauri::command]
pub async fn backup_ledger_entries(
    state: tauri::State<'_, BackupDirectoryCore>,
) -> Result<Vec<LedgerEntry>, BackupError> {
    state.ledger_entries()
}

#[tauri::command]
pub async fn backup_status(
    state: tauri::State<'_, BackupDirectoryCore>,
) -> Result<BackupStatus, BackupError> {
    let core = state.inner().clone();
    run_selected_folder(move || Ok(core.status())).await
}

#[tauri::command]
pub async fn backup_disable(
    state: tauri::State<'_, BackupDirectoryCore>,
) -> Result<(), BackupError> {
    state.disable()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test(flavor = "current_thread")]
    async fn selected_folder_work_finishes_before_the_command_settles() {
        let result = run_selected_folder_with_timeout(Duration::from_millis(5), || {
            std::thread::sleep(Duration::from_millis(50));
            Ok(42)
        })
        .await
        .expect("late provider work must still reconcile");
        assert_eq!(result, 42);
    }

    #[test]
    fn record_replacement_restores_the_previous_file_when_installation_fails() {
        let root = TempDir::new().unwrap();
        let final_path = root.path().join(DIRECTORY_FILE_NAME);
        let missing_tmp = root.path().join("missing.tmp");
        fs::write(&final_path, b"known-good").unwrap();

        replace_record_preserving(&missing_tmp, &final_path)
            .expect_err("missing replacement must fail");
        assert_eq!(fs::read(&final_path).unwrap(), b"known-good");
        assert!(!record_previous_path(&final_path).exists());
    }

    #[test]
    fn record_recovery_restores_a_preserved_file_after_interruption() {
        let root = TempDir::new().unwrap();
        let final_path = root.path().join(LEDGER_FILE_NAME);
        let previous_path = record_previous_path(&final_path);
        fs::write(&previous_path, b"known-good").unwrap();

        recover_record_replacement(&final_path).unwrap();
        assert_eq!(fs::read(&final_path).unwrap(), b"known-good");
        assert!(!previous_path.exists());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn timed_out_activation_worker_cannot_commit_after_returning() {
        let fixture = fixture();
        let core = core(&fixture);
        core.begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive("Delayed.tesina", b"validated")
            .unwrap();

        let guard = core.state.lock().unwrap();
        let error = run_activation_with_timeout(Duration::from_millis(5), core.clone())
            .await
            .expect_err("blocked activation must time out");
        assert_eq!(error.code, BackupErrorCode::Timeout);
        drop(guard);
        tokio::time::sleep(Duration::from_millis(20)).await;

        assert!(!fixture.app_data_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(!core.status().configured);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn timed_out_folder_selection_cannot_replace_a_newer_choice() {
        let fixture = fixture();
        let core = core(&fixture);
        let first = fixture._root.path().join("FirstFolder");
        let second = fixture._root.path().join("SecondFolder");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();

        let guard = core.state.lock().unwrap();
        let error = run_begin_configuration_with_timeout(
            Duration::from_millis(5),
            core.clone(),
            first.to_string_lossy().into_owned(),
        )
        .await
        .expect_err("blocked first selection must time out");
        assert_eq!(error.code, BackupErrorCode::Timeout);
        drop(guard);

        core.begin_configuration(second.to_str().unwrap()).unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        let pending = core.status();
        assert_eq!(
            core.lock()
                .pending
                .as_ref()
                .map(|state| state.canonical_folder_path.clone()),
            Some(fs::canonicalize(second).unwrap())
        );
        assert!(!pending.configured);
    }

    struct Fixture {
        _root: TempDir,
        app_data_dir: PathBuf,
        selected_dir: PathBuf,
    }

    fn fixture() -> Fixture {
        let root = TempDir::new().expect("tempdir");
        let app_data_dir = root.path().join("app-data");
        let selected_dir = root.path().join("Documents").join("MyBackups");
        fs::create_dir_all(&app_data_dir).unwrap();
        fs::create_dir_all(&selected_dir).unwrap();
        Fixture {
            _root: root,
            app_data_dir,
            selected_dir,
        }
    }

    fn core(fixture: &Fixture) -> BackupDirectoryCore {
        BackupDirectoryCore::new(fixture.app_data_dir.clone())
    }

    fn configure(core: &BackupDirectoryCore, folder: &Path) -> ActiveConfiguration {
        core.begin_configuration(folder.to_str().unwrap())
            .expect("begin");
        core.write_test_archive("Test Backup.tesina", b"test archive bytes")
            .expect("test write");
        core.activate_configuration().expect("activate")
    }

    fn subfolder_of(selected: &Path) -> PathBuf {
        fs::canonicalize(selected)
            .unwrap()
            .join(BACKUP_SUBFOLDER_NAME)
    }

    #[test]
    fn configuration_happy_path_creates_subfolder_and_persists_record() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .expect("begin");
        let subfolder = PathBuf::from(&pending.backup_subfolder_path);
        assert!(subfolder.is_dir(), "Tesina Backups subfolder must exist");
        assert!(subfolder.ends_with(BACKUP_SUBFOLDER_NAME));

        // Nothing persisted before a validated test archive + activation.
        assert!(!fixture.app_data_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(!core.status().configured);

        core.write_test_archive("Test.tesina", b"payload").unwrap();
        let active = core.activate_configuration().unwrap();
        Uuid::parse_str(&active.backup_set_id).expect("uuid backup set id");

        let record = fixture.app_data_dir.join(DIRECTORY_FILE_NAME);
        let json: serde_json::Value = serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["backupSetId"], active.backup_set_id.as_str());
        assert_eq!(
            json["canonicalFolderPath"],
            active.canonical_folder_path.as_str()
        );

        let status = core.status();
        assert!(status.configured && status.folder_available);
        assert_eq!(
            status.backup_set_id.as_deref(),
            Some(active.backup_set_id.as_str())
        );
    }

    #[test]
    fn reload_after_restart_restores_exactly_the_active_folder() {
        let fixture = fixture();
        let active = configure(&core(&fixture), &fixture.selected_dir);

        let reloaded = core(&fixture);
        let status = reloaded.status();
        assert!(status.configured);
        assert_eq!(
            status.folder_path.as_deref(),
            Some(active.canonical_folder_path.as_str())
        );
        assert_eq!(
            status.backup_set_id.as_deref(),
            Some(active.backup_set_id.as_str())
        );
        assert!(status.folder_available);
        // The reloaded instance can operate on the restored authorization.
        reloaded
            .write_archive("After Restart.tesina", b"x")
            .unwrap();
    }

    #[test]
    fn reconfiguration_keeps_only_the_newest_folder_after_reload() {
        let fixture = fixture();
        let core_instance = core(&fixture);
        configure(&core_instance, &fixture.selected_dir);

        let second = fixture._root.path().join("SecondFolder");
        fs::create_dir_all(&second).unwrap();
        let active_b = configure(&core_instance, &second);

        let reloaded = core(&fixture);
        let status = reloaded.status();
        assert_eq!(
            status.folder_path.as_deref(),
            Some(active_b.canonical_folder_path.as_str())
        );
        assert_eq!(
            status.backup_set_id.as_deref(),
            Some(active_b.backup_set_id.as_str())
        );
        // Old folder's archive bytes remain untouched.
        assert!(subfolder_of(&fixture.selected_dir)
            .join("Test Backup.tesina")
            .is_file());
    }

    #[cfg(unix)]
    #[test]
    fn begin_configuration_rejects_symlinked_selection() {
        let fixture = fixture();
        let core = core(&fixture);
        let link = fixture._root.path().join("link-to-folder");
        std::os::unix::fs::symlink(&fixture.selected_dir, &link).unwrap();
        let error = core
            .begin_configuration(link.to_str().unwrap())
            .expect_err("symlink must be rejected");
        assert_eq!(error.code, BackupErrorCode::SymlinkRejected);
    }

    #[test]
    fn begin_configuration_rejects_app_data_dir_itself() {
        let fixture = fixture();
        let core = core(&fixture);
        let error = core
            .begin_configuration(fixture.app_data_dir.to_str().unwrap())
            .expect_err("app data dir must be rejected");
        assert_eq!(error.code, BackupErrorCode::InsideAppData);
    }

    #[test]
    fn begin_configuration_rejects_child_of_app_data_dir() {
        let fixture = fixture();
        let core = core(&fixture);
        let child = fixture.app_data_dir.join("essays");
        fs::create_dir_all(&child).unwrap();
        let error = core
            .begin_configuration(child.to_str().unwrap())
            .expect_err("child of app data dir must be rejected");
        assert_eq!(error.code, BackupErrorCode::InsideAppData);
    }

    #[test]
    fn begin_configuration_rejects_ancestor_containing_app_data_dir() {
        let fixture = fixture();
        let core = core(&fixture);
        let error = core
            .begin_configuration(fixture._root.path().to_str().unwrap())
            .expect_err("a folder containing app data must be rejected");
        assert_eq!(error.code, BackupErrorCode::InsideAppData);
    }

    #[test]
    fn test_archive_lands_in_pending_subfolder_and_activate_records_ledger() {
        let fixture = fixture();
        let core = core(&fixture);
        core.begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let sha = core
            .write_test_archive("Wizard Test.tesina", b"wizard bytes")
            .unwrap();
        assert_eq!(sha, sha256_hex(b"wizard bytes"));

        let path = subfolder_of(&fixture.selected_dir).join("Wizard Test.tesina");
        assert!(
            path.is_file(),
            "test archive must land in pending subfolder"
        );
        assert_eq!(
            core.read_test_archive("Wizard Test.tesina").unwrap(),
            b"wizard bytes"
        );

        core.activate_configuration().unwrap();
        let entries = core.ledger_entries().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file_name, "Wizard Test.tesina");
        assert_eq!(entries[0].sha256, sha);
        // RFC3339: 2026-08-08T19:42:00Z shape.
        assert_eq!(entries[0].created_at.len(), 20);
        assert!(entries[0].created_at.ends_with('Z'));
        assert_eq!(&entries[0].created_at[4..5], "-");
        assert_eq!(&entries[0].created_at[10..11], "T");
    }

    #[test]
    fn failed_exclusive_copy_removes_its_owned_destination() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Partial.tesina");
        let error = copy_exclusive_file(&destination, |file| {
            file.write_all(b"partial").unwrap();
            Err(BackupError::new(
                BackupErrorCode::Io,
                "injected copy failure",
            ))
        })
        .expect_err("copy failure must propagate");

        assert_eq!(error.code, BackupErrorCode::Io);
        assert!(!destination.exists());
    }

    #[test]
    fn failed_copy_cleanup_preserves_a_replacement() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Partial.tesina");
        fs::write(&destination, b"owned partial").unwrap();
        let owned = FileIdentity::from_path(&destination).unwrap();

        let error = cleanup_created_file_with_hook(&destination, &owned, || {
            fs::remove_file(&destination).unwrap();
            fs::write(&destination, b"synced replacement").unwrap();
            Ok(())
        })
        .expect_err("a replacement must not be deleted");

        assert_eq!(error.code, BackupErrorCode::Io);
        assert_eq!(fs::read(destination).unwrap(), b"synced replacement");
    }

    #[test]
    fn active_archive_reads_are_not_redirected_during_reconfiguration() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        core.write_archive("Active.tesina", b"active bytes")
            .unwrap();

        let replacement = fixture._root.path().join("ReplacementFolder");
        fs::create_dir_all(&replacement).unwrap();
        core.begin_configuration(replacement.to_str().unwrap())
            .unwrap();
        core.write_test_archive("Pending.tesina", b"pending bytes")
            .unwrap();

        assert_eq!(core.read_archive("Active.tesina").unwrap(), b"active bytes");
        assert_eq!(
            core.read_test_archive("Pending.tesina").unwrap(),
            b"pending bytes"
        );
    }

    #[test]
    fn activation_rejects_a_test_archive_changed_after_validation() {
        let fixture = fixture();
        let core = core(&fixture);
        core.begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive("Changed Test.tesina", b"validated")
            .unwrap();
        fs::write(
            subfolder_of(&fixture.selected_dir).join("Changed Test.tesina"),
            b"truncated",
        )
        .unwrap();

        let error = core
            .activate_configuration()
            .expect_err("changed test archive must not activate backups");
        assert_eq!(error.code, BackupErrorCode::HashMismatch);
        assert!(!fixture.app_data_dir.join(DIRECTORY_FILE_NAME).exists());
    }

    #[test]
    fn activation_does_not_persist_authorization_when_ledger_write_fails() {
        let fixture = fixture();
        let core = core(&fixture);
        core.begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive("Ledger Failure.tesina", b"validated")
            .unwrap();
        fs::create_dir(fixture.app_data_dir.join(LEDGER_FILE_NAME)).unwrap();

        core.activate_configuration()
            .expect_err("ledger failure must abort activation");
        assert!(!fixture.app_data_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(!core.status().configured);
    }

    #[test]
    fn stale_activation_epoch_cannot_commit_configuration() {
        let fixture = fixture();
        let core = core(&fixture);
        core.begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive("Stale.tesina", b"validated")
            .unwrap();
        let epoch = core.configuration_epoch();
        core.invalidate_configuration_epoch(epoch);

        let error = core
            .activate_configuration_at_epoch(epoch)
            .expect_err("a timed-out activation must not commit later");
        assert_eq!(error.code, BackupErrorCode::Timeout);
        assert!(!fixture.app_data_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(!core.status().configured);
    }

    #[test]
    fn cancel_removes_only_its_own_test_file() {
        let fixture = fixture();
        let core = core(&fixture);
        // A foreign file already present in the destination subfolder.
        let subfolder = fixture.selected_dir.join(BACKUP_SUBFOLDER_NAME);
        fs::create_dir_all(&subfolder).unwrap();
        fs::write(subfolder.join("Other Device.tesina"), b"foreign").unwrap();

        core.begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive("My Test.tesina", b"mine").unwrap();
        core.cancel_configuration().unwrap();

        let subfolder = subfolder_of(&fixture.selected_dir);
        assert!(
            !subfolder.join("My Test.tesina").exists(),
            "own test removed"
        );
        assert_eq!(
            fs::read(subfolder.join("Other Device.tesina")).unwrap(),
            b"foreign",
            "foreign file untouched"
        );
        assert!(!core.status().configured, "cancel must not configure");
        assert!(!fixture.app_data_dir.join(DIRECTORY_FILE_NAME).exists());
    }

    #[test]
    fn cancel_keeps_a_test_archive_replaced_by_sync() {
        let fixture = fixture();
        let core = core(&fixture);
        core.begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive("Test Backup.tesina", b"owned test")
            .unwrap();
        let path = subfolder_of(&fixture.selected_dir).join("Test Backup.tesina");
        fs::write(&path, b"synced replacement").unwrap();

        core.cancel_configuration().unwrap();

        assert_eq!(fs::read(path).unwrap(), b"synced replacement");
    }

    #[test]
    fn activate_without_pending_or_test_write_fails() {
        let fixture = fixture();
        let core = core(&fixture);
        let error = core.activate_configuration().expect_err("no pending");
        assert_eq!(error.code, BackupErrorCode::PendingMissing);

        core.begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let error = core.activate_configuration().expect_err("no test write");
        assert_eq!(error.code, BackupErrorCode::PendingMissing);
    }

    #[test]
    fn write_archive_collision_returns_name_taken_and_preserves_bytes() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);

        core.write_archive("Daily.tesina", b"original bytes")
            .unwrap();
        let error = core
            .write_archive("Daily.tesina", b"different bytes")
            .expect_err("second write must collide");
        assert_eq!(error.code, BackupErrorCode::NameTaken);
        assert_eq!(
            fs::read(subfolder_of(&fixture.selected_dir).join("Daily.tesina")).unwrap(),
            b"original bytes"
        );
        // No stray temp files remain.
        let leftovers: Vec<_> = fs::read_dir(subfolder_of(&fixture.selected_dir))
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp files must be cleaned up");
    }

    #[test]
    fn write_archive_returns_authoritative_sha_and_round_trips() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let bytes = b"round trip payload".to_vec();
        let sha = core.write_archive("Round Trip.tesina", &bytes).unwrap();
        assert_eq!(sha, sha256_hex(&bytes));
        assert_eq!(core.read_archive("Round Trip.tesina").unwrap(), bytes);
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .all(|entry| entry.file_name != "Round Trip.tesina"));
        core.confirm_archive("Round Trip.tesina", &sha).unwrap();
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .any(|entry| entry.file_name == "Round Trip.tesina"));
    }

    #[test]
    fn read_archive_stops_at_the_native_size_limit() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        core.write_archive("Bounded.tesina", b"0123456789").unwrap();

        let error = core
            .read_archive_with_limit("Bounded.tesina", 5)
            .expect_err("the reader must stop at max plus one byte");
        assert_eq!(error.code, BackupErrorCode::FileTooLarge);
    }

    #[test]
    fn confirm_archive_rejects_changed_bytes_without_ledgering_them() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let sha = core.write_archive("Changed.tesina", b"valid").unwrap();
        fs::write(
            subfolder_of(&fixture.selected_dir).join("Changed.tesina"),
            b"truncated",
        )
        .unwrap();

        let error = core
            .confirm_archive("Changed.tesina", &sha)
            .expect_err("changed bytes must not enter the ledger");
        assert_eq!(error.code, BackupErrorCode::HashMismatch);
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .all(|entry| entry.file_name != "Changed.tesina"));
    }

    #[test]
    fn file_name_grammar_rejections() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);

        let overlong = format!("{}.tesina", "a".repeat(121));
        let rejected = [
            "../evil.tesina",   // traversal
            "a/b.tesina",       // separator
            "a\\b.tesina",      // backslash separator
            "no-extension",     // missing extension
            ".hidden.tesina",   // leading dot
            ".tesina",          // empty stem
            "",                 // empty
            "nul\0byte.tesina", // NUL
            "café.tesina",      // non-ASCII
            overlong.as_str(),  // length > 120
            "tab\tname.tesina", // control char
        ];
        for candidate in rejected {
            let error = core
                .write_archive(candidate, b"x")
                .expect_err(&format!("must reject {candidate:?}"));
            assert_eq!(
                error.code,
                BackupErrorCode::InvalidFileName,
                "candidate {candidate:?}"
            );
        }
        // A valid grammar-conforming name still works.
        core.write_archive(
            "Tesina Library - a1b2c3d4 - 2026-08-08T19-42-00Z.tesina",
            b"ok",
        )
        .unwrap();
    }

    #[test]
    fn list_archives_skips_non_tesina_files_directories_and_symlinks() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        core.write_archive("Listed.tesina", b"12345").unwrap();

        let subfolder = subfolder_of(&fixture.selected_dir);
        fs::write(subfolder.join("notes.txt"), b"not an archive").unwrap();
        fs::create_dir_all(subfolder.join("nested-dir")).unwrap();
        fs::write(subfolder.join("nested-dir").join("Inner.tesina"), b"nested").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            subfolder.join("Listed.tesina"),
            subfolder.join("Link.tesina"),
        )
        .unwrap();

        let listings = core.list_archives().unwrap();
        let names: Vec<_> = listings.iter().map(|l| l.file_name.as_str()).collect();
        assert!(names.contains(&"Listed.tesina"));
        assert!(
            names.contains(&"Test Backup.tesina"),
            "wizard test archive listed"
        );
        assert!(!names.contains(&"notes.txt"));
        assert!(!names.contains(&"nested-dir"));
        assert!(!names.contains(&"Inner.tesina"), "never recurse");
        assert!(!names.contains(&"Link.tesina"), "skip symlinks");
        let listed = listings
            .iter()
            .find(|l| l.file_name == "Listed.tesina")
            .unwrap();
        assert_eq!(listed.byte_length, 5);
    }

    #[test]
    fn remove_archive_with_wrong_hash_refuses_and_keeps_file_and_ledger() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let sha = core
            .write_archive("Guarded.tesina", b"guarded bytes")
            .unwrap();
        core.confirm_archive("Guarded.tesina", &sha).unwrap();

        let error = core
            .remove_archive("Guarded.tesina", &sha256_hex(b"some other bytes"))
            .expect_err("wrong hash must refuse deletion");
        assert_eq!(error.code, BackupErrorCode::HashMismatch);
        assert!(subfolder_of(&fixture.selected_dir)
            .join("Guarded.tesina")
            .is_file());
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .any(|entry| entry.file_name == "Guarded.tesina"));
    }

    #[test]
    fn remove_archive_with_right_hash_deletes_file_and_ledger_entry() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let sha = core.write_archive("Old.tesina", b"old bytes").unwrap();
        core.confirm_archive("Old.tesina", &sha).unwrap();

        core.remove_archive("Old.tesina", &sha).unwrap();
        assert!(!subfolder_of(&fixture.selected_dir)
            .join("Old.tesina")
            .exists());
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .all(|entry| entry.file_name != "Old.tesina"));
        // The wizard test archive entry remains.
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .any(|entry| entry.file_name == "Test Backup.tesina"));
    }

    #[test]
    fn removal_keeps_a_new_file_that_arrives_after_quarantine() {
        let fixture = fixture();
        let path = fixture.selected_dir.join("Raced.tesina");
        fs::write(&path, b"recorded bytes").unwrap();
        let expected = sha256_hex(b"recorded bytes");

        quarantine_and_remove_archive(&path, &expected, |_| {
            fs::write(&path, b"new synced bytes")
                .map_err(|error| BackupError::io("test replacement failed", &error))
        })
        .unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new synced bytes");
        assert!(fs::read_dir(&fixture.selected_dir)
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".delete-")));
    }

    #[cfg(unix)]
    #[test]
    fn operations_denied_when_configured_folder_is_replaced_by_symlink() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);

        // Replace the authorized folder with a symlink to a different folder.
        let canonical = PathBuf::from(&active.canonical_folder_path);
        let moved = fixture._root.path().join("moved-away");
        fs::rename(&canonical, &moved).unwrap();
        std::os::unix::fs::symlink(&moved, &canonical).unwrap();

        let error = core
            .write_archive("Denied.tesina", b"x")
            .expect_err("symlinked folder must be denied");
        assert_eq!(error.code, BackupErrorCode::FolderUnavailable);
        let error = core.list_archives().expect_err("list denied");
        assert_eq!(error.code, BackupErrorCode::FolderUnavailable);
        let status = core.status();
        assert!(status.configured && !status.folder_available);
    }

    #[test]
    fn operations_report_folder_unavailable_when_folder_is_gone() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        fs::remove_dir_all(&fixture.selected_dir).unwrap();

        let error = core
            .write_archive("Gone.tesina", b"x")
            .expect_err("missing folder must be denied");
        assert_eq!(error.code, BackupErrorCode::FolderUnavailable);
        // Still configured (record loads) but unavailable, so UI can offer
        // Retry / Choose another folder.
        let reloaded = BackupDirectoryCore::new(fixture.app_data_dir.clone());
        let status = reloaded.status();
        assert!(status.configured && !status.folder_available);
    }

    #[test]
    fn disable_deletes_record_but_leaves_archives_and_ledger_file() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        core.write_archive("Kept.tesina", b"kept").unwrap();

        core.disable().unwrap();
        assert!(!fixture.app_data_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(
            fixture.app_data_dir.join(LEDGER_FILE_NAME).exists(),
            "ledger retained"
        );
        assert!(subfolder_of(&fixture.selected_dir)
            .join("Kept.tesina")
            .is_file());
        assert!(!core.status().configured);
        // Disabling twice stays idempotent.
        core.disable().unwrap();

        let reloaded = BackupDirectoryCore::new(fixture.app_data_dir.clone());
        assert!(!reloaded.status().configured);
    }

    #[test]
    fn operations_before_configuration_return_not_configured() {
        let fixture = fixture();
        let core = core(&fixture);
        for error in [
            core.write_archive("A.tesina", b"x").unwrap_err(),
            core.confirm_archive("A.tesina", "00").unwrap_err(),
            core.read_archive("A.tesina").unwrap_err(),
            core.list_archives().unwrap_err(),
            core.remove_archive("A.tesina", "00").unwrap_err(),
            core.ledger_entries().unwrap_err(),
        ] {
            assert_eq!(error.code, BackupErrorCode::NotConfigured);
        }
        let error = core.write_test_archive("A.tesina", b"x").unwrap_err();
        assert_eq!(error.code, BackupErrorCode::PendingMissing);
    }

    #[test]
    fn ledger_survives_reload_and_filters_by_backup_set_id() {
        let fixture = fixture();
        let core_instance = core(&fixture);
        let first = configure(&core_instance, &fixture.selected_dir);
        core_instance
            .write_archive("First Set.tesina", b"one")
            .unwrap();
        core_instance.disable().unwrap();

        // Re-enable into a second folder: fresh set id never matches old entries.
        let second_dir = fixture._root.path().join("SecondFolder");
        fs::create_dir_all(&second_dir).unwrap();
        let second = configure(&core_instance, &second_dir);
        assert_ne!(first.backup_set_id, second.backup_set_id);

        let reloaded = BackupDirectoryCore::new(fixture.app_data_dir.clone());
        let entries = reloaded.ledger_entries().unwrap();
        assert!(!entries.is_empty());
        assert!(entries
            .iter()
            .all(|entry| entry.backup_set_id == second.backup_set_id));
        assert!(entries
            .iter()
            .all(|entry| entry.file_name != "First Set.tesina"));

        // Old entries are retained on disk (never authorize a fresh set id).
        let raw = load_ledger(&fixture.app_data_dir);
        assert!(raw
            .entries
            .iter()
            .any(|entry| entry.backup_set_id == first.backup_set_id));
    }

    #[test]
    fn invalid_directory_record_loads_as_unconfigured() {
        let fixture = fixture();
        fs::write(
            fixture.app_data_dir.join(DIRECTORY_FILE_NAME),
            br#"{"schemaVersion":99,"canonicalFolderPath":"/x","backupSetId":"nope"}"#,
        )
        .unwrap();
        assert!(!core(&fixture).status().configured);

        fs::write(fixture.app_data_dir.join(DIRECTORY_FILE_NAME), b"not json").unwrap();
        assert!(!core(&fixture).status().configured);
    }

    #[test]
    fn rfc3339_formatting_is_correct() {
        assert_eq!(rfc3339_from_unix(0), "1970-01-01T00:00:00Z");
        // 2026-08-08 19:42:00 UTC
        assert_eq!(rfc3339_from_unix(1_786_218_120), "2026-08-08T19:42:00Z");
        assert_eq!(rfc3339_from_unix(951_827_696), "2000-02-29T12:34:56Z");
    }
}
