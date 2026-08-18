//! Rust-owned backup-directory adapter (OpenSpec `add-portable-library-backups`,
//! design decisions 8 and 10).
//!
//! Rust exclusively owns two atomic JSON records under the renderer-denied
//! app-cache authority subtree `.tesina-native`:
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
use std::ffi::OsStr;
use std::fs;
#[cfg(any(test, windows))]
use std::fs::OpenOptions;
use std::io::{ErrorKind, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

pub const BACKUP_SUBFOLDER_NAME: &str = "Tesina Backups";
const DIRECTORY_FILE_NAME: &str = "backup-directory.json";
const LEDGER_FILE_NAME: &str = "backup-ledger.json";
const CONTROL_DIRECTORY_NAME: &str = ".tesina-native";
const TRUST_TOKEN_FILE_NAME: &str = "backup-trust-token.bin";
const REAUTHORIZATION_FILE_NAME: &str = "backup-reauthorization-required";
const TRUST_TOKEN_BYTES: usize = 32;
const MAX_CONTROL_RECORD_BYTES: usize = 1024 * 1024;
const MAX_LEDGER_ENTRIES: usize = 1024;
// Provider directories are attacker-controlled input. Both list commands
// stream at most this many names, bounding native allocation, file opens, and
// the IPC response independently of the directory's actual size.
const MAX_ARCHIVE_LIST_ENTRIES: usize = 1024;
const ARCHIVE_EXTENSION: &str = ".tesina";
const MAX_FILE_NAME_LENGTH: usize = 120;
const SELECTED_FOLDER_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
// Seven desired retained backups, bounded failed-prune headroom, and one
// candidate awaiting validation. This still permits retention to recover
// after an earlier pruning failure leaves more than seven ledger entries.
const MAX_ACTIVE_ARCHIVE_COUNT: usize = 16;
// Setup validation needs only one pending test archive at a time.
const MAX_PENDING_TEST_ARCHIVE_COUNT: usize = 1;

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
    Unauthorized,
    InsideAppData,
    SymlinkRejected,
    InvalidFileName,
    NameTaken,
    HashMismatch,
    FileTooLarge,
    ResourceLimit,
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
    pub backup_set_id: String,
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
    pub requires_reauthorization: bool,
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
    backup_set_id: String,
    /// (file name, sha256) of every test archive written this pending session.
    test_archives: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
struct PendingArchiveOwnership {
    file_name: String,
    sha256: String,
    backup_set_id: String,
}

#[derive(Debug, Default)]
struct Inner {
    active: Option<ActiveState>,
    pending: Option<PendingState>,
    pending_archives: Vec<PendingArchiveOwnership>,
    requires_reauthorization: bool,
}

/// Plain core with no Tauri types; managed as Tauri state by `lib.rs`.
#[derive(Clone)]
pub struct BackupDirectoryCore {
    app_data_dir: PathBuf,
    app_cache_dir: PathBuf,
    #[cfg(test)]
    control_dir: PathBuf,
    control_store: Arc<NativeDirectoryAnchor>,
    state: Arc<Mutex<Inner>>,
    configuration_epoch: Arc<AtomicU64>,
    selected_operation_epoch: Arc<AtomicU64>,
    archive_body_admission: Arc<tokio::sync::Semaphore>,
    unsafe_mutations: Arc<SafePointBarrier>,
    local_commits: Arc<SafePointBarrier>,
}

#[derive(Clone, Debug)]
struct SelectedOperation {
    epoch: Arc<AtomicU64>,
    expected: u64,
}

impl SelectedOperation {
    fn checkpoint(&self) -> Result<(), BackupError> {
        if self.epoch.load(Ordering::SeqCst) != self.expected {
            return Err(BackupError::new(
                BackupErrorCode::Timeout,
                "the selected-folder operation was cancelled",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Default)]
struct SafePointBarrier {
    active: Mutex<usize>,
    safe: Condvar,
}

#[derive(Debug)]
struct SafePointGuard {
    barrier: Arc<SafePointBarrier>,
}

#[derive(Debug)]
struct AdmittedArchiveBody<T> {
    body: T,
    _permit: tokio::sync::OwnedSemaphorePermit,
}

impl SafePointBarrier {
    fn claim<F>(self: &Arc<Self>, validate: F) -> Result<SafePointGuard, BackupError>
    where
        F: FnOnce() -> Result<(), BackupError>,
    {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        validate()?;
        *active = active.saturating_add(1);
        Ok(SafePointGuard {
            barrier: self.clone(),
        })
    }

    fn wait_until_safe(&self) {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while *active != 0 {
            active = self
                .safe
                .wait(active)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }
}

impl Drop for SafePointGuard {
    fn drop(&mut self) {
        let mut active = self
            .barrier
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *active = active.saturating_sub(1);
        if *active == 0 {
            self.barrier.safe.notify_all();
        }
    }
}

struct ControlTrustBootstrap {
    control_store: NativeDirectoryAnchor,
    trusted: bool,
    requires_reauthorization: bool,
}

#[derive(Debug)]
struct NativeDirectoryAnchor {
    #[cfg_attr(all(unix, not(test)), allow(dead_code))]
    resolved_path: PathBuf,
    directory: fs::File,
    #[cfg(windows)]
    _ancestor_directories: Vec<fs::File>,
}

impl NativeDirectoryAnchor {
    fn open_or_create(parent: &Path, child_name: &str, label: &str) -> Result<Self, BackupError> {
        Self::open_or_create_observed(parent, child_name, label).map(|(anchor, _)| anchor)
    }

    fn open_or_create_observed(
        parent: &Path,
        child_name: &str,
        label: &str,
    ) -> Result<(Self, bool), BackupError> {
        Self::open_or_create_observed_with_hook(parent, child_name, label, || Ok(()))
    }

    #[cfg(test)]
    fn open_or_create_with_hook<F>(
        parent: &Path,
        child_name: &str,
        label: &str,
        before_open: F,
    ) -> Result<Self, BackupError>
    where
        F: FnOnce() -> Result<(), BackupError>,
    {
        Self::open_or_create_observed_with_hook(parent, child_name, label, before_open)
            .map(|(anchor, _)| anchor)
    }

    fn open_or_create_observed_with_hook<F>(
        parent: &Path,
        child_name: &str,
        label: &str,
        before_open: F,
    ) -> Result<(Self, bool), BackupError>
    where
        F: FnOnce() -> Result<(), BackupError>,
    {
        let child = Path::new(child_name);
        if child.parent() != Some(Path::new("")) || child.file_name() != Some(child.as_os_str()) {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "native directory name must be a bare child name",
            ));
        }
        let parent_metadata = fs::symlink_metadata(parent)
            .map_err(|error| BackupError::io(&format!("cannot inspect {label} parent"), &error))?;
        if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
            return Err(BackupError::new(
                BackupErrorCode::SymlinkRejected,
                format!("{label} parent is not a real directory"),
            ));
        }
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|error| BackupError::io(&format!("cannot resolve {label} parent"), &error))?;
        let resolved_path = canonical_parent.join(child_name);

        #[cfg(unix)]
        {
            use rustix::fs::{mkdirat, openat, Mode, OFlags};
            use rustix::io::Errno;

            let parent_directory = BackupSubfolderAnchor::open_directory(&canonical_parent)?;
            let preexisting =
                match mkdirat(&parent_directory, child_name, Mode::from_raw_mode(0o700)) {
                    Ok(()) => false,
                    Err(Errno::EXIST) => true,
                    Err(error) => {
                        return Err(BackupError::new(
                            BackupErrorCode::Io,
                            format!("cannot create {label}: {error}"),
                        ))
                    }
                };
            before_open()?;
            let directory = openat(
                &parent_directory,
                child_name,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
                Mode::empty(),
            )
            .map(fs::File::from)
            .map_err(|error| {
                let code = if matches!(error, Errno::LOOP | Errno::NOTDIR) {
                    BackupErrorCode::SymlinkRejected
                } else {
                    BackupErrorCode::Io
                };
                BackupError::new(code, format!("cannot hold {label}: {error}"))
            })?;
            return Ok((
                Self {
                    resolved_path,
                    directory,
                },
                preexisting,
            ));
        }

        #[cfg(windows)]
        {
            use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
            use windows::Win32::Storage::FileSystem::{
                FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
                FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
                FILE_SHARE_WRITE,
            };

            let (parent_directory, mut ancestors) =
                BackupSubfolderAnchor::open_windows_directory_chain(&canonical_parent)?;
            let preexisting = match fs::create_dir(&resolved_path) {
                Ok(()) => false,
                Err(error) if error.kind() == ErrorKind::AlreadyExists => true,
                Err(error) => {
                    return Err(BackupError::io(&format!("cannot create {label}"), &error))
                }
            };
            before_open()?;
            let mut options = OpenOptions::new();
            options
                .access_mode(FILE_READ_ATTRIBUTES.0)
                .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0);
            let directory = options
                .open(&resolved_path)
                .map_err(|error| BackupError::io(&format!("cannot hold {label}"), &error))?;
            let metadata = directory
                .metadata()
                .map_err(|error| BackupError::io(&format!("cannot inspect {label}"), &error))?;
            if !metadata.is_dir()
                || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
            {
                return Err(BackupError::new(
                    BackupErrorCode::SymlinkRejected,
                    format!("{label} is a reparse point or non-directory"),
                ));
            }
            ancestors.push(parent_directory);
            return Ok((
                Self {
                    resolved_path,
                    directory,
                    _ancestor_directories: ancestors,
                },
                preexisting,
            ));
        }

        #[cfg(not(any(unix, windows)))]
        {
            let preexisting = match fs::create_dir(&resolved_path) {
                Ok(()) => false,
                Err(error) if error.kind() == ErrorKind::AlreadyExists => true,
                Err(error) => {
                    return Err(BackupError::io(&format!("cannot create {label}"), &error))
                }
            };
            before_open()?;
            let metadata = fs::symlink_metadata(&resolved_path)
                .map_err(|error| BackupError::io(&format!("cannot inspect {label}"), &error))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(BackupError::new(
                    BackupErrorCode::SymlinkRejected,
                    format!("{label} is not a real directory"),
                ));
            }
            let directory = fs::File::open(&resolved_path)
                .map_err(|error| BackupError::io(&format!("cannot hold {label}"), &error))?;
            Ok((
                Self {
                    resolved_path,
                    directory,
                },
                preexisting,
            ))
        }
    }

    fn checked_name<'a>(&self, name: &'a str) -> Result<&'a OsStr, BackupError> {
        let path = Path::new(name);
        if path.parent() != Some(Path::new("")) || path.file_name() != Some(path.as_os_str()) {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "native control record must be a bare file name",
            ));
        }
        Ok(path.as_os_str())
    }

    #[cfg(unix)]
    fn child_exists(&self, name: &str) -> Result<bool, BackupError> {
        use rustix::fs::{statat, AtFlags};
        use rustix::io::Errno;

        match statat(
            &self.directory,
            self.checked_name(name)?,
            AtFlags::SYMLINK_NOFOLLOW,
        ) {
            Ok(_) => Ok(true),
            Err(Errno::NOENT) => Ok(false),
            Err(error) => Err(BackupError::new(
                BackupErrorCode::Io,
                format!("cannot inspect native control record: {error}"),
            )),
        }
    }

    #[cfg(not(unix))]
    fn child_exists(&self, name: &str) -> Result<bool, BackupError> {
        match fs::symlink_metadata(self.resolved_path.join(self.checked_name(name)?)) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(error) => Err(BackupError::io(
                "cannot inspect native control record",
                &error,
            )),
        }
    }

    #[cfg(unix)]
    fn open_child_read(&self, name: &str) -> Result<fs::File, BackupError> {
        use rustix::fs::{openat, Mode, OFlags};
        use rustix::io::Errno;

        openat(
            &self.directory,
            self.checked_name(name)?,
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map(fs::File::from)
        .map_err(|error| {
            let code = if matches!(error, Errno::LOOP | Errno::NOTDIR) {
                BackupErrorCode::SymlinkRejected
            } else {
                BackupErrorCode::Io
            };
            BackupError::new(code, format!("cannot open native control record: {error}"))
        })
    }

    #[cfg(windows)]
    fn open_child_read(&self, name: &str) -> Result<fs::File, BackupError> {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;

        OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(self.resolved_path.join(self.checked_name(name)?))
            .map_err(|error| BackupError::io("cannot open native control record", &error))
    }

    #[cfg(not(any(unix, windows)))]
    fn open_child_read(&self, name: &str) -> Result<fs::File, BackupError> {
        fs::File::open(self.resolved_path.join(self.checked_name(name)?))
            .map_err(|error| BackupError::io("cannot open native control record", &error))
    }

    #[cfg(unix)]
    fn create_child_new(&self, name: &str) -> Result<fs::File, BackupError> {
        use rustix::fs::{openat, Mode, OFlags};

        openat(
            &self.directory,
            self.checked_name(name)?,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::from_raw_mode(0o600),
        )
        .map(fs::File::from)
        .map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("cannot create native control record: {error}"),
            )
        })
    }

    #[cfg(not(unix))]
    fn create_child_new(&self, name: &str) -> Result<fs::File, BackupError> {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.resolved_path.join(self.checked_name(name)?))
            .map_err(|error| BackupError::io("cannot create native control record", &error))
    }

    fn read_child_bounded(
        &self,
        name: &str,
        max_bytes: usize,
    ) -> Result<Option<Vec<u8>>, BackupError> {
        if !self.child_exists(name)? {
            return Ok(None);
        }
        let file = self.open_child_read(name)?;
        let metadata = file
            .metadata()
            .map_err(|error| BackupError::io("cannot inspect native control record", &error))?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

            if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
                return Err(BackupError::new(
                    BackupErrorCode::SymlinkRejected,
                    "native control record is a reparse point",
                ));
            }
        }
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(BackupError::new(
                BackupErrorCode::SymlinkRejected,
                "native control record is not a regular file",
            ));
        }
        if metadata.len() > max_bytes as u64 {
            return Err(BackupError::new(
                BackupErrorCode::FileTooLarge,
                "native control record exceeds its bounded size limit",
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take((max_bytes as u64).saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|error| BackupError::io("cannot read native control record", &error))?;
        if bytes.len() > max_bytes {
            return Err(BackupError::new(
                BackupErrorCode::FileTooLarge,
                "native control record exceeds its bounded size limit",
            ));
        }
        Ok(Some(bytes))
    }

    fn write_child_new(&self, name: &str, bytes: &[u8]) -> Result<(), BackupError> {
        let mut file = self.create_child_new(name)?;
        file.write_all(bytes)
            .map_err(|error| BackupError::io("cannot write native control record", &error))?;
        file.sync_all()
            .map_err(|error| BackupError::io("cannot sync native control record", &error))?;
        self.sync_directory()
    }

    #[cfg(unix)]
    fn rename_replace(&self, from: &str, to: &str) -> Result<(), BackupError> {
        use rustix::fs::renameat;

        renameat(
            &self.directory,
            self.checked_name(from)?,
            &self.directory,
            self.checked_name(to)?,
        )
        .map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("cannot publish native control record: {error}"),
            )
        })?;
        self.sync_directory()
    }

    #[cfg(windows)]
    fn rename_replace(&self, from: &str, to: &str) -> Result<(), BackupError> {
        replace_path_atomic(
            &self.resolved_path.join(self.checked_name(from)?),
            &self.resolved_path.join(self.checked_name(to)?),
        )
    }

    #[cfg(not(any(unix, windows)))]
    fn rename_replace(&self, from: &str, to: &str) -> Result<(), BackupError> {
        fs::rename(
            self.resolved_path.join(self.checked_name(from)?),
            self.resolved_path.join(self.checked_name(to)?),
        )
        .map_err(|error| BackupError::io("cannot publish native control record", &error))
    }

    #[cfg(unix)]
    fn remove_child_if_present(&self, name: &str) -> Result<(), BackupError> {
        use rustix::fs::{unlinkat, AtFlags};
        use rustix::io::Errno;

        match unlinkat(&self.directory, self.checked_name(name)?, AtFlags::empty()) {
            Ok(()) => self.sync_directory(),
            Err(Errno::NOENT) => Ok(()),
            Err(error) => Err(BackupError::new(
                BackupErrorCode::Io,
                format!("cannot remove native control record: {error}"),
            )),
        }
    }

    #[cfg(not(unix))]
    fn remove_child_if_present(&self, name: &str) -> Result<(), BackupError> {
        match fs::remove_file(self.resolved_path.join(self.checked_name(name)?)) {
            Ok(()) => self.sync_directory(),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(BackupError::io(
                "cannot remove native control record",
                &error,
            )),
        }
    }

    #[cfg(unix)]
    fn sync_directory(&self) -> Result<(), BackupError> {
        self.directory
            .sync_all()
            .map_err(|error| BackupError::io("cannot sync native control directory", &error))
    }

    #[cfg(not(unix))]
    fn sync_directory(&self) -> Result<(), BackupError> {
        Ok(())
    }
}

fn path_exists_no_follow(path: &Path) -> Result<bool, BackupError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(BackupError::io(
            "cannot inspect native backup state",
            &error,
        )),
    }
}

fn quarantine_native_directory(parent: &Path, child_name: &str) -> Result<(), BackupError> {
    let path = parent.join(child_name);
    if !path_exists_no_follow(&path)? {
        return Ok(());
    }
    let quarantine_name = format!("{child_name}.untrusted-{}", Uuid::new_v4());
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| BackupError::io("cannot resolve native backup state parent", &error))?;

    #[cfg(unix)]
    {
        use rustix::fs::{renameat_with, RenameFlags};

        let canonical_target = fs::canonicalize(&path).ok();
        let aliases = fs::read_dir(&canonical_parent)
            .map_err(|error| BackupError::io("cannot inspect native backup aliases", &error))?;
        for entry in aliases {
            let candidate = entry
                .map_err(|error| BackupError::io("cannot inspect native backup alias", &error))?
                .path();
            if candidate.file_name() == Some(OsStr::new(child_name))
                || !fs::symlink_metadata(&candidate)
                    .map(|metadata| metadata.file_type().is_symlink())
                    .unwrap_or(false)
                || fs::canonicalize(&candidate).ok() != canonical_target
            {
                continue;
            }
            fs::remove_file(&candidate)
                .map_err(|error| BackupError::io("cannot retire native backup alias", &error))?;
            std::os::unix::fs::symlink(&quarantine_name, &candidate).map_err(|error| {
                BackupError::io(
                    "cannot bind native backup alias to quarantined evidence",
                    &error,
                )
            })?;
        }

        let parent_directory = BackupSubfolderAnchor::open_directory(&canonical_parent)?;
        renameat_with(
            &parent_directory,
            child_name,
            &parent_directory,
            &quarantine_name,
            RenameFlags::NOREPLACE,
        )
        .map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("cannot quarantine untrusted backup metadata: {error}"),
            )
        })?;
        return parent_directory
            .sync_all()
            .map_err(|error| BackupError::io("cannot sync native backup state parent", &error));
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

        let canonical_target = fs::canonicalize(&path).ok();
        let aliases = fs::read_dir(&canonical_parent)
            .map_err(|error| BackupError::io("cannot inspect native backup aliases", &error))?;
        for entry in aliases {
            let candidate = entry
                .map_err(|error| BackupError::io("cannot inspect native backup alias", &error))?
                .path();
            let metadata = match fs::symlink_metadata(&candidate) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if candidate.file_name() == Some(OsStr::new(child_name))
                || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 == 0
                || fs::canonicalize(&candidate).ok() != canonical_target
            {
                continue;
            }
            fs::remove_dir(&candidate)
                .map_err(|error| BackupError::io("cannot retire native backup alias", &error))?;
            std::os::windows::fs::symlink_dir(&quarantine_name, &candidate).map_err(|error| {
                BackupError::io(
                    "cannot bind native backup alias to quarantined evidence",
                    &error,
                )
            })?;
        }
        let (_parent, _ancestors) =
            BackupSubfolderAnchor::open_windows_directory_chain(&canonical_parent)?;
        return fs::rename(
            canonical_parent.join(child_name),
            canonical_parent.join(quarantine_name),
        )
        .map_err(|error| BackupError::io("cannot quarantine untrusted backup metadata", &error));
    }

    #[cfg(not(any(unix, windows)))]
    {
        fs::rename(
            canonical_parent.join(child_name),
            canonical_parent.join(quarantine_name),
        )
        .map_err(|error| BackupError::io("cannot quarantine untrusted backup metadata", &error))
    }
}

fn read_trust_token(
    directory: &NativeDirectoryAnchor,
) -> Result<Option<[u8; TRUST_TOKEN_BYTES]>, BackupError> {
    let bytes = match directory.read_child_bounded(TRUST_TOKEN_FILE_NAME, TRUST_TOKEN_BYTES) {
        Ok(bytes) => bytes,
        Err(error)
            if matches!(
                error.code,
                BackupErrorCode::FileTooLarge | BackupErrorCode::SymlinkRejected
            ) =>
        {
            return Ok(None)
        }
        Err(error) => return Err(error),
    };
    let Some(bytes) = bytes else {
        return Ok(None);
    };
    if bytes.len() != TRUST_TOKEN_BYTES {
        return Ok(None);
    }
    let mut token = [0_u8; TRUST_TOKEN_BYTES];
    token.copy_from_slice(&bytes);
    Ok(Some(token))
}

fn fresh_trust_token() -> [u8; TRUST_TOKEN_BYTES] {
    let mut token = [0_u8; TRUST_TOKEN_BYTES];
    token[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    token[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    token
}

fn write_trust_token(
    directory: &NativeDirectoryAnchor,
    token: &[u8; TRUST_TOKEN_BYTES],
) -> Result<(), BackupError> {
    directory.write_child_new(TRUST_TOKEN_FILE_NAME, token)
}

fn has_inert_legacy_metadata(app_data_dir: &Path) -> Result<bool, BackupError> {
    for file_name in [DIRECTORY_FILE_NAME, LEDGER_FILE_NAME] {
        let final_path = app_data_dir.join(file_name);
        let previous_path = app_data_dir.join(format!(".{file_name}.previous"));
        if path_exists_no_follow(&final_path)? || path_exists_no_follow(&previous_path)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn control_has_metadata(control_dir: &NativeDirectoryAnchor) -> Result<bool, BackupError> {
    for file_name in [DIRECTORY_FILE_NAME, LEDGER_FILE_NAME] {
        let previous = format!(".{file_name}.previous");
        if control_dir.child_exists(file_name)? || control_dir.child_exists(&previous)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn bootstrap_control_trust(
    app_data_dir: &Path,
    app_cache_dir: &Path,
) -> Result<ControlTrustBootstrap, BackupError> {
    let legacy_present = has_inert_legacy_metadata(app_data_dir)?;
    let (mut mirror_store, mirror_preexisting, mirror_recovered) =
        match NativeDirectoryAnchor::open_or_create_observed(
            app_data_dir,
            CONTROL_DIRECTORY_NAME,
            "native backup mirror directory",
        ) {
            Ok((store, preexisting)) => (store, preexisting, false),
            Err(_) => {
                quarantine_native_directory(app_data_dir, CONTROL_DIRECTORY_NAME)?;
                (
                    NativeDirectoryAnchor::open_or_create(
                        app_data_dir,
                        CONTROL_DIRECTORY_NAME,
                        "native backup mirror directory",
                    )?,
                    true,
                    true,
                )
            }
        };
    let (mut authority_store, authority_preexisting, authority_recovered) =
        match NativeDirectoryAnchor::open_or_create_observed(
            app_cache_dir,
            CONTROL_DIRECTORY_NAME,
            "native backup authority directory",
        ) {
            Ok((store, preexisting)) => (store, preexisting, false),
            Err(_) => {
                quarantine_native_directory(app_cache_dir, CONTROL_DIRECTORY_NAME)?;
                (
                    NativeDirectoryAnchor::open_or_create(
                        app_cache_dir,
                        CONTROL_DIRECTORY_NAME,
                        "native backup authority directory",
                    )?,
                    true,
                    true,
                )
            }
        };

    let mirror_token_present = mirror_store
        .child_exists(TRUST_TOKEN_FILE_NAME)
        .unwrap_or(true);
    let authority_token_present = authority_store
        .child_exists(TRUST_TOKEN_FILE_NAME)
        .unwrap_or(true);
    let mirror_token = read_trust_token(&mirror_store).ok().flatten();
    let authority_token = read_trust_token(&authority_store).ok().flatten();
    let mirror_has_metadata = control_has_metadata(&mirror_store).unwrap_or(true);
    let authority_has_metadata = control_has_metadata(&authority_store).unwrap_or(true);
    let tokens_match = authority_token.is_some() && authority_token == mirror_token;

    if tokens_match && !mirror_has_metadata {
        let marker_present = authority_store
            .child_exists(REAUTHORIZATION_FILE_NAME)
            .unwrap_or(true);
        let requires_reauthorization = marker_present
            || (legacy_present && !authority_has_metadata)
            || mirror_recovered
            || authority_recovered;
        if requires_reauthorization && !marker_present {
            authority_store.write_child_new(REAUTHORIZATION_FILE_NAME, &[1])?;
        }
        return Ok(ControlTrustBootstrap {
            control_store: authority_store,
            trusted: true,
            requires_reauthorization,
        });
    }

    let requires_reauthorization = legacy_present
        || mirror_has_metadata
        || authority_has_metadata
        || mirror_token_present
        || authority_token_present
        || mirror_preexisting
        || mirror_recovered
        || authority_preexisting
        || authority_recovered;

    if mirror_preexisting || mirror_has_metadata || mirror_token_present || mirror_recovered {
        drop(mirror_store);
        quarantine_native_directory(app_data_dir, CONTROL_DIRECTORY_NAME)?;
        mirror_store = NativeDirectoryAnchor::open_or_create(
            app_data_dir,
            CONTROL_DIRECTORY_NAME,
            "native backup mirror directory",
        )?;
    }
    if authority_preexisting
        || authority_has_metadata
        || authority_token_present
        || authority_recovered
    {
        drop(authority_store);
        quarantine_native_directory(app_cache_dir, CONTROL_DIRECTORY_NAME)?;
        authority_store = NativeDirectoryAnchor::open_or_create(
            app_cache_dir,
            CONTROL_DIRECTORY_NAME,
            "native backup authority directory",
        )?;
    }

    let token = fresh_trust_token();
    if requires_reauthorization {
        authority_store.write_child_new(REAUTHORIZATION_FILE_NAME, &[1])?;
    }
    write_trust_token(&authority_store, &token)?;
    // The AppData token is only a trust mirror. Live config and ledger records
    // are never loaded from this renderer-writable tree.
    write_trust_token(&mirror_store, &token)?;

    Ok(ControlTrustBootstrap {
        control_store: authority_store,
        trusted: false,
        requires_reauthorization,
    })
}

fn reset_unusable_trusted_control_state(
    app_data_dir: &Path,
    app_cache_dir: &Path,
    control_store: NativeDirectoryAnchor,
) -> Result<NativeDirectoryAnchor, BackupError> {
    drop(control_store);
    quarantine_native_directory(app_cache_dir, CONTROL_DIRECTORY_NAME)?;
    let authority_store = NativeDirectoryAnchor::open_or_create(
        app_cache_dir,
        CONTROL_DIRECTORY_NAME,
        "native backup authority directory",
    )?;

    let mirror_store = match NativeDirectoryAnchor::open_or_create(
        app_data_dir,
        CONTROL_DIRECTORY_NAME,
        "native backup mirror directory",
    ) {
        Ok(store) => store,
        Err(_) => {
            quarantine_native_directory(app_data_dir, CONTROL_DIRECTORY_NAME)?;
            NativeDirectoryAnchor::open_or_create(
                app_data_dir,
                CONTROL_DIRECTORY_NAME,
                "native backup mirror directory",
            )?
        }
    };
    let token = match read_trust_token(&mirror_store) {
        Ok(Some(token)) => token,
        Ok(None) | Err(_) => {
            drop(mirror_store);
            quarantine_native_directory(app_data_dir, CONTROL_DIRECTORY_NAME)?;
            let mirror_store = NativeDirectoryAnchor::open_or_create(
                app_data_dir,
                CONTROL_DIRECTORY_NAME,
                "native backup mirror directory",
            )?;
            let token = fresh_trust_token();
            write_trust_token(&mirror_store, &token)?;
            token
        }
    };

    authority_store.write_child_new(REAUTHORIZATION_FILE_NAME, &[1])?;
    write_trust_token(&authority_store, &token)?;
    Ok(authority_store)
}

impl BackupDirectoryCore {
    /// Loads the trust-bound native control records. Missing or unusable
    /// authorization is quarantined and starts unconfigured so backup-only
    /// corruption cannot prevent the editor from launching. A configured
    /// folder that is temporarily offline still loads so operations can report
    /// `folder_unavailable`.
    pub fn new(app_data_dir: PathBuf, app_cache_dir: PathBuf) -> Result<Self, BackupError> {
        fs::create_dir_all(&app_data_dir)
            .map_err(|error| BackupError::io("cannot create application data directory", &error))?;
        fs::create_dir_all(&app_cache_dir).map_err(|error| {
            BackupError::io("cannot create application cache directory", &error)
        })?;
        let bootstrap = bootstrap_control_trust(&app_data_dir, &app_cache_dir)?;
        let trusted = bootstrap.trusted;
        let mut control_store = bootstrap.control_store;
        let mut requires_reauthorization = bootstrap.requires_reauthorization;
        let active_result = if trusted {
            let ledger = load_ledger(&control_store);
            ledger.and_then(|ledger| {
                Ok(match load_directory_config(&control_store)? {
                    Some(config) => {
                        if !ledger
                            .entries
                            .iter()
                            .any(|entry| entry.backup_set_id == config.backup_set_id)
                        {
                            return Err(BackupError::new(
                                BackupErrorCode::Io,
                                "trusted backup authorization lacks matching validated ledger proof",
                            ));
                        }
                        if requires_reauthorization {
                            control_store
                                .remove_child_if_present(REAUTHORIZATION_FILE_NAME)?;
                            requires_reauthorization = false;
                        }
                        Some(ActiveState {
                            canonical_folder_path: PathBuf::from(config.canonical_folder_path),
                            backup_set_id: config.backup_set_id,
                        })
                    }
                    None => None,
                })
            })
        } else {
            Ok(None)
        };
        let active = match active_result {
            Ok(active) => active,
            Err(_) if trusted => {
                control_store = reset_unusable_trusted_control_state(
                    &app_data_dir,
                    &app_cache_dir,
                    control_store,
                )?;
                requires_reauthorization = true;
                None
            }
            Err(error) => return Err(error),
        };
        #[cfg(test)]
        let control_dir = control_store.resolved_path.clone();
        Ok(Self {
            app_data_dir,
            app_cache_dir,
            #[cfg(test)]
            control_dir,
            control_store: Arc::new(control_store),
            state: Arc::new(Mutex::new(Inner {
                active,
                pending: None,
                pending_archives: Vec::new(),
                requires_reauthorization,
            })),
            configuration_epoch: Arc::new(AtomicU64::new(0)),
            selected_operation_epoch: Arc::new(AtomicU64::new(0)),
            archive_body_admission: Arc::new(tokio::sync::Semaphore::new(1)),
            unsafe_mutations: Arc::new(SafePointBarrier::default()),
            local_commits: Arc::new(SafePointBarrier::default()),
        })
    }

    fn admit_archive_body<T, F>(
        &self,
        materialize: F,
    ) -> Result<AdmittedArchiveBody<T>, BackupError>
    where
        F: FnOnce() -> Result<T, BackupError>,
    {
        let permit = self.try_archive_body_admission()?;
        let body = materialize()?;
        Ok(AdmittedArchiveBody {
            body,
            _permit: permit,
        })
    }

    fn try_archive_body_admission(&self) -> Result<tokio::sync::OwnedSemaphorePermit, BackupError> {
        self.archive_body_admission
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                BackupError::new(
                    BackupErrorCode::ResourceLimit,
                    "another backup archive body is already in flight",
                )
            })
    }

    fn preflight_test_archive_write(&self, file_name: &str) -> Result<(), BackupError> {
        let canonical_folder_path = {
            let inner = self.lock();
            let pending = inner.pending.as_ref().ok_or_else(|| {
                BackupError::new(
                    BackupErrorCode::PendingMissing,
                    "no folder configuration is in progress",
                )
            })?;
            validate_automatic_archive_name(file_name, &pending.backup_set_id)?;
            if pending.test_archives.len() >= MAX_PENDING_TEST_ARCHIVE_COUNT {
                return Err(BackupError::new(
                    BackupErrorCode::ResourceLimit,
                    "the pending backup test archive limit has been reached",
                ));
            }
            pending.canonical_folder_path.clone()
        };
        let _subfolder = resolve_subfolder(&canonical_folder_path)?;
        Ok(())
    }

    fn preflight_active_archive_write(&self, file_name: &str) -> Result<(), BackupError> {
        let active = {
            let inner = self.lock();
            require_active(&inner)?.clone()
        };
        validate_automatic_archive_name(file_name, &active.backup_set_id)?;
        let subfolder = resolve_subfolder(&active.canonical_folder_path)?;
        if count_present_automatic_archives(
            &subfolder,
            &active.backup_set_id,
            MAX_ACTIVE_ARCHIVE_COUNT,
        )? >= MAX_ACTIVE_ARCHIVE_COUNT
        {
            return Err(BackupError::new(
                BackupErrorCode::ResourceLimit,
                "the active backup archive limit has been reached",
            ));
        }
        Ok(())
    }

    fn selected_operation(&self) -> SelectedOperation {
        SelectedOperation {
            epoch: self.selected_operation_epoch.clone(),
            expected: self.selected_operation_epoch.load(Ordering::SeqCst),
        }
    }

    fn cancel_current_operations(&self) {
        self.cancel_selected_folder_operations();
        self.invalidate_current_configuration_epoch();
    }

    fn claim_unsafe_mutation(
        &self,
        operation: &SelectedOperation,
    ) -> Result<SafePointGuard, BackupError> {
        self.unsafe_mutations.claim(|| operation.checkpoint())
    }

    fn claim_local_commit(
        &self,
        operation: &SelectedOperation,
    ) -> Result<SafePointGuard, BackupError> {
        self.local_commits.claim(|| operation.checkpoint())
    }

    fn claim_configuration_commit_guard(
        &self,
        expected: u64,
        operation: &SelectedOperation,
    ) -> Result<SafePointGuard, BackupError> {
        self.local_commits.claim(|| {
            operation.checkpoint()?;
            self.claim_configuration_commit(expected)
        })
    }

    async fn wait_for_local_commits(&self) -> Result<(), BackupError> {
        let local_commits = self.local_commits.clone();
        tauri::async_runtime::spawn_blocking(move || local_commits.wait_until_safe())
            .await
            .map_err(|error| {
                BackupError::new(
                    BackupErrorCode::Io,
                    format!("backup local-commit safe-point worker failed: {error}"),
                )
            })
    }

    async fn cancel_current_operations_and_wait(&self) -> Result<(), BackupError> {
        self.cancel_current_operations();
        let unsafe_mutations = self.unsafe_mutations.clone();
        let local_commits = self.local_commits.clone();
        tauri::async_runtime::spawn_blocking(move || {
            unsafe_mutations.wait_until_safe();
            local_commits.wait_until_safe();
        })
        .await
        .map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("backup cancellation safe-point worker failed: {error}"),
            )
        })
    }

    fn cancel_selected_folder_operations(&self) {
        self.selected_operation_epoch.fetch_add(1, Ordering::SeqCst);
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

    #[cfg(test)]
    fn begin_configuration_at_epoch(
        &self,
        path: &str,
        epoch: u64,
    ) -> Result<PendingConfiguration, BackupError> {
        let operation = self.selected_operation();
        self.begin_configuration_at_epoch_with_hook(path, epoch, &operation, || Ok(()))
    }

    fn begin_configuration_at_epoch_with_hook<G>(
        &self,
        path: &str,
        epoch: u64,
        operation: &SelectedOperation,
        before_create: G,
    ) -> Result<PendingConfiguration, BackupError>
    where
        G: FnOnce() -> Result<(), BackupError>,
    {
        operation.checkpoint()?;
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
        let authorized_identity = FileIdentity::from_path(&canonical)
            .map_err(|error| BackupError::io("cannot identify selected folder", &error))?;
        let current_canonical = fs::canonicalize(&selected)
            .map_err(|error| BackupError::io("selected folder changed before anchoring", &error))?;
        let current_identity = FileIdentity::from_path(&current_canonical).map_err(|error| {
            BackupError::io("cannot reidentify selected folder before anchoring", &error)
        })?;
        if current_canonical != canonical || current_identity != authorized_identity {
            return Err(BackupError::new(
                BackupErrorCode::Unauthorized,
                "the native picker selection changed before anchoring",
            ));
        }
        for storage_root in [&self.app_data_dir, &self.app_cache_dir] {
            let canonical_storage = fs::canonicalize(storage_root).map_err(|error| {
                BackupError::io(
                    "application storage directory cannot be canonicalized",
                    &error,
                )
            })?;
            if canonical == canonical_storage
                || canonical.starts_with(&canonical_storage)
                || canonical_storage.starts_with(&canonical)
            {
                return Err(BackupError::new(
                    BackupErrorCode::InsideAppData,
                    "a backup folder must live outside the application's own storage",
                ));
            }
        }
        operation.checkpoint()?;
        self.require_configuration_epoch(epoch)?;
        let selected_anchor = SelectedFolderAnchor::open(&canonical, &authorized_identity)?;
        operation.checkpoint()?;
        let _unsafe_mutation = self.claim_unsafe_mutation(operation)?;
        before_create()?;
        let subfolder = canonical.join(BACKUP_SUBFOLDER_NAME);
        selected_anchor.create_backup_subfolder()?;
        selected_anchor.revalidate()?;
        let subfolder = fs::canonicalize(&subfolder).map_err(|error| {
            BackupError::io("Tesina Backups subfolder cannot be canonicalized", &error)
        })?;

        let backup_set_id = Uuid::new_v4().to_string();
        let payload = PendingConfiguration {
            canonical_folder_path: canonical.to_string_lossy().into_owned(),
            backup_subfolder_path: subfolder.to_string_lossy().into_owned(),
            backup_set_id: backup_set_id.clone(),
        };
        let mut inner = self.lock();
        let _local_commit = self.claim_configuration_commit_guard(epoch, operation)?;
        inner.pending = Some(PendingState {
            canonical_folder_path: canonical,
            backup_set_id,
            test_archives: Vec::new(),
        });
        inner.pending_archives.clear();
        Ok(payload)
    }

    /// Writes a test archive exclusively into the PENDING subfolder and
    /// records it for this pending session. Returns the archive's sha256.
    #[cfg(test)]
    pub fn write_test_archive(&self, file_name: &str, bytes: &[u8]) -> Result<String, BackupError> {
        let operation = self.selected_operation();
        self.write_test_archive_at_operation(file_name, bytes, &operation)
    }

    fn write_test_archive_at_operation(
        &self,
        file_name: &str,
        bytes: &[u8],
        operation: &SelectedOperation,
    ) -> Result<String, BackupError> {
        operation.checkpoint()?;
        validate_file_name(file_name)?;
        let mut inner = self.lock();
        let pending = inner.pending.as_mut().ok_or_else(|| {
            BackupError::new(
                BackupErrorCode::PendingMissing,
                "no folder configuration is in progress",
            )
        })?;
        validate_automatic_archive_name(file_name, &pending.backup_set_id)?;
        if pending.test_archives.len() >= MAX_PENDING_TEST_ARCHIVE_COUNT {
            return Err(BackupError::new(
                BackupErrorCode::ResourceLimit,
                "the pending backup test archive limit has been reached",
            ));
        }
        let subfolder = resolve_subfolder(&pending.canonical_folder_path)?;
        operation.checkpoint()?;
        let _unsafe_mutation = self.claim_unsafe_mutation(operation)?;
        write_exclusive_with_hooks(
            &subfolder,
            file_name,
            bytes,
            || operation.checkpoint(),
            || operation.checkpoint(),
        )?;
        let sha = sha256_hex(bytes);
        if let Err(error) = operation.checkpoint() {
            let _ = cleanup_pending_archive(&subfolder, file_name, &sha);
            return Err(error);
        }
        let _local_commit = self.claim_local_commit(operation)?;
        pending
            .test_archives
            .push((file_name.to_owned(), sha.clone()));
        Ok(sha)
    }

    /// Requires a pending selection with at least one successful test write.
    /// Atomically activates the pending `backupSetId`, records its validated
    /// test archive(s), drops the previous authorization without touching old
    /// archive bytes, and clears pending.
    #[cfg(test)]
    fn activate_configuration(&self) -> Result<ActiveConfiguration, BackupError> {
        let epoch = self.start_configuration_operation();
        self.activate_configuration_at_epoch(epoch)
    }

    #[cfg(test)]
    fn activate_configuration_at_epoch(
        &self,
        epoch: u64,
    ) -> Result<ActiveConfiguration, BackupError> {
        let operation = self.selected_operation();
        self.activate_configuration_at_epoch_and_operation(epoch, &operation)
    }

    #[cfg(test)]
    fn activate_configuration_at_epoch_and_operation(
        &self,
        epoch: u64,
        operation: &SelectedOperation,
    ) -> Result<ActiveConfiguration, BackupError> {
        self.activate_configuration_at_epoch_and_operation_with_hook(epoch, operation, || Ok(()))
    }

    fn activate_configuration_at_epoch_and_operation_with_hook<F>(
        &self,
        epoch: u64,
        operation: &SelectedOperation,
        after_claim: F,
    ) -> Result<ActiveConfiguration, BackupError>
    where
        F: FnOnce() -> Result<(), BackupError>,
    {
        operation.checkpoint()?;
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
        let backup_set_id = pending.backup_set_id.clone();
        let canonical_folder_path = pending.canonical_folder_path.clone();
        let config = BackupDirectoryConfig {
            schema_version: 1,
            canonical_folder_path: canonical_folder_path.to_string_lossy().into_owned(),
            backup_set_id: backup_set_id.clone(),
        };
        let subfolder = resolve_subfolder(&canonical_folder_path)?;
        let mut validated_tests = Vec::with_capacity(pending.test_archives.len());
        for (file_name, expected_sha256) in &pending.test_archives {
            let current_sha256 = sha256_child_bounded(
                &subfolder,
                file_name,
                "cannot reopen test archive",
                MAX_ARCHIVE_BYTES,
            )?;
            if !current_sha256.eq_ignore_ascii_case(expected_sha256) {
                return Err(BackupError::new(
                    BackupErrorCode::HashMismatch,
                    "the validated test archive changed before activation",
                ));
            }
            validated_tests.push((file_name.clone(), current_sha256));
        }
        let created_at = rfc3339_now();
        let mut ledger = load_ledger(&self.control_store)?;
        if ledger
            .entries
            .len()
            .checked_add(validated_tests.len())
            .map_or(true, |length| length > MAX_LEDGER_ENTRIES)
        {
            return Err(BackupError::new(
                BackupErrorCode::ResourceLimit,
                "the native backup ledger entry limit has been reached",
            ));
        }
        for (file_name, sha256) in &validated_tests {
            ledger.entries.push(LedgerEntry {
                file_name: file_name.clone(),
                sha256: sha256.clone(),
                created_at: created_at.clone(),
                backup_set_id: backup_set_id.clone(),
            });
        }
        let _local_commit = self.claim_configuration_commit_guard(epoch, operation)?;
        after_claim()?;
        // The ledger is non-authorizing metadata. Persist it first so any
        // failure leaves setup inactive; once the authorization record lands,
        // both durable halves already describe the same backup set.
        write_json_atomic_with_hook(&self.control_store, LEDGER_FILE_NAME, &ledger, || Ok(()))?;
        write_json_atomic_with_hook(&self.control_store, DIRECTORY_FILE_NAME, &config, || Ok(()))?;
        self.control_store
            .remove_child_if_present(REAUTHORIZATION_FILE_NAME)?;

        inner.active = Some(ActiveState {
            canonical_folder_path: canonical_folder_path.clone(),
            backup_set_id: backup_set_id.clone(),
        });
        inner.pending = None;
        inner.pending_archives.clear();
        inner.requires_reauthorization = false;
        Ok(ActiveConfiguration {
            canonical_folder_path: canonical_folder_path.to_string_lossy().into_owned(),
            backup_set_id,
        })
    }

    /// Clears the pending selection only after removing every exact test file
    /// this pending session wrote. A failed cleanup remains pending so the UI
    /// can retry after the folder becomes available again.
    #[cfg(test)]
    pub fn cancel_configuration(&self) -> Result<(), BackupError> {
        let operation = self.selected_operation();
        self.cancel_configuration_at_operation(&operation)
    }

    fn cancel_configuration_at_operation(
        &self,
        operation: &SelectedOperation,
    ) -> Result<(), BackupError> {
        operation.checkpoint()?;
        self.invalidate_current_configuration_epoch();
        let mut inner = self.lock();
        if let Some(pending) = inner.pending.as_ref() {
            let subfolder = resolve_subfolder(&pending.canonical_folder_path)?;
            operation.checkpoint()?;
            let _unsafe_mutation = self.claim_unsafe_mutation(operation)?;
            for (file_name, expected_sha256) in &pending.test_archives {
                operation.checkpoint()?;
                validate_file_name(file_name)?;
                cleanup_pending_archive(&subfolder, file_name, expected_sha256)?;
            }
            operation.checkpoint()?;
            let _local_commit = self.claim_local_commit(operation)?;
            inner.pending = None;
        }
        Ok(())
    }

    // -- Post-configuration operations --------------------------------------

    /// Exclusive-create write of a new archive into the active subfolder.
    /// Never clobbers an existing file (`name_taken` on collision). Returns
    /// the Rust-computed authoritative sha256. The caller must reopen and
    /// validate the archive before `confirm_archive` records it in the ledger.
    #[cfg(test)]
    pub fn write_archive(&self, file_name: &str, bytes: &[u8]) -> Result<String, BackupError> {
        let operation = self.selected_operation();
        self.write_archive_at_operation(file_name, bytes, &operation)
    }

    fn write_archive_at_operation(
        &self,
        file_name: &str,
        bytes: &[u8],
        operation: &SelectedOperation,
    ) -> Result<String, BackupError> {
        operation.checkpoint()?;
        validate_file_name(file_name)?;
        let mut inner = self.lock();
        let active = require_active(&inner)?;
        let backup_set_id = active.backup_set_id.clone();
        let canonical_folder_path = active.canonical_folder_path.clone();
        validate_automatic_archive_name(file_name, &backup_set_id)?;
        let subfolder = resolve_subfolder(&canonical_folder_path)?;
        let owned_count =
            count_present_automatic_archives(&subfolder, &backup_set_id, MAX_ACTIVE_ARCHIVE_COUNT)?;
        if owned_count >= MAX_ACTIVE_ARCHIVE_COUNT {
            return Err(BackupError::new(
                BackupErrorCode::ResourceLimit,
                "the active backup archive limit has been reached",
            ));
        }
        operation.checkpoint()?;
        let _unsafe_mutation = self.claim_unsafe_mutation(operation)?;
        write_exclusive_with_hooks(
            &subfolder,
            file_name,
            bytes,
            || operation.checkpoint(),
            || operation.checkpoint(),
        )?;
        let sha = sha256_hex(bytes);
        if let Err(error) = operation.checkpoint() {
            let _ = quarantine_and_remove_archive(&subfolder, file_name, &sha, |_| Ok(()));
            return Err(error);
        }
        let _local_commit = self.claim_local_commit(operation)?;
        inner.pending_archives.retain(|pending| {
            pending.file_name != file_name || pending.backup_set_id != backup_set_id
        });
        inner.pending_archives.push(PendingArchiveOwnership {
            file_name: file_name.to_owned(),
            sha256: sha.clone(),
            backup_set_id,
        });
        Ok(sha)
    }

    /// Records a written archive only after the TypeScript caller has reopened
    /// and fully validated it. The current bytes are hashed again here so the
    /// ledger can never authorize retention of different or truncated bytes.
    #[cfg(test)]
    pub fn confirm_archive(
        &self,
        file_name: &str,
        expected_sha256: &str,
    ) -> Result<(), BackupError> {
        let operation = self.selected_operation();
        self.confirm_archive_at_operation(file_name, expected_sha256, &operation)
    }

    fn confirm_archive_at_operation(
        &self,
        file_name: &str,
        expected_sha256: &str,
        operation: &SelectedOperation,
    ) -> Result<(), BackupError> {
        operation.checkpoint()?;
        validate_file_name(file_name)?;
        let inner = self.lock();
        let active = require_active(&inner)?;
        let backup_set_id = active.backup_set_id.clone();
        let pending = inner
            .pending_archives
            .iter()
            .find(|pending| {
                pending.file_name == file_name && pending.backup_set_id == backup_set_id
            })
            .ok_or_else(|| {
                BackupError::new(
                    BackupErrorCode::Unauthorized,
                    "the archive is not a native pending write for the active backup set",
                )
            })?;
        if !pending.sha256.eq_ignore_ascii_case(expected_sha256) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the confirmation digest does not match the native pending write",
            ));
        }
        let subfolder = resolve_subfolder(&active.canonical_folder_path)?;
        let current = sha256_child_bounded(
            &subfolder,
            file_name,
            "cannot reopen archive for confirmation",
            MAX_ARCHIVE_BYTES,
        )?;
        if !current.eq_ignore_ascii_case(expected_sha256) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the validated archive bytes changed before ledger confirmation",
            ));
        }
        let mut ledger = load_ledger(&self.control_store)?;
        ledger.entries.retain(|entry| {
            !(entry.file_name == file_name && entry.backup_set_id == backup_set_id)
        });
        if ledger.entries.len() >= MAX_LEDGER_ENTRIES {
            return Err(BackupError::new(
                BackupErrorCode::ResourceLimit,
                "the native backup ledger entry limit has been reached",
            ));
        }
        ledger.entries.push(LedgerEntry {
            file_name: file_name.to_owned(),
            sha256: current,
            created_at: rfc3339_now(),
            backup_set_id: backup_set_id.clone(),
        });
        let _local_commit = self.claim_local_commit(operation)?;
        write_json_atomic_with_hook(&self.control_store, LEDGER_FILE_NAME, &ledger, || Ok(()))?;
        let mut inner = inner;
        inner.pending_archives.retain(|pending| {
            pending.file_name != file_name || pending.backup_set_id != backup_set_id
        });
        drop(inner);
        Ok(())
    }

    #[cfg(test)]
    fn discard_pending_archive(
        &self,
        file_name: &str,
        expected_sha256: &str,
    ) -> Result<(), BackupError> {
        let operation = self.selected_operation();
        self.discard_pending_archive_at_operation(file_name, expected_sha256, &operation)
    }

    fn discard_pending_archive_at_operation(
        &self,
        file_name: &str,
        expected_sha256: &str,
        operation: &SelectedOperation,
    ) -> Result<(), BackupError> {
        operation.checkpoint()?;
        validate_file_name(file_name)?;
        let mut inner = self.lock();
        let active = require_active(&inner)?;
        let backup_set_id = active.backup_set_id.clone();
        let canonical_folder_path = active.canonical_folder_path.clone();
        let pending_sha256 = inner
            .pending_archives
            .iter()
            .find(|pending| {
                pending.file_name == file_name && pending.backup_set_id == backup_set_id
            })
            .map(|pending| pending.sha256.clone())
            .ok_or_else(|| {
                BackupError::new(
                    BackupErrorCode::Unauthorized,
                    "the archive is not a native pending write for the active backup set",
                )
            })?;
        if !pending_sha256.eq_ignore_ascii_case(expected_sha256) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the discard digest does not match the native pending write",
            ));
        }
        let subfolder = resolve_subfolder(&canonical_folder_path)?;
        operation.checkpoint()?;
        let _unsafe_mutation = self.claim_unsafe_mutation(operation)?;
        quarantine_and_remove_archive_with_hooks(
            &subfolder,
            file_name,
            &pending_sha256,
            |_| operation.checkpoint(),
            |_| operation.checkpoint(),
        )?;
        operation.checkpoint()?;
        let _local_commit = self.claim_local_commit(operation)?;
        inner.pending_archives.retain(|pending| {
            pending.file_name != file_name || pending.backup_set_id != backup_set_id
        });
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
        subfolder: &BackupSubfolderAnchor,
        file_name: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>, BackupError> {
        Self::read_archive_file_with_hook(subfolder, file_name, max_bytes, || Ok(()))
    }

    fn read_archive_file_with_hook<F>(
        subfolder: &BackupSubfolderAnchor,
        file_name: &str,
        max_bytes: usize,
        before_open: F,
    ) -> Result<Vec<u8>, BackupError>
    where
        F: FnOnce() -> Result<(), BackupError>,
    {
        before_open()?;
        let file = subfolder.open_child_read(file_name, "archive")?;
        ensure_regular_file(&file, "the requested archive is not a regular file")?;
        let metadata = file
            .metadata()
            .map_err(|error| BackupError::io("cannot inspect archive", &error))?;
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

    /// Non-recursive, name-only enumeration of `*.tesina` entries in the
    /// active subfolder. Entries are not opened or inspected so provider
    /// placeholders remain discoverable for ledger-first retention.
    pub fn list_archive_names(&self) -> Result<Vec<String>, BackupError> {
        let active_path = {
            let inner = self.lock();
            require_active(&inner)?.canonical_folder_path.clone()
        };
        let subfolder = resolve_subfolder(&active_path)?;
        let mut names = Vec::new();
        subfolder.for_each_entry_name_bounded(MAX_ARCHIVE_LIST_ENTRIES, |name| {
            if let Some(name) = name
                .to_str()
                .filter(|name| name.ends_with(ARCHIVE_EXTENSION))
            {
                names.push(name.to_owned());
            }
            Ok(())
        })?;
        names.sort();
        Ok(names)
    }

    pub fn list_archives(&self) -> Result<Vec<ArchiveListing>, BackupError> {
        let active_path = {
            let inner = self.lock();
            require_active(&inner)?.canonical_folder_path.clone()
        };
        let subfolder = resolve_subfolder(&active_path)?;
        let mut listings = Vec::new();
        subfolder.for_each_entry_name_bounded(MAX_ARCHIVE_LIST_ENTRIES, |name| {
            let name = match name.to_str() {
                Some(name) if name.ends_with(ARCHIVE_EXTENSION) => name,
                _ => return Ok(()),
            };
            let file = match subfolder.open_child_read(&name, "archive listing candidate") {
                Ok(file) => file,
                Err(_) => return Ok(()),
            };
            let metadata = match file.metadata() {
                Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                    metadata
                }
                _ => return Ok(()),
            };
            let byte_length = metadata.len();
            listings.push(ArchiveListing {
                file_name: name.to_owned(),
                byte_length,
            });
            Ok(())
        })?;
        listings.sort_by(|a, b| a.file_name.cmp(&b.file_name));
        Ok(listings)
    }

    /// Deletes an archive only after recomputing its current sha256 and
    /// matching it against `expected_sha256`. On success also drops the
    /// matching ledger entry.
    #[cfg(test)]
    pub fn remove_archive(
        &self,
        file_name: &str,
        expected_sha256: &str,
    ) -> Result<(), BackupError> {
        let operation = self.selected_operation();
        self.remove_archive_at_operation(file_name, expected_sha256, &operation)
    }

    fn remove_archive_at_operation(
        &self,
        file_name: &str,
        expected_sha256: &str,
        operation: &SelectedOperation,
    ) -> Result<(), BackupError> {
        operation.checkpoint()?;
        validate_file_name(file_name)?;
        let inner = self.lock();
        let active = require_active(&inner)?;
        let backup_set_id = active.backup_set_id.clone();
        let subfolder = resolve_subfolder(&active.canonical_folder_path)?;
        let mut ledger = load_ledger(&self.control_store)?;
        let owned = ledger
            .entries
            .iter()
            .find(|entry| entry.file_name == file_name && entry.backup_set_id == backup_set_id);
        let owned = owned.ok_or_else(|| {
            BackupError::new(
                BackupErrorCode::Unauthorized,
                "retention can remove only a current-set ledger-owned archive",
            )
        })?;
        if !owned.sha256.eq_ignore_ascii_case(expected_sha256) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the retention digest does not match the current-set ledger entry",
            ));
        }
        operation.checkpoint()?;
        let _unsafe_mutation = self.claim_unsafe_mutation(operation)?;
        quarantine_and_remove_archive_with_hooks(
            &subfolder,
            file_name,
            expected_sha256,
            |_| operation.checkpoint(),
            |_| operation.checkpoint(),
        )?;
        operation.checkpoint()?;
        let _local_commit = self.claim_local_commit(operation)?;
        ledger.entries.retain(|entry| {
            !(entry.file_name == file_name && entry.backup_set_id == backup_set_id)
        });
        write_json_atomic_with_hook(&self.control_store, LEDGER_FILE_NAME, &ledger, || Ok(()))?;
        drop(inner);
        Ok(())
    }

    /// Ledger entries belonging to the CURRENT `backupSetId` only.
    pub fn ledger_entries(&self) -> Result<Vec<LedgerEntry>, BackupError> {
        let inner = self.lock();
        let active = require_active(&inner)?;
        let ledger = load_ledger(&self.control_store)?;
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
                requires_reauthorization: inner.requires_reauthorization,
            },
            None => BackupStatus {
                configured: false,
                folder_path: None,
                backup_set_id: None,
                folder_available: false,
                requires_reauthorization: inner.requires_reauthorization,
            },
        }
    }

    /// Deletes `backup-directory.json` and drops the active authorization.
    /// The ledger file is retained: it only ever authorizes pruning of
    /// matching set ids, and a fresh set id never matches old entries.
    pub fn disable(&self) -> Result<(), BackupError> {
        self.invalidate_current_configuration_epoch();
        let mut inner = self.lock();
        self.control_store
            .remove_child_if_present(DIRECTORY_FILE_NAME)?;
        self.control_store
            .remove_child_if_present(REAUTHORIZATION_FILE_NAME)?;
        inner.active = None;
        inner.pending = None;
        inner.pending_archives.clear();
        inner.requires_reauthorization = false;
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

#[derive(Debug)]
struct SelectedFolderAnchor {
    logical_path: PathBuf,
    resolved_path: PathBuf,
    directory: fs::File,
    identity: FileIdentity,
    #[cfg(windows)]
    _ancestor_directories: Vec<fs::File>,
}

impl SelectedFolderAnchor {
    fn open(canonical: &Path, authorized_identity: &FileIdentity) -> Result<Self, BackupError> {
        #[cfg(windows)]
        let (directory, ancestor_directories) =
            BackupSubfolderAnchor::open_windows_directory_chain(canonical)?;
        #[cfg(not(windows))]
        let directory = BackupSubfolderAnchor::open_directory(canonical)?;
        let identity = directory
            .try_clone()
            .and_then(FileIdentity::from_file)
            .map_err(|error| BackupError::io("cannot hold selected backup folder", &error))?;
        if &identity != authorized_identity {
            return Err(BackupError::new(
                BackupErrorCode::Unauthorized,
                "the selected backup folder changed after picker authorization",
            ));
        }
        let anchor = Self {
            logical_path: canonical.to_path_buf(),
            resolved_path: canonical.to_path_buf(),
            directory,
            identity,
            #[cfg(windows)]
            _ancestor_directories: ancestor_directories,
        };
        anchor.revalidate()?;
        Ok(anchor)
    }

    fn revalidate(&self) -> Result<(), BackupError> {
        let current = fs::canonicalize(&self.logical_path).map_err(|error| {
            BackupError::io(
                "selected backup folder changed during configuration",
                &error,
            )
        })?;
        let current_identity = FileIdentity::from_path(&current)
            .map_err(|error| BackupError::io("cannot reidentify selected backup folder", &error))?;
        if current != self.resolved_path || current_identity != self.identity {
            return Err(BackupError::new(
                BackupErrorCode::Unauthorized,
                "the selected backup folder changed during configuration",
            ));
        }
        Ok(())
    }

    #[cfg(unix)]
    fn create_backup_subfolder(&self) -> Result<(), BackupError> {
        use rustix::fs::{mkdirat, Mode};
        use rustix::io::Errno;

        match mkdirat(
            &self.directory,
            BACKUP_SUBFOLDER_NAME,
            Mode::from_raw_mode(0o777),
        ) {
            Ok(()) | Err(Errno::EXIST) => {}
            Err(error) => {
                return Err(BackupError::new(
                    BackupErrorCode::Io,
                    format!("cannot create the Tesina Backups subfolder: {error}"),
                ))
            }
        }
        use rustix::fs::{openat, OFlags};
        openat(
            &self.directory,
            BACKUP_SUBFOLDER_NAME,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map(|_| ())
        .map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("Tesina Backups is not a real subfolder: {error}"),
            )
        })
    }

    #[cfg(not(unix))]
    fn create_backup_subfolder(&self) -> Result<(), BackupError> {
        let subfolder = self.resolved_path.join(BACKUP_SUBFOLDER_NAME);
        match fs::create_dir(&subfolder) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(BackupError::io(
                    "cannot create the Tesina Backups subfolder",
                    &error,
                ))
            }
        }
        let metadata = fs::symlink_metadata(&subfolder)
            .map_err(|error| BackupError::io("cannot inspect backup subfolder", &error))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(BackupError::new(
                BackupErrorCode::SymlinkRejected,
                "Tesina Backups is not a real subfolder",
            ));
        }
        Ok(())
    }
}

/// Held authorization anchor for the exact `Tesina Backups` directory.
///
/// Unix child operations are handle-relative, so renaming or replacing the
/// public directory path cannot redirect an operation after validation.
/// Windows holds every canonical ancestor without `FILE_SHARE_DELETE`, which
/// prevents the directory chain from being renamed or deleted while child
/// operations use the stable resolved path.
#[derive(Debug)]
struct BackupSubfolderAnchor {
    logical_path: PathBuf,
    #[cfg(not(unix))]
    resolved_path: PathBuf,
    directory: fs::File,
    #[cfg(windows)]
    _ancestor_directories: Vec<fs::File>,
}

impl BackupSubfolderAnchor {
    fn open(stored_canonical_folder: &Path) -> Result<Self, BackupError> {
        Self::open_with_hook(stored_canonical_folder, || Ok(()))
    }

    fn open_with_hook<F>(
        stored_canonical_folder: &Path,
        before_open: F,
    ) -> Result<Self, BackupError>
    where
        F: FnOnce() -> Result<(), BackupError>,
    {
        let unavailable =
            |detail: &str| BackupError::new(BackupErrorCode::FolderUnavailable, detail);

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

        let logical_path = stored_canonical_folder.join(BACKUP_SUBFOLDER_NAME);
        let subfolder_metadata = fs::symlink_metadata(&logical_path)
            .map_err(|_| unavailable("the Tesina Backups subfolder is not accessible"))?;
        if subfolder_metadata.file_type().is_symlink() || !subfolder_metadata.is_dir() {
            return Err(unavailable(
                "the Tesina Backups subfolder is no longer a real directory",
            ));
        }
        let resolved_path = fs::canonicalize(&logical_path)
            .map_err(|_| unavailable("the Tesina Backups subfolder cannot be canonicalized"))?;
        if resolved_path != logical_path {
            return Err(unavailable(
                "the Tesina Backups subfolder no longer resolves to its authorized identity",
            ));
        }

        let preopen_identity = FileIdentity::from_path(&resolved_path).map_err(|error| {
            BackupError::io("cannot identify the validated backup subfolder", &error)
        })?;
        before_open()?;

        #[cfg(windows)]
        let (directory, ancestor_directories) = Self::open_windows_directory_chain(&resolved_path)?;
        #[cfg(not(windows))]
        let directory = Self::open_directory(&resolved_path)?;

        let held_identity = directory
            .try_clone()
            .and_then(FileIdentity::from_file)
            .map_err(|error| BackupError::io("cannot identify the backup subfolder", &error))?;
        let current_path = fs::canonicalize(&logical_path).map_err(|_| {
            unavailable("the Tesina Backups subfolder changed during authorization")
        })?;
        let current_identity = FileIdentity::from_path(&current_path).map_err(|error| {
            BackupError::io("cannot identify the current backup subfolder", &error)
        })?;
        if held_identity != preopen_identity
            || current_path != resolved_path
            || held_identity != current_identity
        {
            return Err(unavailable(
                "the Tesina Backups subfolder changed during authorization",
            ));
        }

        Ok(Self {
            logical_path,
            #[cfg(not(unix))]
            resolved_path,
            directory,
            #[cfg(windows)]
            _ancestor_directories: ancestor_directories,
        })
    }

    #[cfg(unix)]
    fn open_directory(path: &Path) -> Result<fs::File, BackupError> {
        use rustix::fs::{openat, Mode, OFlags, CWD};

        openat(
            CWD,
            path,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map(fs::File::from)
        .map_err(|error| {
            BackupError::new(
                BackupErrorCode::FolderUnavailable,
                format!("cannot hold the Tesina Backups subfolder: {error}"),
            )
        })
    }

    #[cfg(windows)]
    fn open_windows_directory(path: &Path) -> Result<fs::File, BackupError> {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };

        let mut options = OpenOptions::new();
        options
            .access_mode(FILE_READ_ATTRIBUTES.0)
            .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0);
        options.open(path).map_err(|error| {
            BackupError::io("cannot hold the configured backup directory chain", &error)
        })
    }

    #[cfg(windows)]
    fn open_windows_directory_chain(path: &Path) -> Result<(fs::File, Vec<fs::File>), BackupError> {
        let mut directories = path.ancestors().collect::<Vec<_>>();
        directories.reverse();
        let mut handles = directories
            .into_iter()
            .map(Self::open_windows_directory)
            .collect::<Result<Vec<_>, _>>()?;
        let directory = handles.pop().ok_or_else(|| {
            BackupError::new(
                BackupErrorCode::FolderUnavailable,
                "the configured backup directory has no stable anchor",
            )
        })?;
        Ok((directory, handles))
    }

    #[cfg(not(any(unix, windows)))]
    fn open_directory(path: &Path) -> Result<fs::File, BackupError> {
        fs::File::open(path)
            .map_err(|error| BackupError::io("cannot hold the Tesina Backups subfolder", &error))
    }

    fn checked_name<'a>(&self, name: &'a str) -> Result<&'a OsStr, BackupError> {
        let name = Path::new(name);
        if name.parent() != Some(Path::new("")) || name.file_name() != Some(name.as_os_str()) {
            return Err(BackupError::new(
                BackupErrorCode::InvalidFileName,
                "archive path must be a bare file name",
            ));
        }
        Ok(name.as_os_str())
    }

    #[cfg(not(unix))]
    fn resolved_child(&self, name: &str) -> Result<PathBuf, BackupError> {
        Ok(self.resolved_path.join(self.checked_name(name)?))
    }

    #[cfg(unix)]
    fn create_child_new(&self, name: &str, label: &str) -> Result<fs::File, BackupError> {
        use rustix::fs::{openat, Mode, OFlags};

        openat(
            &self.directory,
            self.checked_name(name)?,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::from_raw_mode(0o666),
        )
        .map(fs::File::from)
        .map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("cannot create {label}: {error}"),
            )
        })
    }

    #[cfg(not(unix))]
    fn create_child_new(&self, name: &str, label: &str) -> Result<fs::File, BackupError> {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.resolved_child(name)?)
            .map_err(|error| BackupError::io(&format!("cannot create {label}"), &error))
    }

    #[cfg(unix)]
    fn open_child_read(&self, name: &str, label: &str) -> Result<fs::File, BackupError> {
        use rustix::fs::{openat, Mode, OFlags};

        openat(
            &self.directory,
            self.checked_name(name)?,
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map(fs::File::from)
        .map_err(|error| {
            BackupError::new(BackupErrorCode::Io, format!("cannot open {label}: {error}"))
        })
    }

    #[cfg(windows)]
    fn open_child_read(&self, name: &str, label: &str) -> Result<fs::File, BackupError> {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;

        OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(self.resolved_child(name)?)
            .map_err(|error| BackupError::io(&format!("cannot open {label}"), &error))
    }

    #[cfg(not(any(unix, windows)))]
    fn open_child_read(&self, name: &str, label: &str) -> Result<fs::File, BackupError> {
        fs::File::open(self.resolved_child(name)?)
            .map_err(|error| BackupError::io(&format!("cannot open {label}"), &error))
    }

    #[cfg(unix)]
    fn child_exists(&self, name: &str) -> Result<bool, BackupError> {
        use rustix::fs::{statat, AtFlags};
        use rustix::io::Errno;

        match statat(
            &self.directory,
            self.checked_name(name)?,
            AtFlags::SYMLINK_NOFOLLOW,
        ) {
            Ok(_) => Ok(true),
            Err(Errno::NOENT) => Ok(false),
            Err(error) => Err(BackupError::new(
                BackupErrorCode::Io,
                format!("cannot inspect archive path: {error}"),
            )),
        }
    }

    fn child_identity(&self, name: &str, label: &str) -> Result<FileIdentity, BackupError> {
        let file = self.open_child_read(name, label)?;
        ensure_regular_file(&file, &format!("{label} is not a regular file"))?;
        FileIdentity::from_file(file)
            .map_err(|error| BackupError::io(&format!("cannot identify {label}"), &error))
    }

    fn ensure_child_identity(
        &self,
        name: &str,
        expected: &FileIdentity,
        label: &str,
    ) -> Result<(), BackupError> {
        if &self.child_identity(name, label)? != expected {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                format!("{label} pathname now belongs to another file"),
            ));
        }
        Ok(())
    }

    #[cfg(not(unix))]
    fn child_exists(&self, name: &str) -> Result<bool, BackupError> {
        match fs::symlink_metadata(self.resolved_child(name)?) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(error) => Err(BackupError::io("cannot inspect archive path", &error)),
        }
    }

    #[cfg(unix)]
    fn for_each_entry_name_bounded<F>(
        &self,
        max_entries: usize,
        mut visit: F,
    ) -> Result<(), BackupError>
    where
        F: FnMut(&OsStr) -> Result<(), BackupError>,
    {
        use rustix::fs::Dir;
        use std::os::unix::ffi::OsStrExt;

        let entries = Dir::read_from(&self.directory).map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("cannot list the Tesina Backups subfolder: {error}"),
            )
        })?;
        let mut seen = 0_usize;
        for entry in entries {
            let entry = entry.map_err(|error| {
                BackupError::new(
                    BackupErrorCode::Io,
                    format!("cannot read backup directory entry: {error}"),
                )
            })?;
            if seen >= max_entries {
                return Err(BackupError::new(
                    BackupErrorCode::ResourceLimit,
                    "the backup folder contains too many entries to list safely",
                ));
            }
            seen += 1;
            visit(OsStr::from_bytes(entry.file_name().to_bytes()))?;
        }
        Ok(())
    }

    #[cfg(not(unix))]
    fn for_each_entry_name_bounded<F>(
        &self,
        max_entries: usize,
        mut visit: F,
    ) -> Result<(), BackupError>
    where
        F: FnMut(&OsStr) -> Result<(), BackupError>,
    {
        let entries = fs::read_dir(&self.resolved_path)
            .map_err(|error| BackupError::io("cannot list the Tesina Backups subfolder", &error))?;
        let mut seen = 0_usize;
        for entry in entries {
            let name = entry
                .map_err(|error| BackupError::io("cannot read backup directory entry", &error))?
                .file_name();
            if seen >= max_entries {
                return Err(BackupError::new(
                    BackupErrorCode::ResourceLimit,
                    "the backup folder contains too many entries to list safely",
                ));
            }
            seen += 1;
            visit(&name)?;
        }
        Ok(())
    }

    #[cfg(unix)]
    fn count_entry_names_matching<F>(
        &self,
        stop_at: usize,
        mut matches: F,
    ) -> Result<usize, BackupError>
    where
        F: FnMut(&OsStr) -> bool,
    {
        use rustix::fs::Dir;
        use std::os::unix::ffi::OsStrExt;

        let entries = Dir::read_from(&self.directory).map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("cannot list the Tesina Backups subfolder: {error}"),
            )
        })?;
        let mut count = 0_usize;
        for entry in entries {
            let entry = entry.map_err(|error| {
                BackupError::new(
                    BackupErrorCode::Io,
                    format!("cannot read backup directory entry: {error}"),
                )
            })?;
            if matches(OsStr::from_bytes(entry.file_name().to_bytes())) {
                count = count.saturating_add(1);
                if count >= stop_at {
                    break;
                }
            }
        }
        Ok(count)
    }

    #[cfg(not(unix))]
    fn count_entry_names_matching<F>(
        &self,
        stop_at: usize,
        mut matches: F,
    ) -> Result<usize, BackupError>
    where
        F: FnMut(&OsStr) -> bool,
    {
        let entries = fs::read_dir(&self.resolved_path)
            .map_err(|error| BackupError::io("cannot list the Tesina Backups subfolder", &error))?;
        let mut count = 0_usize;
        for entry in entries {
            let name = entry
                .map_err(|error| BackupError::io("cannot read backup directory entry", &error))?
                .file_name();
            if matches(&name) {
                count = count.saturating_add(1);
                if count >= stop_at {
                    break;
                }
            }
        }
        Ok(count)
    }

    #[cfg(target_os = "macos")]
    fn is_case_sensitive_volume(&self) -> Result<bool, BackupError> {
        use std::os::fd::AsRawFd;

        #[repr(C)]
        struct VolumeCapabilitiesBuffer {
            length: u32,
            capabilities: libc::vol_capabilities_attr_t,
        }

        let mut attributes = libc::attrlist {
            bitmapcount: libc::ATTR_BIT_MAP_COUNT,
            reserved: 0,
            commonattr: 0,
            volattr: libc::ATTR_VOL_CAPABILITIES,
            dirattr: 0,
            fileattr: 0,
            forkattr: 0,
        };
        let mut buffer = VolumeCapabilitiesBuffer {
            length: 0,
            capabilities: libc::vol_capabilities_attr_t {
                capabilities: [0; 4],
                valid: [0; 4],
            },
        };
        let result = unsafe {
            libc::fgetattrlist(
                self.directory.as_raw_fd(),
                (&mut attributes as *mut libc::attrlist).cast(),
                (&mut buffer as *mut VolumeCapabilitiesBuffer).cast(),
                std::mem::size_of::<VolumeCapabilitiesBuffer>(),
                0,
            )
        };
        if result != 0 {
            return Err(BackupError::io(
                "cannot inspect backup volume name semantics",
                &std::io::Error::last_os_error(),
            ));
        }
        let index = libc::VOL_CAPABILITIES_FORMAT;
        let flag = libc::VOL_CAP_FMT_CASE_SENSITIVE;
        if buffer.capabilities.valid[index] & flag == 0 {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "backup volume did not report its case-sensitivity capability",
            ));
        }
        Ok(buffer.capabilities.capabilities[index] & flag != 0)
    }

    #[cfg(windows)]
    fn is_case_sensitive_volume(&self) -> Result<bool, BackupError> {
        // NTFS advertises case-sensitive *support* at volume level even when
        // an ordinary directory is case-insensitive. Conservatively pool case
        // aliases on Windows; this can only reject early on an explicitly
        // case-sensitive directory, never let aliases evade the byte budget.
        Ok(false)
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    fn is_case_sensitive_volume(&self) -> Result<bool, BackupError> {
        Ok(true)
    }

    #[cfg(unix)]
    fn rename_no_replace(&self, from: &str, to: &str) -> Result<(), BackupError> {
        use rustix::fs::{renameat_with, RenameFlags};
        use rustix::io::Errno;

        match renameat_with(
            &self.directory,
            self.checked_name(from)?,
            &self.directory,
            self.checked_name(to)?,
            RenameFlags::NOREPLACE,
        ) {
            Ok(()) => Ok(()),
            Err(Errno::EXIST | Errno::NOTEMPTY) => Err(BackupError::new(
                BackupErrorCode::NameTaken,
                "a file with this name already exists in the backup folder",
            )),
            Err(error) => Err(BackupError::new(
                BackupErrorCode::Io,
                format!("cannot atomically publish archive without replacement: {error}"),
            )),
        }
    }

    #[cfg(windows)]
    fn rename_no_replace(&self, from: &str, to: &str) -> Result<(), BackupError> {
        rename_path_no_replace(&self.resolved_child(from)?, &self.resolved_child(to)?)
    }

    #[cfg(not(any(unix, windows)))]
    fn rename_no_replace(&self, _from: &str, _to: &str) -> Result<(), BackupError> {
        Err(BackupError::new(
            BackupErrorCode::Io,
            "atomic no-replace publication is unsupported on this platform",
        ))
    }

    #[cfg(unix)]
    fn remove_child(&self, name: &str) -> Result<(), BackupError> {
        use rustix::fs::{unlinkat, AtFlags};

        unlinkat(&self.directory, self.checked_name(name)?, AtFlags::empty()).map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("cannot remove archive: {error}"),
            )
        })?;
        self.sync_directory()
    }

    #[cfg(not(unix))]
    fn remove_child(&self, name: &str) -> Result<(), BackupError> {
        fs::remove_file(self.resolved_child(name)?)
            .map_err(|error| BackupError::io("cannot remove archive", &error))
    }

    #[cfg(unix)]
    fn sync_directory(&self) -> Result<(), BackupError> {
        self.directory
            .sync_all()
            .map_err(|error| BackupError::io("cannot sync backup directory", &error))
    }

    #[cfg(not(unix))]
    fn sync_directory(&self) -> Result<(), BackupError> {
        Ok(())
    }
}

#[cfg(windows)]
fn rename_path_no_replace(from: &Path, to: &Path) -> Result<(), BackupError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{HRESULT, PCWSTR};
    use windows::Win32::Foundation::{ERROR_ALREADY_EXISTS, ERROR_FILE_EXISTS};
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

    let from_wide = from
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let to_wide = to
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let outcome = unsafe {
        MoveFileExW(
            PCWSTR(from_wide.as_ptr()),
            PCWSTR(to_wide.as_ptr()),
            MOVEFILE_WRITE_THROUGH,
        )
    };
    match outcome {
        Ok(()) => Ok(()),
        Err(error)
            if error.code() == HRESULT::from_win32(ERROR_FILE_EXISTS.0)
                || error.code() == HRESULT::from_win32(ERROR_ALREADY_EXISTS.0) =>
        {
            Err(BackupError::new(
                BackupErrorCode::NameTaken,
                "a file with this name already exists in the backup folder",
            ))
        }
        Err(error) => Err(BackupError::new(
            BackupErrorCode::Io,
            format!("cannot atomically publish archive without replacement: {error}"),
        )),
    }
}

#[cfg(windows)]
fn replace_path_atomic(from: &Path, to: &Path) -> Result<(), BackupError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from_wide = from
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let to_wide = to
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(from_wide.as_ptr()),
            PCWSTR(to_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| {
        BackupError::new(
            BackupErrorCode::Io,
            format!("cannot publish native control record atomically: {error}"),
        )
    })
}

fn resolve_subfolder(stored_canonical_folder: &Path) -> Result<BackupSubfolderAnchor, BackupError> {
    BackupSubfolderAnchor::open(stored_canonical_folder)
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

fn validate_automatic_archive_name(
    file_name: &str,
    backup_set_id: &str,
) -> Result<(), BackupError> {
    validate_file_name(file_name)?;
    let expected_prefix = automatic_archive_prefix(backup_set_id)?;
    if !automatic_archive_name_matches(file_name, &expected_prefix, true) {
        return Err(BackupError::new(
            BackupErrorCode::InvalidFileName,
            "automatic archive name does not match the current backup set and UTC grammar",
        ));
    }
    Ok(())
}

fn automatic_archive_prefix(backup_set_id: &str) -> Result<String, BackupError> {
    let backup_set_id = Uuid::parse_str(backup_set_id).map_err(|_| {
        BackupError::new(BackupErrorCode::Io, "native backup set identity is invalid")
    })?;
    Ok(format!(
        "Tesina Library - {} - ",
        &backup_set_id.to_string()[..8]
    ))
}

fn automatic_archive_name_matches(
    file_name: &str,
    expected_prefix: &str,
    case_sensitive: bool,
) -> bool {
    let bytes = file_name.as_bytes();
    let prefix = expected_prefix.as_bytes();
    let extension = ARCHIVE_EXTENSION.as_bytes();
    if bytes.len() != prefix.len() + 20 + extension.len() {
        return false;
    }
    let (actual_prefix, remainder) = bytes.split_at(prefix.len());
    let (timestamp, actual_extension) = remainder.split_at(20);
    let text_matches = |actual: &[u8], expected: &[u8]| {
        if case_sensitive {
            actual == expected
        } else {
            actual.eq_ignore_ascii_case(expected)
        }
    };
    if !text_matches(actual_prefix, prefix) || !text_matches(actual_extension, extension) {
        return false;
    }
    let separators = [
        (4, b'-'),
        (7, b'-'),
        (10, b'T'),
        (13, b'-'),
        (16, b'-'),
        (19, b'Z'),
    ];
    timestamp.iter().enumerate().all(|(index, byte)| {
        match separators.iter().find(|(separator, _)| *separator == index) {
            Some((_, expected)) => {
                *byte == *expected || (!case_sensitive && byte.eq_ignore_ascii_case(expected))
            }
            None => byte.is_ascii_digit(),
        }
    })
}

fn count_present_automatic_archives(
    subfolder: &BackupSubfolderAnchor,
    backup_set_id: &str,
    stop_at: usize,
) -> Result<usize, BackupError> {
    let case_sensitive = subfolder.is_case_sensitive_volume()?;
    let expected_prefix = automatic_archive_prefix(backup_set_id)?;
    subfolder.count_entry_names_matching(stop_at, |name| {
        name.to_str()
            .map(|name| automatic_archive_name_matches(name, &expected_prefix, case_sensitive))
            .unwrap_or(false)
    })
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/// Writes, syncs, reopens, and hash-binds a private sibling before atomically
/// publishing it with no replacement. The public final name is never used as
/// a streaming or copy destination.
#[cfg(test)]
fn write_exclusive_with_hook<F>(
    dir: &BackupSubfolderAnchor,
    file_name: &str,
    bytes: &[u8],
    before_publish: F,
) -> Result<(), BackupError>
where
    F: FnOnce() -> Result<(), BackupError>,
{
    write_exclusive_with_hooks(dir, file_name, bytes, || Ok(()), before_publish)
}

fn write_exclusive_with_hooks<BeforeDisk, BeforePublish>(
    dir: &BackupSubfolderAnchor,
    file_name: &str,
    bytes: &[u8],
    before_disk: BeforeDisk,
    before_publish: BeforePublish,
) -> Result<(), BackupError>
where
    BeforeDisk: FnOnce() -> Result<(), BackupError>,
    BeforePublish: FnOnce() -> Result<(), BackupError>,
{
    write_exclusive_with_hooks_at_limit(
        dir,
        file_name,
        bytes,
        MAX_ARCHIVE_BYTES,
        before_disk,
        before_publish,
    )
}

fn write_exclusive_with_hooks_at_limit<BeforeDisk, BeforePublish>(
    dir: &BackupSubfolderAnchor,
    file_name: &str,
    bytes: &[u8],
    max_bytes: usize,
    before_disk: BeforeDisk,
    before_publish: BeforePublish,
) -> Result<(), BackupError>
where
    BeforeDisk: FnOnce() -> Result<(), BackupError>,
    BeforePublish: FnOnce() -> Result<(), BackupError>,
{
    if bytes.len() > max_bytes {
        return Err(BackupError::new(
            BackupErrorCode::FileTooLarge,
            "the archive exceeds the supported size limit",
        ));
    }
    before_disk()?;
    let tmp_name = format!(".tmp-{}", Uuid::new_v4());
    let expected_sha256 = sha256_hex(bytes);
    let mut owned_temp_identity = None;
    let write_result = (|| -> Result<(), BackupError> {
        let mut tmp = dir.create_child_new(&tmp_name, "temporary archive file")?;
        owned_temp_identity = Some(
            tmp.try_clone()
                .and_then(FileIdentity::from_file)
                .map_err(|error| BackupError::io("cannot identify temporary archive", &error))?,
        );
        tmp.write_all(bytes)
            .map_err(|error| BackupError::io("cannot write archive bytes", &error))?;
        tmp.sync_all()
            .map_err(|error| BackupError::io("cannot sync archive bytes", &error))?;
        drop(tmp);

        let mut validated_temp = dir.open_child_read(&tmp_name, "temporary archive")?;
        ensure_regular_file(
            &validated_temp,
            "the temporary archive is not a regular file",
        )?;
        let temp_identity = validated_temp
            .try_clone()
            .and_then(FileIdentity::from_file)
            .map_err(|error| BackupError::io("cannot identify temporary archive", &error))?;
        if Some(&temp_identity) != owned_temp_identity.as_ref() {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "temporary archive pathname changed before validation",
            ));
        }
        let actual_sha256 = sha256_opened_bounded(
            &mut validated_temp,
            "cannot validate temporary archive",
            max_bytes,
        )?;
        if actual_sha256 != expected_sha256 {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "temporary archive bytes changed before publication",
            ));
        }
        before_publish()?;
        let final_sha256 = sha256_opened_bounded(
            &mut validated_temp,
            "cannot revalidate temporary archive",
            max_bytes,
        )?;
        if final_sha256 != expected_sha256 {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "temporary archive bytes changed before publication",
            ));
        }
        dir.ensure_child_identity(&tmp_name, &temp_identity, "temporary archive")?;
        dir.rename_no_replace(&tmp_name, file_name)?;
        let mut published = dir.open_child_read(file_name, "published archive")?;
        ensure_regular_file(&published, "the published archive is not a regular file")?;
        let published_identity = published
            .try_clone()
            .and_then(FileIdentity::from_file)
            .map_err(|error| BackupError::io("cannot identify published archive", &error))?;
        if published_identity != temp_identity {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "published archive pathname belongs to another file",
            ));
        }
        let published_sha256 = sha256_opened_bounded(
            &mut published,
            "cannot validate published archive",
            max_bytes,
        )?;
        if published_sha256 != expected_sha256 {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "published archive bytes do not match the validated input",
            ));
        }
        dir.ensure_child_identity(file_name, &temp_identity, "published archive")?;
        dir.sync_directory()
    })();
    if write_result.is_err() {
        if let Some(owned_identity) = owned_temp_identity.as_ref() {
            let _ = remove_child_staged_with_hooks(
                dir,
                &tmp_name,
                Some(owned_identity),
                None,
                |_| Ok(()),
                |_| Ok(()),
            );
        }
    }
    write_result
}

/// Atomic native-control JSON write: temporary sibling, fsync, rename over target.
fn write_json_atomic_with_hook<F>(
    control_dir: &NativeDirectoryAnchor,
    file_name: &str,
    value: &impl Serialize,
    before_publish: F,
) -> Result<(), BackupError>
where
    F: FnOnce() -> Result<(), BackupError>,
{
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| BackupError::new(BackupErrorCode::Io, format!("serialize: {error}")))?;
    if bytes.len() > MAX_CONTROL_RECORD_BYTES {
        return Err(BackupError::new(
            BackupErrorCode::FileTooLarge,
            "native control record exceeds its bounded size limit",
        ));
    }
    let tmp_name = format!(".tmp-control-{}", Uuid::new_v4());
    let result = (|| -> Result<(), BackupError> {
        let mut tmp = control_dir.create_child_new(&tmp_name)?;
        tmp.write_all(&bytes)
            .map_err(|error| BackupError::io("cannot write record", &error))?;
        tmp.sync_all()
            .map_err(|error| BackupError::io("cannot sync record", &error))?;
        drop(tmp);
        before_publish()?;
        control_dir.rename_replace(&tmp_name, file_name)
    })();
    if result.is_err() {
        let _ = control_dir.remove_child_if_present(&tmp_name);
    }
    result
}

fn parse_directory_config(bytes: &[u8]) -> Option<BackupDirectoryConfig> {
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

fn load_directory_config(
    control_dir: &NativeDirectoryAnchor,
) -> Result<Option<BackupDirectoryConfig>, BackupError> {
    let Some(bytes) =
        control_dir.read_child_bounded(DIRECTORY_FILE_NAME, MAX_CONTROL_RECORD_BYTES)?
    else {
        return Ok(None);
    };
    parse_directory_config(&bytes).map(Some).ok_or_else(|| {
        BackupError::new(
            BackupErrorCode::Io,
            "trusted native backup configuration is malformed",
        )
    })
}

fn parse_ledger(bytes: &[u8]) -> Option<Ledger> {
    let ledger: Ledger = serde_json::from_slice(bytes).ok()?;
    if ledger.schema_version != 1
        || ledger.entries.len() > MAX_LEDGER_ENTRIES
        || ledger.entries.iter().any(|entry| {
            validate_file_name(&entry.file_name).is_err()
                || entry.sha256.len() != 64
                || !entry.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
                || entry.created_at.is_empty()
                || Uuid::parse_str(&entry.backup_set_id).is_err()
        })
    {
        return None;
    }
    Some(ledger)
}

fn load_ledger(control_dir: &NativeDirectoryAnchor) -> Result<Ledger, BackupError> {
    let Some(bytes) = control_dir.read_child_bounded(LEDGER_FILE_NAME, MAX_CONTROL_RECORD_BYTES)?
    else {
        return Ok(Ledger::empty());
    };
    parse_ledger(&bytes).ok_or_else(|| {
        BackupError::new(
            BackupErrorCode::Io,
            "trusted native backup ledger is malformed or exceeds its entry limit",
        )
    })
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

fn ensure_regular_file(file: &fs::File, detail: &str) -> Result<(), BackupError> {
    let metadata = file
        .metadata()
        .map_err(|error| BackupError::io("cannot inspect archive", &error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(BackupError::new(BackupErrorCode::Io, detail));
    }
    Ok(())
}

fn sha256_child_bounded(
    directory: &BackupSubfolderAnchor,
    name: &str,
    context: &str,
    max_bytes: usize,
) -> Result<String, BackupError> {
    let mut file = directory.open_child_read(name, context)?;
    ensure_regular_file(&file, "the archive is not a regular file")?;
    sha256_opened_bounded(&mut file, context, max_bytes)
}

fn sha256_opened_bounded(
    file: &mut fs::File,
    context: &str,
    max_bytes: usize,
) -> Result<String, BackupError> {
    file.rewind()
        .map_err(|error| BackupError::io(context, &error))?;
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

fn deletion_stage_name(name: &str) -> String {
    format!("{name}.delete-ready")
}

fn remove_child_staged_with_hooks<AfterValidation, AfterFinalIdentity>(
    directory: &BackupSubfolderAnchor,
    name: &str,
    expected_identity: Option<&FileIdentity>,
    expected_sha256: Option<&str>,
    after_validation: AfterValidation,
    after_final_identity: AfterFinalIdentity,
) -> Result<(), BackupError>
where
    AfterValidation: FnOnce(&Path) -> Result<(), BackupError>,
    AfterFinalIdentity: FnOnce(&Path) -> Result<(), BackupError>,
{
    let stage = deletion_stage_name(name);
    let has_name = directory.child_exists(name)?;
    let has_stage = directory.child_exists(&stage)?;
    let evidence = match (has_name, has_stage) {
        (true, false) => name,
        (false, true) => stage.as_str(),
        (true, true) => {
            return Err(BackupError::new(
                BackupErrorCode::Io,
                "both removal evidence and its delete-ready stage exist; nothing was deleted",
            ))
        }
        (false, false) => return Ok(()),
    };

    let mut file = directory.open_child_read(evidence, "removal evidence")?;
    ensure_regular_file(&file, "the removal evidence is not a regular file")?;
    let identity = file
        .try_clone()
        .and_then(FileIdentity::from_file)
        .map_err(|error| BackupError::io("cannot identify removal evidence", &error))?;
    if expected_identity.is_some_and(|expected| expected != &identity) {
        return Err(BackupError::new(
            BackupErrorCode::Io,
            "the removal evidence pathname belongs to another file",
        ));
    }
    if let Some(expected) = expected_sha256 {
        let current = sha256_opened_bounded(
            &mut file,
            "cannot validate removal evidence",
            MAX_ARCHIVE_BYTES,
        )?;
        if !current.eq_ignore_ascii_case(expected) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the removal evidence hash does not match; nothing was deleted",
            ));
        }
    }
    directory.ensure_child_identity(evidence, &identity, "removal evidence")?;
    after_validation(&directory.logical_path.join(evidence))?;

    if let Some(expected) = expected_sha256 {
        let current = sha256_opened_bounded(
            &mut file,
            "cannot revalidate removal evidence",
            MAX_ARCHIVE_BYTES,
        )?;
        if !current.eq_ignore_ascii_case(expected) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the removal evidence changed after validation; nothing was deleted",
            ));
        }
    }
    directory.ensure_child_identity(evidence, &identity, "removal evidence")?;
    after_final_identity(&directory.logical_path.join(evidence))?;
    if let Some(expected) = expected_sha256 {
        let current = sha256_opened_bounded(
            &mut file,
            "cannot finally validate removal evidence",
            MAX_ARCHIVE_BYTES,
        )?;
        if !current.eq_ignore_ascii_case(expected) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the removal evidence changed at the deletion boundary; nothing was deleted",
            ));
        }
    }
    directory.ensure_child_identity(evidence, &identity, "removal evidence")?;
    if evidence != stage {
        directory.rename_no_replace(evidence, &stage)?;
        directory.sync_directory()?;
    }

    if let Some(expected) = expected_sha256 {
        let current = sha256_opened_bounded(
            &mut file,
            "cannot validate delete-ready evidence",
            MAX_ARCHIVE_BYTES,
        )?;
        if !current.eq_ignore_ascii_case(expected) {
            return Err(BackupError::new(
                BackupErrorCode::HashMismatch,
                "the delete-ready evidence changed; nothing was deleted",
            ));
        }
    }
    directory.ensure_child_identity(&stage, &identity, "delete-ready removal evidence")?;
    directory.remove_child(&stage)
}

fn restore_removal_evidence(
    directory: &BackupSubfolderAnchor,
    evidence: &str,
    public: &str,
) -> Result<(), BackupError> {
    let stage = deletion_stage_name(evidence);
    if directory.child_exists(&stage)? && !directory.child_exists(evidence)? {
        directory.rename_no_replace(&stage, evidence)?;
        directory.sync_directory()?;
    }
    if directory.child_exists(evidence)? && !directory.child_exists(public)? {
        directory.rename_no_replace(evidence, public)?;
        directory.sync_directory()?;
    }
    Ok(())
}

/// Moves the pathname out of service before hashing so a sync provider may
/// recreate the public name without making us delete unverified bytes. The
/// hook is a deterministic test seam for that post-quarantine race.
fn cleanup_pending_archive(
    directory: &BackupSubfolderAnchor,
    file_name: &str,
    expected_sha256: &str,
) -> Result<(), BackupError> {
    // A stable quarantine name makes a failed removal retryable even when the
    // public pathname is now absent or has been recreated by a sync provider.
    let quarantine = format!(".delete-pending-{expected_sha256}");
    let candidate = if directory.child_exists(&quarantine)?
        || directory.child_exists(&deletion_stage_name(&quarantine))?
    {
        quarantine.clone()
    } else {
        if !directory.child_exists(file_name)? {
            return Ok(());
        }
        directory.rename_no_replace(file_name, &quarantine)?;
        directory.sync_directory()?;
        quarantine.clone()
    };

    let outcome = remove_child_staged_with_hooks(
        directory,
        &candidate,
        None,
        Some(expected_sha256),
        |_| Ok(()),
        |_| Ok(()),
    );

    if outcome.is_err() {
        restore_removal_evidence(directory, &candidate, file_name)?;
    }
    outcome
}

fn quarantine_and_remove_archive<F>(
    directory: &BackupSubfolderAnchor,
    file_name: &str,
    expected_sha256: &str,
    after_quarantine: F,
) -> Result<(), BackupError>
where
    F: FnOnce(&Path) -> Result<(), BackupError>,
{
    quarantine_and_remove_archive_with_hooks(
        directory,
        file_name,
        expected_sha256,
        after_quarantine,
        |_| Ok(()),
    )
}

fn active_quarantine_name(file_name: &str, expected_sha256: &str) -> String {
    let operation_key =
        sha256_hex(format!("{file_name}\0{}", expected_sha256.to_ascii_lowercase()).as_bytes());
    format!(".delete-active-{operation_key}")
}

fn quarantine_and_remove_archive_with_hooks<AfterQuarantine, AfterFinalIdentity>(
    directory: &BackupSubfolderAnchor,
    file_name: &str,
    expected_sha256: &str,
    after_quarantine: AfterQuarantine,
    after_final_identity: AfterFinalIdentity,
) -> Result<(), BackupError>
where
    AfterQuarantine: FnOnce(&Path) -> Result<(), BackupError>,
    AfterFinalIdentity: FnOnce(&Path) -> Result<(), BackupError>,
{
    let quarantine = active_quarantine_name(file_name, expected_sha256);
    let has_evidence = directory.child_exists(&quarantine)?
        || directory.child_exists(&deletion_stage_name(&quarantine))?;
    let has_public = directory.child_exists(file_name)?;
    if has_evidence && has_public {
        return Err(BackupError::new(
            BackupErrorCode::Io,
            "both the archive and its deterministic removal evidence exist; nothing was deleted",
        ));
    }
    if !has_evidence {
        if !has_public {
            return Ok(());
        }
        directory.rename_no_replace(file_name, &quarantine)?;
        directory.sync_directory()?;
    }

    let outcome = remove_child_staged_with_hooks(
        directory,
        &quarantine,
        None,
        Some(expected_sha256),
        after_quarantine,
        after_final_identity,
    );

    if outcome.is_err() {
        restore_removal_evidence(directory, &quarantine, file_name)?;
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

async fn run_selected_folder<T, F>(
    core: BackupDirectoryCore,
    operation: F,
) -> Result<T, BackupError>
where
    T: Send + 'static,
    F: FnOnce(SelectedOperation) -> Result<T, BackupError> + Send + 'static,
{
    run_selected_folder_with_timeout(SELECTED_FOLDER_TIMEOUT, core, operation).await
}

async fn run_selected_folder_with_timeout<T, F>(
    timeout: Duration,
    core: BackupDirectoryCore,
    operation: F,
) -> Result<T, BackupError>
where
    T: Send + 'static,
    F: FnOnce(SelectedOperation) -> Result<T, BackupError> + Send + 'static,
{
    let selected_operation = core.selected_operation();
    run_selected_folder_at_operation_with_timeout(timeout, core, selected_operation, operation)
        .await
}

async fn run_selected_folder_at_operation_with_timeout<T, F>(
    timeout: Duration,
    core: BackupDirectoryCore,
    selected_operation: SelectedOperation,
    operation: F,
) -> Result<T, BackupError>
where
    T: Send + 'static,
    F: FnOnce(SelectedOperation) -> Result<T, BackupError> + Send + 'static,
{
    let worker_operation = selected_operation.clone();
    let mut task = tauri::async_runtime::spawn_blocking(move || operation(worker_operation));
    match tokio::time::timeout(timeout, &mut task).await {
        Err(_) => {
            core.cancel_selected_folder_operations();
            core.wait_for_local_commits().await?;
            Err(BackupError::new(
                BackupErrorCode::Timeout,
                "the selected backup folder did not respond before the timeout",
            ))
        }
        Ok(Err(error)) => Err(BackupError::new(
            BackupErrorCode::Io,
            format!("selected-folder worker failed: {error}"),
        )),
        Ok(Ok(result)) => {
            selected_operation.checkpoint()?;
            result
        }
    }
}

async fn run_activation_with_timeout(
    timeout: Duration,
    core: BackupDirectoryCore,
) -> Result<ActiveConfiguration, BackupError> {
    run_activation_with_timeout_and_hook(timeout, core, || Ok(())).await
}

async fn run_activation_with_timeout_and_hook<F>(
    timeout: Duration,
    core: BackupDirectoryCore,
    after_claim: F,
) -> Result<ActiveConfiguration, BackupError>
where
    F: FnOnce() -> Result<(), BackupError> + Send + 'static,
{
    let epoch = core.start_configuration_operation();
    let operation = core.selected_operation();
    let worker = core.clone();
    let worker_operation = operation.clone();
    let mut task = tauri::async_runtime::spawn_blocking(move || {
        worker.activate_configuration_at_epoch_and_operation_with_hook(
            epoch,
            &worker_operation,
            after_claim,
        )
    });
    match tokio::time::timeout(timeout, &mut task).await {
        Err(_) => {
            core.cancel_selected_folder_operations();
            if core.invalidate_configuration_epoch(epoch) {
                core.wait_for_local_commits().await?;
                Err(BackupError::new(
                    BackupErrorCode::Timeout,
                    "the selected backup folder did not respond before the timeout",
                ))
            } else if core.configuration_epoch() == epoch.wrapping_add(1) {
                match task.await {
                    Err(error) => Err(BackupError::new(
                        BackupErrorCode::Io,
                        format!("selected-folder worker failed: {error}"),
                    )),
                    Ok(result) => result,
                }
            } else {
                core.wait_for_local_commits().await?;
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
        Ok(Ok(result)) => {
            operation.checkpoint()?;
            result
        }
    }
}

async fn run_begin_configuration_with_timeout(
    timeout: Duration,
    core: BackupDirectoryCore,
    path: String,
) -> Result<PendingConfiguration, BackupError> {
    let epoch = core.start_configuration_operation();
    let operation = core.selected_operation();
    let worker = core.clone();
    let worker_operation = operation.clone();
    let mut task = tauri::async_runtime::spawn_blocking(move || {
        worker.begin_configuration_at_epoch_with_hook(&path, epoch, &worker_operation, || Ok(()))
    });
    match tokio::time::timeout(timeout, &mut task).await {
        Err(_) => {
            core.cancel_current_operations();
            core.wait_for_local_commits().await?;
            Err(BackupError::new(
                BackupErrorCode::Timeout,
                "the selected backup folder did not respond before the timeout",
            ))
        }
        Ok(Err(error)) => Err(BackupError::new(
            BackupErrorCode::Io,
            format!("selected-folder worker failed: {error}"),
        )),
        Ok(Ok(result)) => {
            operation.checkpoint()?;
            result
        }
    }
}

async fn run_pick_and_begin_configuration_with_timeout<F>(
    timeout: Duration,
    core: BackupDirectoryCore,
    picker: F,
) -> Result<Option<PendingConfiguration>, BackupError>
where
    F: FnOnce() -> Result<Option<PathBuf>, BackupError> + Send + 'static,
{
    let selected = tauri::async_runtime::spawn_blocking(picker)
        .await
        .map_err(|error| {
            BackupError::new(
                BackupErrorCode::Io,
                format!("native backup-folder picker failed: {error}"),
            )
        })??;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected.into_os_string().into_string().map_err(|_| {
        BackupError::new(
            BackupErrorCode::Io,
            "the selected backup-folder path is not valid Unicode",
        )
    })?;
    run_begin_configuration_with_timeout(timeout, core, selected)
        .await
        .map(Some)
}

#[derive(Clone, Copy)]
enum ArchiveWriteTarget {
    PendingTest,
    Active,
}

async fn run_archive_write_request(
    core: BackupDirectoryCore,
    request: &tauri::ipc::Request<'_>,
    target: ArchiveWriteTarget,
) -> Result<String, BackupError> {
    let file_name = request_file_name(request)?;
    let operation = core.selected_operation();
    let admission = core.try_archive_body_admission()?;
    let preflight_core = core.clone();
    let preflight_name = file_name.clone();
    run_selected_folder_at_operation_with_timeout(
        SELECTED_FOLDER_TIMEOUT,
        core.clone(),
        operation.clone(),
        move |operation| {
            operation.checkpoint()?;
            match target {
                ArchiveWriteTarget::PendingTest => {
                    preflight_core.preflight_test_archive_write(&preflight_name)?;
                }
                ArchiveWriteTarget::Active => {
                    preflight_core.preflight_active_archive_write(&preflight_name)?;
                }
            }
            operation.checkpoint()
        },
    )
    .await?;
    operation.checkpoint()?;
    let admitted = AdmittedArchiveBody {
        body: request_bytes(request)?,
        _permit: admission,
    };
    operation.checkpoint()?;
    let worker = core.clone();
    run_selected_folder_at_operation_with_timeout(
        SELECTED_FOLDER_TIMEOUT,
        core,
        operation,
        move |operation| match target {
            ArchiveWriteTarget::PendingTest => {
                worker.write_test_archive_at_operation(&file_name, &admitted.body, &operation)
            }
            ArchiveWriteTarget::Active => {
                worker.write_archive_at_operation(&file_name, &admitted.body, &operation)
            }
        },
    )
    .await
}

#[tauri::command]
pub async fn backup_pick_and_begin_configuration(
    window: tauri::Window,
    state: tauri::State<'_, BackupDirectoryCore>,
) -> Result<Option<PendingConfiguration>, BackupError> {
    let core = state.inner().clone();
    run_pick_and_begin_configuration_with_timeout(SELECTED_FOLDER_TIMEOUT, core, move || {
        window
            .dialog()
            .file()
            .blocking_pick_folder()
            .map(|selected| {
                selected.into_path().map_err(|error| {
                    BackupError::new(
                        BackupErrorCode::Io,
                        format!("the selected backup folder is not a local path: {error}"),
                    )
                })
            })
            .transpose()
    })
    .await
}

#[tauri::command]
pub async fn backup_write_test_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, BackupError> {
    run_archive_write_request(
        state.inner().clone(),
        &request,
        ArchiveWriteTarget::PendingTest,
    )
    .await
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
    let worker = core.clone();
    run_selected_folder(core, move |operation| {
        worker.cancel_configuration_at_operation(&operation)
    })
    .await
}

#[tauri::command]
pub async fn backup_write_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, BackupError> {
    run_archive_write_request(state.inner().clone(), &request, ArchiveWriteTarget::Active).await
}

#[tauri::command]
pub async fn backup_confirm_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    file_name: String,
    expected_sha256: String,
) -> Result<(), BackupError> {
    let core = state.inner().clone();
    let worker = core.clone();
    run_selected_folder(core, move |operation| {
        worker.confirm_archive_at_operation(&file_name, &expected_sha256, &operation)
    })
    .await
}

#[tauri::command]
pub async fn backup_discard_pending_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    file_name: String,
    expected_sha256: String,
) -> Result<(), BackupError> {
    let core = state.inner().clone();
    let worker = core.clone();
    run_selected_folder(core, move |operation| {
        worker.discard_pending_archive_at_operation(&file_name, &expected_sha256, &operation)
    })
    .await
}

#[tauri::command]
pub async fn backup_read_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, BackupError> {
    let file_name = request_file_name(&request)?;
    let core = state.inner().clone();
    let admission = core.admit_archive_body(|| Ok(()))?;
    let worker = core.clone();
    let bytes = run_selected_folder(core, move |operation| {
        let _admission = admission;
        operation.checkpoint()?;
        let bytes = worker.read_archive(&file_name)?;
        operation.checkpoint()?;
        Ok(bytes)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn backup_read_test_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, BackupError> {
    let file_name = request_file_name(&request)?;
    let core = state.inner().clone();
    let admission = core.admit_archive_body(|| Ok(()))?;
    let worker = core.clone();
    let bytes = run_selected_folder(core, move |operation| {
        let _admission = admission;
        operation.checkpoint()?;
        let bytes = worker.read_test_archive(&file_name)?;
        operation.checkpoint()?;
        Ok(bytes)
    })
    .await?;
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

fn clone_raw_bytes_bounded(bytes: &[u8], max_bytes: usize) -> Result<Vec<u8>, BackupError> {
    if bytes.len() > max_bytes {
        return Err(BackupError::new(
            BackupErrorCode::FileTooLarge,
            "the archive exceeds the supported size limit",
        ));
    }
    Ok(bytes.to_vec())
}

fn request_bytes(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, BackupError> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => clone_raw_bytes_bounded(bytes, MAX_ARCHIVE_BYTES),
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
    let worker = core.clone();
    run_selected_folder(core, move |operation| {
        operation.checkpoint()?;
        let listings = worker.list_archives()?;
        operation.checkpoint()?;
        Ok(listings)
    })
    .await
}

#[tauri::command]
pub async fn backup_list_archive_names(
    state: tauri::State<'_, BackupDirectoryCore>,
) -> Result<Vec<String>, BackupError> {
    let core = state.inner().clone();
    let worker = core.clone();
    run_selected_folder(core, move |operation| {
        operation.checkpoint()?;
        let names = worker.list_archive_names()?;
        operation.checkpoint()?;
        Ok(names)
    })
    .await
}

#[tauri::command]
pub async fn backup_remove_archive(
    state: tauri::State<'_, BackupDirectoryCore>,
    file_name: String,
    expected_sha256: String,
) -> Result<(), BackupError> {
    let core = state.inner().clone();
    let worker = core.clone();
    run_selected_folder(core, move |operation| {
        worker.remove_archive_at_operation(&file_name, &expected_sha256, &operation)
    })
    .await
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
    let worker = core.clone();
    run_selected_folder(core, move |operation| {
        operation.checkpoint()?;
        let status = worker.status();
        operation.checkpoint()?;
        Ok(status)
    })
    .await
}

#[tauri::command]
pub async fn backup_cancel_current_operations(
    state: tauri::State<'_, BackupDirectoryCore>,
) -> Result<(), BackupError> {
    state.cancel_current_operations_and_wait().await
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
    async fn selected_folder_timeout_never_returns_a_late_success() {
        let root = TempDir::new().unwrap();
        let core =
            BackupDirectoryCore::new(root.path().join("app-data"), root.path().join("app-cache"))
                .unwrap();
        let error = run_selected_folder_with_timeout(Duration::from_millis(5), core, |_| {
            std::thread::sleep(Duration::from_millis(50));
            Ok(42)
        })
        .await
        .expect_err("late success must still report the elapsed timeout");
        assert_eq!(error.code, BackupErrorCode::Timeout);
    }

    #[test]
    fn raw_and_disk_write_limits_reject_before_allocation_or_temp_creation() {
        assert_eq!(clone_raw_bytes_bounded(b"four", 4).unwrap(), b"four");
        let raw_error = clone_raw_bytes_bounded(b"five!", 4)
            .expect_err("an oversized raw body must be rejected before cloning");
        assert_eq!(raw_error.code, BackupErrorCode::FileTooLarge);

        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();
        let before_disk_called = std::sync::atomic::AtomicBool::new(false);
        let error = write_exclusive_with_hooks_at_limit(
            &anchor,
            "Oversized.tesina",
            b"five!",
            4,
            || {
                before_disk_called.store(true, Ordering::SeqCst);
                Ok(())
            },
            || Ok(()),
        )
        .expect_err("the native disk boundary must repeat the size guard");

        assert_eq!(error.code, BackupErrorCode::FileTooLarge);
        assert!(!before_disk_called.load(Ordering::SeqCst));
        let subfolder = subfolder_of(&fixture.selected_dir);
        assert!(!subfolder.join("Oversized.tesina").exists());
        assert!(fs::read_dir(subfolder).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".tmp-")));
    }

    #[test]
    fn concurrent_raw_body_is_rejected_before_clone_and_capacity_returns() {
        let root = TempDir::new().unwrap();
        let core =
            BackupDirectoryCore::new(root.path().join("app-data"), root.path().join("app-cache"))
                .unwrap();
        let first = core
            .admit_archive_body(|| clone_raw_bytes_bounded(b"first body", MAX_ARCHIVE_BYTES))
            .unwrap();
        let clone_started = std::sync::atomic::AtomicBool::new(false);
        let error = core
            .admit_archive_body(|| {
                clone_started.store(true, Ordering::SeqCst);
                clone_raw_bytes_bounded(b"second body", MAX_ARCHIVE_BYTES)
            })
            .expect_err("concurrent bodies must fail fast instead of waiting indefinitely");
        assert_eq!(error.code, BackupErrorCode::ResourceLimit);
        assert!(!clone_started.load(Ordering::SeqCst));
        drop(first);
        let admitted = core
            .admit_archive_body(|| {
                clone_started.store(true, Ordering::SeqCst);
                clone_raw_bytes_bounded(b"second body", MAX_ARCHIVE_BYTES)
            })
            .expect("capacity must return after the first body settles");
        assert_eq!(admitted.body, b"second body");
        assert!(clone_started.load(Ordering::SeqCst));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn timed_out_write_cleans_private_temp_and_never_publishes_late() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();
        let timeout_core = core.clone();
        let (worker_finished, worker_done) = tokio::sync::oneshot::channel();

        let error = run_selected_folder_with_timeout(
            Duration::from_millis(5),
            timeout_core,
            move |operation| {
                let result = write_exclusive_with_hooks(
                    &anchor,
                    "Late.tesina",
                    b"validated bytes",
                    || operation.checkpoint(),
                    || {
                        std::thread::sleep(Duration::from_millis(50));
                        operation.checkpoint()
                    },
                );
                let _ = worker_finished.send(());
                result
            },
        )
        .await
        .expect_err("a write that misses the deadline must report timeout");

        assert_eq!(error.code, BackupErrorCode::Timeout);
        let subfolder = subfolder_of(&fixture.selected_dir);
        assert!(!subfolder.join("Late.tesina").exists());
        tokio::time::timeout(Duration::from_secs(1), worker_done)
            .await
            .expect("the detached worker must reach its owned cleanup")
            .expect("the detached worker must report completion");
        assert!(!subfolder.join("Late.tesina").exists());
        assert!(fs::read_dir(subfolder).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".tmp-")));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn timeout_returns_while_provider_mutation_remains_blocked() {
        let root = TempDir::new().unwrap();
        let core =
            BackupDirectoryCore::new(root.path().join("app-data"), root.path().join("app-cache"))
                .unwrap();
        let timeout_core = core.clone();
        let worker_core = core.clone();
        let (worker_entered, entered) = tokio::sync::oneshot::channel();
        let (worker_finished, finished) = tokio::sync::oneshot::channel();
        let still_blocked = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let worker_still_blocked = still_blocked.clone();

        let runner = tokio::spawn(run_selected_folder_with_timeout(
            Duration::from_millis(20),
            timeout_core,
            move |operation| {
                operation.checkpoint()?;
                let _unsafe_mutation = worker_core.claim_unsafe_mutation(&operation)?;
                let _ = worker_entered.send(());
                std::thread::sleep(Duration::from_millis(200));
                worker_still_blocked.store(false, Ordering::SeqCst);
                let result = operation.checkpoint();
                let _ = worker_finished.send(());
                result
            },
        ));
        tokio::time::timeout(Duration::from_secs(1), entered)
            .await
            .expect("the simulated provider mutation must start")
            .expect("the provider worker must signal entry");
        let error = tokio::time::timeout(Duration::from_millis(100), runner)
            .await
            .expect("the command must settle while the provider syscall is blocked")
            .unwrap()
            .expect_err("a blocked provider syscall must not turn a timeout into success");

        assert_eq!(error.code, BackupErrorCode::Timeout);
        assert!(
            still_blocked.load(Ordering::SeqCst),
            "the worker must still be inside the simulated provider syscall"
        );
        tokio::time::timeout(Duration::from_secs(1), finished)
            .await
            .expect("the simulated provider mutation must eventually settle")
            .expect("the provider worker must signal completion");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn explicit_cancel_waits_for_an_unsafe_mutation_safe_point() {
        let root = TempDir::new().unwrap();
        let core =
            BackupDirectoryCore::new(root.path().join("app-data"), root.path().join("app-cache"))
                .unwrap();
        let operation = core.selected_operation();
        let unsafe_mutation = core.claim_unsafe_mutation(&operation).unwrap();
        let cancel_core = core.clone();
        let cancel =
            tokio::spawn(async move { cancel_core.cancel_current_operations_and_wait().await });

        tokio::time::timeout(Duration::from_secs(1), async {
            while operation.checkpoint().is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("explicit cancellation must invalidate the operation promptly");
        assert!(
            !cancel.is_finished(),
            "explicit cancellation must not acknowledge an unsafe mutation"
        );

        drop(unsafe_mutation);
        tokio::time::timeout(Duration::from_secs(1), cancel)
            .await
            .expect("cancellation must settle after the safe point")
            .unwrap()
            .unwrap();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn timed_out_activation_worker_cannot_commit_after_returning() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive(
            &canonical_archive_name(&pending.backup_set_id, 2),
            b"validated",
        )
        .unwrap();

        let guard = core.state.lock().unwrap();
        let error = run_activation_with_timeout(Duration::from_millis(5), core.clone())
            .await
            .expect_err("blocked activation must time out");
        assert_eq!(error.code, BackupErrorCode::Timeout);
        drop(guard);
        tokio::time::sleep(Duration::from_millis(20)).await;

        assert!(!core.control_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(!core.status().configured);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn claimed_activation_finishes_before_its_timeout_result_settles() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive(
            &canonical_archive_name(&pending.backup_set_id, 2),
            b"validated",
        )
        .unwrap();
        let (worker_entered, entered_commit) = tokio::sync::oneshot::channel();
        let (release_commit, worker_release) = std::sync::mpsc::channel();
        let runner_core = core.clone();

        let runner = tokio::spawn(run_activation_with_timeout_and_hook(
            Duration::from_millis(500),
            runner_core,
            move || {
                worker_entered.send(()).map_err(|_| {
                    BackupError::new(
                        BackupErrorCode::Io,
                        "activation test no longer observes the claimed commit",
                    )
                })?;
                worker_release
                    .recv_timeout(Duration::from_secs(5))
                    .map_err(|error| {
                        BackupError::new(
                            BackupErrorCode::Io,
                            format!("activation test did not release the claimed commit: {error}"),
                        )
                    })?;
                Ok(())
            },
        ));
        tokio::time::timeout(Duration::from_secs(1), entered_commit)
            .await
            .expect("the activation must claim its local commit")
            .expect("the activation worker must signal its local commit");
        tokio::time::sleep(Duration::from_millis(550)).await;
        assert!(
            !runner.is_finished(),
            "a claimed config/ledger commit must settle before the command returns"
        );

        release_commit
            .send(())
            .expect("the activation worker must still await release");
        let active = tokio::time::timeout(Duration::from_secs(1), runner)
            .await
            .expect("claimed activation must finish")
            .unwrap()
            .expect("claimed activation is authoritative after the timeout boundary");
        assert_eq!(
            core.status().backup_set_id.as_deref(),
            Some(active.backup_set_id.as_str())
        );
        assert!(core.control_dir.join(DIRECTORY_FILE_NAME).is_file());
        assert!(core.control_dir.join(LEDGER_FILE_NAME).is_file());
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
        app_cache_dir: PathBuf,
        selected_dir: PathBuf,
    }

    fn fixture() -> Fixture {
        let root = TempDir::new().expect("tempdir");
        let app_data_dir = root.path().join("app-data");
        let app_cache_dir = root.path().join("app-cache");
        let selected_dir = root.path().join("Documents").join("MyBackups");
        fs::create_dir_all(&app_data_dir).unwrap();
        fs::create_dir_all(&app_cache_dir).unwrap();
        fs::create_dir_all(&selected_dir).unwrap();
        Fixture {
            _root: root,
            app_data_dir,
            app_cache_dir,
            selected_dir,
        }
    }

    fn core(fixture: &Fixture) -> BackupDirectoryCore {
        BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
            .unwrap()
    }

    fn configure(core: &BackupDirectoryCore, folder: &Path) -> ActiveConfiguration {
        let pending = core
            .begin_configuration(folder.to_str().unwrap())
            .expect("begin");
        let test_name = canonical_archive_name(&pending.backup_set_id, 1);
        core.write_test_archive(&test_name, b"test archive bytes")
            .expect("test write");
        core.activate_configuration().expect("activate")
    }

    fn subfolder_of(selected: &Path) -> PathBuf {
        fs::canonicalize(selected)
            .unwrap()
            .join(BACKUP_SUBFOLDER_NAME)
    }

    fn quarantined_control_directories(fixture: &Fixture) -> Vec<PathBuf> {
        fs::read_dir(&fixture.app_cache_dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(OsStr::to_str)
                    .is_some_and(|name| {
                        name.starts_with(&format!("{CONTROL_DIRECTORY_NAME}.untrusted-"))
                    })
                    && path.is_dir()
            })
            .collect()
    }

    fn assert_quarantined_record(fixture: &Fixture, file_name: &str, expected: &[u8]) {
        assert!(
            quarantined_control_directories(fixture)
                .iter()
                .any(
                    |directory| fs::read(directory.join(file_name)).ok().as_deref()
                        == Some(expected)
                ),
            "the unusable trusted record must remain in quarantined native evidence"
        );
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
        Uuid::parse_str(&pending.backup_set_id).expect("pending backup set id");

        // Nothing persisted before a validated test archive + activation.
        assert!(!core.control_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(!core.status().configured);

        let test_name = canonical_archive_name(&pending.backup_set_id, 1);
        core.write_test_archive(&test_name, b"payload").unwrap();
        let active = core.activate_configuration().unwrap();
        Uuid::parse_str(&active.backup_set_id).expect("uuid backup set id");
        assert_eq!(active.backup_set_id, pending.backup_set_id);

        let record = core.control_dir.join(DIRECTORY_FILE_NAME);
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
    fn live_authority_records_exist_only_in_the_native_cache_store() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let cache_control_dir = fixture.app_cache_dir.join(CONTROL_DIRECTORY_NAME);
        let app_data_mirror = fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME);

        assert!(cache_control_dir.join(DIRECTORY_FILE_NAME).is_file());
        assert!(cache_control_dir.join(LEDGER_FILE_NAME).is_file());
        assert!(!app_data_mirror.join(DIRECTORY_FILE_NAME).exists());
        assert!(!app_data_mirror.join(LEDGER_FILE_NAME).exists());
        assert!(!fixture.app_data_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(!fixture.app_data_dir.join(LEDGER_FILE_NAME).exists());
    }

    #[test]
    fn renderer_writable_mixed_case_app_data_records_never_authorize() {
        let fixture = fixture();
        let _opened = core(&fixture);
        #[cfg(windows)]
        let app_data_mirror = fixture.app_data_dir.join(".TESINA-NATIVE");
        #[cfg(not(windows))]
        let app_data_mirror = fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME);
        let forged_set = "11111111-1111-4111-8111-111111111111";
        let forged_config = BackupDirectoryConfig {
            schema_version: 1,
            canonical_folder_path: fs::canonicalize(&fixture.selected_dir)
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            backup_set_id: forged_set.to_owned(),
        };
        let forged_ledger = Ledger {
            schema_version: 1,
            entries: vec![LedgerEntry {
                file_name: canonical_archive_name(forged_set, 1),
                sha256: sha256_hex(b"forged"),
                created_at: "2026-08-18T12:00:00Z".to_owned(),
                backup_set_id: forged_set.to_owned(),
            }],
        };
        fs::write(
            app_data_mirror.join(DIRECTORY_FILE_NAME),
            serde_json::to_vec_pretty(&forged_config).unwrap(),
        )
        .unwrap();
        fs::write(
            app_data_mirror.join(LEDGER_FILE_NAME),
            serde_json::to_vec_pretty(&forged_ledger).unwrap(),
        )
        .unwrap();

        let restarted =
            BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
                .unwrap();

        assert!(!restarted.status().configured);
        assert!(restarted.status().requires_reauthorization);
        assert!(restarted
            .control_dir
            .starts_with(fs::canonicalize(&fixture.app_cache_dir).unwrap()));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn native_picker_exact_choice_is_the_only_configuration_source() {
        let fixture = fixture();
        let core = core(&fixture);
        let prior = fixture._root.path().join("Prior Picker Grant");
        let descendant = fixture.selected_dir.join("Injected Descendant");
        fs::create_dir(&prior).unwrap();
        fs::create_dir(&descendant).unwrap();
        let chosen = fixture.selected_dir.clone();

        let pending = run_pick_and_begin_configuration_with_timeout(
            Duration::from_secs(1),
            core.clone(),
            move || Ok(Some(chosen)),
        )
        .await
        .unwrap()
        .expect("the exact native choice must begin configuration");

        assert_eq!(
            pending.canonical_folder_path,
            fs::canonicalize(&fixture.selected_dir)
                .unwrap()
                .to_string_lossy()
        );
        assert!(!prior.join(BACKUP_SUBFOLDER_NAME).exists());
        assert!(!descendant.join(BACKUP_SUBFOLDER_NAME).exists());
    }

    #[cfg(unix)]
    #[test]
    fn native_picker_parent_swap_cannot_redirect_subfolder_creation() {
        let fixture = fixture();
        let core = core(&fixture);
        let epoch = core.start_configuration_operation();
        let operation = core.selected_operation();
        let moved = fixture._root.path().join("Held Authorized Folder");
        let replacement = fixture.selected_dir.clone();

        let error = core
            .begin_configuration_at_epoch_with_hook(
                fixture.selected_dir.to_str().unwrap(),
                epoch,
                &operation,
                || {
                    fs::rename(&replacement, &moved).unwrap();
                    fs::create_dir(&replacement).unwrap();
                    Ok(())
                },
            )
            .expect_err("a swapped public path must not inherit picker authorization");

        assert_eq!(error.code, BackupErrorCode::Unauthorized);
        assert!(moved.join(BACKUP_SUBFOLDER_NAME).is_dir());
        assert!(!replacement.join(BACKUP_SUBFOLDER_NAME).exists());
        assert!(core.lock().pending.is_none());
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
            .write_archive(&canonical_archive_name(&active.backup_set_id, 2), b"x")
            .unwrap();
    }

    #[test]
    fn reconfiguration_keeps_only_the_newest_folder_after_reload() {
        let fixture = fixture();
        let core_instance = core(&fixture);
        let active_a = configure(&core_instance, &fixture.selected_dir);

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
            .join(canonical_archive_name(&active_a.backup_set_id, 1))
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
    fn begin_configuration_rejects_cache_dir_and_its_descendants_or_ancestors() {
        let fixture = fixture();
        for selected in [
            fixture.app_cache_dir.clone(),
            fixture.app_cache_dir.join("provider-cache-child"),
        ] {
            fs::create_dir_all(&selected).unwrap();
            let error = core(&fixture)
                .begin_configuration(selected.to_str().unwrap())
                .expect_err("backup selection must never overlap the native trust cache");
            assert_eq!(error.code, BackupErrorCode::InsideAppData);
        }

        let root = TempDir::new().unwrap();
        let app_data = root.path().join("data-parent").join("app-data");
        let cache_parent = root.path().join("cache-parent");
        let app_cache = cache_parent.join("app-cache");
        fs::create_dir_all(&app_data).unwrap();
        fs::create_dir_all(&app_cache).unwrap();
        let core = BackupDirectoryCore::new(app_data, app_cache).unwrap();
        let error = core
            .begin_configuration(cache_parent.to_str().unwrap())
            .expect_err("an ancestor containing the native trust cache is not a backup target");
        assert_eq!(error.code, BackupErrorCode::InsideAppData);
    }

    #[test]
    fn test_archive_lands_in_pending_subfolder_and_activate_records_ledger() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let test_name = canonical_archive_name(&pending.backup_set_id, 2);
        let sha = core
            .write_test_archive(&test_name, b"wizard bytes")
            .unwrap();
        assert_eq!(sha, sha256_hex(b"wizard bytes"));

        let path = subfolder_of(&fixture.selected_dir).join(&test_name);
        assert!(
            path.is_file(),
            "test archive must land in pending subfolder"
        );
        assert_eq!(core.read_test_archive(&test_name).unwrap(), b"wizard bytes");

        core.activate_configuration().unwrap();
        let entries = core.ledger_entries().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file_name, test_name);
        assert_eq!(entries[0].sha256, sha);
        // RFC3339: 2026-08-08T19:42:00Z shape.
        assert_eq!(entries[0].created_at.len(), 20);
        assert!(entries[0].created_at.ends_with('Z'));
        assert_eq!(&entries[0].created_at[4..5], "-");
        assert_eq!(&entries[0].created_at[10..11], "T");
    }

    #[test]
    fn failed_prepublication_write_never_exposes_a_final_or_temp() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();

        let error =
            write_exclusive_with_hook(&anchor, "Partial.tesina", b"fully validated temp", || {
                Err(BackupError::new(
                    BackupErrorCode::Io,
                    "injected prepublication failure",
                ))
            })
            .expect_err("publication failure must propagate");

        assert_eq!(error.code, BackupErrorCode::Io);
        let subfolder = subfolder_of(&fixture.selected_dir);
        assert!(!subfolder.join("Partial.tesina").exists());
        assert!(fs::read_dir(subfolder).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".tmp-")));
    }

    #[cfg(unix)]
    #[test]
    fn publication_stays_in_held_subfolder_after_public_path_swap() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let public_subfolder = subfolder_of(&fixture.selected_dir);
        let moved_subfolder = fixture.selected_dir.join("Held Backups");
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();

        write_exclusive_with_hook(&anchor, "Anchored.tesina", b"anchored bytes", || {
            assert!(
                !public_subfolder.join("Anchored.tesina").exists(),
                "the public final must remain absent until atomic publication"
            );
            fs::rename(&public_subfolder, &moved_subfolder).unwrap();
            fs::create_dir(&public_subfolder).unwrap();
            Ok(())
        })
        .unwrap();

        assert_eq!(
            fs::read(moved_subfolder.join("Anchored.tesina")).unwrap(),
            b"anchored bytes"
        );
        assert!(!public_subfolder.join("Anchored.tesina").exists());
    }

    #[cfg(unix)]
    #[test]
    fn anchor_rejects_subfolder_swapped_between_identity_capture_and_open() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let public_subfolder = subfolder_of(&fixture.selected_dir);
        let moved_subfolder = fixture.selected_dir.join("Preopen Identity Backups");

        let error =
            BackupSubfolderAnchor::open_with_hook(Path::new(&active.canonical_folder_path), || {
                fs::rename(&public_subfolder, &moved_subfolder).unwrap();
                fs::create_dir(&public_subfolder).unwrap();
                Ok(())
            })
            .expect_err("a replacement directory must not inherit authorization");

        assert_eq!(error.code, BackupErrorCode::FolderUnavailable);
    }

    #[cfg(unix)]
    #[test]
    fn publication_rejects_and_preserves_a_swapped_temporary_path() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let subfolder = subfolder_of(&fixture.selected_dir);
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();

        let error =
            write_exclusive_with_hook(&anchor, "Swapped Temp.tesina", b"validated bytes", || {
                let temporary = fs::read_dir(&subfolder)
                    .unwrap()
                    .map(|entry| entry.unwrap().path())
                    .find(|path| {
                        path.file_name()
                            .unwrap()
                            .to_string_lossy()
                            .starts_with(".tmp-")
                    })
                    .unwrap();
                fs::rename(&temporary, subfolder.join("provider-held-temp")).unwrap();
                fs::write(&temporary, b"provider replacement").unwrap();
                Ok(())
            })
            .expect_err("a swapped temporary pathname must not publish");

        assert_eq!(error.code, BackupErrorCode::Io);
        assert!(!subfolder.join("Swapped Temp.tesina").exists());
        assert!(fs::read_dir(&subfolder).unwrap().any(|entry| {
            let path = entry.unwrap().path();
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(".tmp-")
                && fs::read(path).unwrap() == b"provider replacement"
        }));
    }

    #[cfg(unix)]
    #[test]
    fn read_stays_in_held_subfolder_after_public_path_swap() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        core.write_archive(&file_name, b"authorized bytes").unwrap();
        let public_subfolder = subfolder_of(&fixture.selected_dir);
        let moved_subfolder = fixture.selected_dir.join("Held Read Backups");
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();

        let bytes = BackupDirectoryCore::read_archive_file_with_hook(
            &anchor,
            &file_name,
            MAX_ARCHIVE_BYTES,
            || {
                fs::rename(&public_subfolder, &moved_subfolder).unwrap();
                fs::create_dir(&public_subfolder).unwrap();
                fs::write(public_subfolder.join(&file_name), b"redirected bytes").unwrap();
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(bytes, b"authorized bytes");
        assert_eq!(
            fs::read(public_subfolder.join(&file_name)).unwrap(),
            b"redirected bytes"
        );
    }

    #[cfg(unix)]
    #[test]
    fn removal_stays_in_held_subfolder_after_public_path_swap() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        let expected = core.write_archive(&file_name, b"authorized bytes").unwrap();
        let public_subfolder = subfolder_of(&fixture.selected_dir);
        let moved_subfolder = fixture.selected_dir.join("Held Removal Backups");
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();

        fs::rename(&public_subfolder, &moved_subfolder).unwrap();
        fs::create_dir(&public_subfolder).unwrap();
        fs::write(public_subfolder.join(&file_name), b"redirected bytes").unwrap();
        quarantine_and_remove_archive(&anchor, &file_name, &expected, |_| Ok(())).unwrap();

        assert!(!moved_subfolder.join(&file_name).exists());
        assert_eq!(
            fs::read(public_subfolder.join(&file_name)).unwrap(),
            b"redirected bytes"
        );
    }

    #[test]
    fn active_archive_reads_are_not_redirected_during_reconfiguration() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let active_name = canonical_archive_name(&active.backup_set_id, 2);
        core.write_archive(&active_name, b"active bytes").unwrap();

        let replacement = fixture._root.path().join("ReplacementFolder");
        fs::create_dir_all(&replacement).unwrap();
        let pending = core
            .begin_configuration(replacement.to_str().unwrap())
            .unwrap();
        let pending_name = canonical_archive_name(&pending.backup_set_id, 2);
        core.write_test_archive(&pending_name, b"pending bytes")
            .unwrap();

        assert_eq!(core.read_archive(&active_name).unwrap(), b"active bytes");
        assert_eq!(
            core.read_test_archive(&pending_name).unwrap(),
            b"pending bytes"
        );
    }

    #[test]
    fn activation_rejects_a_test_archive_changed_after_validation() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let test_name = canonical_archive_name(&pending.backup_set_id, 2);
        core.write_test_archive(&test_name, b"validated").unwrap();
        fs::write(
            subfolder_of(&fixture.selected_dir).join(&test_name),
            b"truncated",
        )
        .unwrap();

        let error = core
            .activate_configuration()
            .expect_err("changed test archive must not activate backups");
        assert_eq!(error.code, BackupErrorCode::HashMismatch);
        assert!(!core.control_dir.join(DIRECTORY_FILE_NAME).exists());
    }

    #[test]
    fn activation_does_not_persist_authorization_when_ledger_write_fails() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive(
            &canonical_archive_name(&pending.backup_set_id, 2),
            b"validated",
        )
        .unwrap();
        fs::create_dir(core.control_dir.join(LEDGER_FILE_NAME)).unwrap();

        core.activate_configuration()
            .expect_err("ledger failure must abort activation");
        assert!(!core.control_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(!core.status().configured);
    }

    #[test]
    fn stale_activation_epoch_cannot_commit_configuration() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive(
            &canonical_archive_name(&pending.backup_set_id, 2),
            b"validated",
        )
        .unwrap();
        let epoch = core.configuration_epoch();
        core.invalidate_configuration_epoch(epoch);

        let error = core
            .activate_configuration_at_epoch(epoch)
            .expect_err("a timed-out activation must not commit later");
        assert_eq!(error.code, BackupErrorCode::Timeout);
        assert!(!core.control_dir.join(DIRECTORY_FILE_NAME).exists());
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

        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let test_name = canonical_archive_name(&pending.backup_set_id, 2);
        core.write_test_archive(&test_name, b"mine").unwrap();
        core.cancel_configuration().unwrap();

        let subfolder = subfolder_of(&fixture.selected_dir);
        assert!(!subfolder.join(&test_name).exists(), "own test removed");
        assert_eq!(
            fs::read(subfolder.join("Other Device.tesina")).unwrap(),
            b"foreign",
            "foreign file untouched"
        );
        assert!(!core.status().configured, "cancel must not configure");
        assert!(!core.control_dir.join(DIRECTORY_FILE_NAME).exists());
    }

    #[test]
    fn cancel_keeps_a_test_archive_replaced_by_sync_and_remains_retryable() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let test_name = canonical_archive_name(&pending.backup_set_id, 2);
        core.write_test_archive(&test_name, b"owned test").unwrap();
        let path = subfolder_of(&fixture.selected_dir).join(&test_name);
        fs::write(&path, b"synced replacement").unwrap();

        let error = core
            .cancel_configuration()
            .expect_err("a replacement must not be deleted or forgotten");

        assert_eq!(error.code, BackupErrorCode::HashMismatch);
        assert_eq!(fs::read(path).unwrap(), b"synced replacement");
        assert!(core.lock().pending.is_some());
    }

    #[test]
    fn cancel_retains_pending_cleanup_until_the_folder_returns() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let test_name = canonical_archive_name(&pending.backup_set_id, 2);
        core.write_test_archive(&test_name, b"owned test").unwrap();
        let unavailable = fixture._root.path().join("TemporarilyUnavailable");
        fs::rename(&fixture.selected_dir, &unavailable).unwrap();

        let error = core
            .cancel_configuration()
            .expect_err("cleanup failure must be reported");
        assert_eq!(error.code, BackupErrorCode::FolderUnavailable);
        assert!(
            core.lock().pending.is_some(),
            "cleanup must remain retryable"
        );

        fs::rename(&unavailable, &fixture.selected_dir).unwrap();
        core.cancel_configuration().expect("retry cleanup");
        assert!(core.lock().pending.is_none());
        assert!(!subfolder_of(&fixture.selected_dir).join(test_name).exists());
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
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);

        core.write_archive(&file_name, b"original bytes").unwrap();
        let error = core
            .write_archive(&file_name, b"different bytes")
            .expect_err("second write must collide");
        assert_eq!(error.code, BackupErrorCode::NameTaken);
        assert_eq!(
            fs::read(subfolder_of(&fixture.selected_dir).join(&file_name)).unwrap(),
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
        let active = configure(&core, &fixture.selected_dir);
        let bytes = b"round trip payload".to_vec();
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        let sha = core.write_archive(&file_name, &bytes).unwrap();
        assert_eq!(sha, sha256_hex(&bytes));
        assert_eq!(core.read_archive(&file_name).unwrap(), bytes);
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .all(|entry| entry.file_name != file_name));
        core.confirm_archive(&file_name, &sha).unwrap();
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .any(|entry| entry.file_name == file_name));
    }

    #[test]
    fn active_archive_budget_allows_retention_recovery_then_rejects_cap_plus_one() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);

        let mut retained = Vec::new();
        for index in 0..6 {
            let file_name = canonical_archive_name(&active.backup_set_id, index + 2);
            let sha = core.write_archive(&file_name, b"retained bytes").unwrap();
            core.confirm_archive(&file_name, &sha).unwrap();
            retained.push((file_name, sha));
        }
        assert_eq!(core.ledger_entries().unwrap().len(), 7);

        let eighth_name = canonical_archive_name(&active.backup_set_id, 8);
        let eighth_sha = core
            .write_archive(&eighth_name, b"eighth bytes")
            .expect("seven retained plus one transient must fit");
        core.confirm_archive(&eighth_name, &eighth_sha).unwrap();
        let recovery_name = canonical_archive_name(&active.backup_set_id, 9);
        let recovery_sha = core
            .write_archive(&recovery_name, b"recovery candidate")
            .expect("an eight-entry ledger must still permit a later retention pass");
        core.confirm_archive(&recovery_name, &recovery_sha).unwrap();

        for index in 10..16 {
            let file_name = canonical_archive_name(&active.backup_set_id, index);
            let sha = core.write_archive(&file_name, b"headroom bytes").unwrap();
            core.confirm_archive(&file_name, &sha).unwrap();
        }
        assert_eq!(core.ledger_entries().unwrap().len(), 15);
        let transient_name = canonical_archive_name(&active.backup_set_id, 16);
        let transient_sha = core
            .write_archive(&transient_name, b"transient bytes")
            .expect("the sixteenth native-owned archive is the final allowed slot");
        let over_budget_name = canonical_archive_name(&active.backup_set_id, 17);
        let error = core
            .write_archive(&over_budget_name, b"must not reach disk")
            .expect_err("a seventeenth native-owned active archive must be rejected");
        assert_eq!(error.code, BackupErrorCode::ResourceLimit);
        let subfolder = subfolder_of(&fixture.selected_dir);
        assert!(!subfolder.join(&over_budget_name).exists());
        assert!(fs::read_dir(&subfolder).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".tmp-")));

        core.discard_pending_archive(&transient_name, &transient_sha)
            .unwrap();
        let replacement_name = canonical_archive_name(&active.backup_set_id, 18);
        let replacement_sha = core
            .write_archive(&replacement_name, b"replacement bytes")
            .expect("hash-bound discard must release transient capacity");
        core.confirm_archive(&replacement_name, &replacement_sha)
            .unwrap();
        let still_over_name = canonical_archive_name(&active.backup_set_id, 19);
        let error = core
            .write_archive(&still_over_name, b"must not reach disk")
            .expect_err("sixteen retained archives must exhaust the active budget");
        assert_eq!(error.code, BackupErrorCode::ResourceLimit);

        core.remove_archive(&retained[0].0, &retained[0].1).unwrap();
        core.write_archive(
            &canonical_archive_name(&active.backup_set_id, 20),
            b"capacity returned",
        )
        .expect("hash-bound retention removal must release active capacity");
    }

    #[test]
    fn missing_ledger_owned_archive_does_not_permanently_consume_native_budget() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let mut confirmed = Vec::new();
        for index in 1..MAX_ACTIVE_ARCHIVE_COUNT {
            let file_name = canonical_archive_name(&active.backup_set_id, index + 1);
            let sha = core.write_archive(&file_name, b"owned bytes").unwrap();
            core.confirm_archive(&file_name, &sha).unwrap();
            confirmed.push(file_name);
        }
        assert_eq!(
            core.ledger_entries().unwrap().len(),
            MAX_ACTIVE_ARCHIVE_COUNT
        );
        let subfolder = subfolder_of(&fixture.selected_dir);
        let foreign = subfolder.join("Foreign Evidence.tesina");
        fs::write(&foreign, b"foreign evidence").unwrap();
        fs::remove_file(subfolder.join(&confirmed[0])).unwrap();

        core.write_archive(
            &canonical_archive_name(&active.backup_set_id, 30),
            b"capacity returned",
        )
        .expect("a missing owned file must not permanently exhaust native capacity");
        assert_eq!(fs::read(foreign).unwrap(), b"foreign evidence");
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .any(|entry| entry.file_name == confirmed[0]));
    }

    #[test]
    fn pending_test_budget_is_separate_and_cancel_releases_it() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let first_name = canonical_archive_name(&pending.backup_set_id, 1);
        core.write_test_archive(&first_name, b"first").unwrap();

        let second_name = canonical_archive_name(&pending.backup_set_id, 2);
        let error = core
            .write_test_archive(&second_name, b"must not reach disk")
            .expect_err("only one setup test may be pending");
        assert_eq!(error.code, BackupErrorCode::ResourceLimit);
        assert!(!subfolder_of(&fixture.selected_dir)
            .join(&second_name)
            .exists());

        core.cancel_configuration().unwrap();
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        core.write_test_archive(
            &canonical_archive_name(&pending.backup_set_id, 1),
            b"capacity returned",
        )
        .expect("cancel must release pending-test capacity");
    }

    #[test]
    fn native_archive_budget_does_not_count_or_delete_foreign_files() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let subfolder = subfolder_of(&fixture.selected_dir);
        for index in 0..12 {
            fs::write(
                subfolder.join(format!("Foreign {index}.tesina")),
                b"foreign evidence",
            )
            .unwrap();
        }

        core.write_archive(
            &canonical_archive_name(&active.backup_set_id, 2),
            b"native bytes",
        )
        .expect("unledgered foreign evidence must not consume native ownership quota");
        for index in 0..12 {
            assert_eq!(
                fs::read(subfolder.join(format!("Foreign {index}.tesina"))).unwrap(),
                b"foreign evidence"
            );
        }
    }

    #[test]
    fn read_archive_stops_at_the_native_size_limit() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        core.write_archive(&file_name, b"0123456789").unwrap();

        let error = core
            .read_archive_with_limit(&file_name, 5)
            .expect_err("the reader must stop at max plus one byte");
        assert_eq!(error.code, BackupErrorCode::FileTooLarge);
    }

    #[test]
    fn confirm_archive_rejects_changed_bytes_without_ledgering_them() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        let sha = core.write_archive(&file_name, b"valid").unwrap();
        fs::write(
            subfolder_of(&fixture.selected_dir).join(&file_name),
            b"truncated",
        )
        .unwrap();

        let error = core
            .confirm_archive(&file_name, &sha)
            .expect_err("changed bytes must not enter the ledger");
        assert_eq!(error.code, BackupErrorCode::HashMismatch);
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .all(|entry| entry.file_name != file_name));
    }

    #[test]
    fn confirm_rejects_a_foreign_archive_without_native_pending_ownership() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let foreign = subfolder_of(&fixture.selected_dir).join("Foreign.tesina");
        fs::write(&foreign, b"foreign bytes").unwrap();

        let error = core
            .confirm_archive("Foreign.tesina", &sha256_hex(b"foreign bytes"))
            .expect_err("renderer knowledge of a hash must not create native ownership");

        assert_eq!(error.code, BackupErrorCode::Unauthorized);
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .all(|entry| entry.file_name != "Foreign.tesina"));
    }

    #[test]
    fn discard_pending_is_hash_bound_and_retains_ownership_on_refusal() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        let sha = core
            .write_archive(&file_name, b"unconfirmed bytes")
            .unwrap();
        let archive = subfolder_of(&fixture.selected_dir).join(&file_name);

        let error = core
            .discard_pending_archive(&file_name, &sha256_hex(b"wrong bytes"))
            .expect_err("a mismatched discard must preserve pending evidence");
        assert_eq!(error.code, BackupErrorCode::HashMismatch);
        assert_eq!(fs::read(&archive).unwrap(), b"unconfirmed bytes");

        core.discard_pending_archive(&file_name, &sha).unwrap();
        assert!(!archive.exists());
        let error = core
            .confirm_archive(&file_name, &sha)
            .expect_err("discard must retire native pending ownership");
        assert_eq!(error.code, BackupErrorCode::Unauthorized);
    }

    #[test]
    fn disable_and_reconfigure_clear_unconfirmed_native_ownership() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        core.write_archive(&canonical_archive_name(&active.backup_set_id, 2), b"first")
            .unwrap();
        assert_eq!(core.lock().pending_archives.len(), 1);

        let replacement = fixture._root.path().join("Replacement Backups");
        fs::create_dir(&replacement).unwrap();
        let pending = core
            .begin_configuration(replacement.to_str().unwrap())
            .unwrap();
        assert!(core.lock().pending_archives.is_empty());

        core.write_test_archive(
            &canonical_archive_name(&pending.backup_set_id, 1),
            b"replacement",
        )
        .unwrap();
        let active = core.activate_configuration().unwrap();
        core.write_archive(&canonical_archive_name(&active.backup_set_id, 2), b"second")
            .unwrap();
        assert_eq!(core.lock().pending_archives.len(), 1);
        core.disable().unwrap();
        assert!(core.lock().pending_archives.is_empty());
    }

    #[test]
    fn file_name_grammar_rejections() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);

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
        core.write_archive(&canonical_archive_name(&active.backup_set_id, 2), b"ok")
            .unwrap();
    }

    #[test]
    fn list_archives_skips_non_tesina_files_directories_and_symlinks() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let listed_name = canonical_archive_name(&active.backup_set_id, 2);
        core.write_archive(&listed_name, b"12345").unwrap();

        let subfolder = subfolder_of(&fixture.selected_dir);
        fs::write(subfolder.join("notes.txt"), b"not an archive").unwrap();
        fs::create_dir_all(subfolder.join("nested-dir")).unwrap();
        fs::write(subfolder.join("nested-dir").join("Inner.tesina"), b"nested").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(subfolder.join(&listed_name), subfolder.join("Link.tesina"))
            .unwrap();

        let listings = core.list_archives().unwrap();
        let names: Vec<_> = listings.iter().map(|l| l.file_name.as_str()).collect();
        assert!(names.contains(&listed_name.as_str()));
        assert!(
            names.contains(&canonical_archive_name(&active.backup_set_id, 1).as_str()),
            "wizard test archive listed"
        );
        assert!(!names.contains(&"notes.txt"));
        assert!(!names.contains(&"nested-dir"));
        assert!(!names.contains(&"Inner.tesina"), "never recurse");
        assert!(!names.contains(&"Link.tesina"), "skip symlinks");
        let listed = listings
            .iter()
            .find(|l| l.file_name == listed_name)
            .unwrap();
        assert_eq!(listed.byte_length, 5);
    }

    #[cfg(unix)]
    #[test]
    fn name_only_listing_enumerates_archive_names_without_opening_entries() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let subfolder = subfolder_of(&fixture.selected_dir);
        fs::create_dir(subfolder.join("Remote Directory.tesina")).unwrap();
        std::os::unix::fs::symlink(
            subfolder.join("missing-provider-placeholder"),
            subfolder.join("Remote Placeholder.tesina"),
        )
        .unwrap();
        fs::write(subfolder.join("notes.txt"), b"ignore").unwrap();

        let names = core.list_archive_names().unwrap();

        assert!(names.contains(&"Remote Directory.tesina".to_owned()));
        assert!(names.contains(&"Remote Placeholder.tesina".to_owned()));
        assert!(!names.contains(&"notes.txt".to_owned()));
    }

    #[test]
    fn name_only_listing_rejects_a_provider_directory_over_the_entry_cap() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let subfolder = subfolder_of(&fixture.selected_dir);
        for index in 0..=1024 {
            fs::write(
                subfolder.join(format!("foreign-{index:04}.txt")),
                b"foreign",
            )
            .unwrap();
        }

        let error = core
            .list_archive_names()
            .expect_err("name-only IPC enumeration must be bounded even for foreign entries");

        assert_eq!(error.code, BackupErrorCode::ResourceLimit);
    }

    #[test]
    fn hydrated_listing_rejects_a_provider_directory_over_the_entry_cap() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let subfolder = subfolder_of(&fixture.selected_dir);
        for index in 0..=1024 {
            fs::write(
                subfolder.join(format!("foreign-{index:04}.txt")),
                b"foreign",
            )
            .unwrap();
        }

        let error = core
            .list_archives()
            .expect_err("hydrated IPC enumeration must stop before collecting unbounded names");

        assert_eq!(error.code, BackupErrorCode::ResourceLimit);
    }

    #[test]
    fn remove_archive_with_wrong_hash_refuses_and_keeps_file_and_ledger() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        let sha = core.write_archive(&file_name, b"guarded bytes").unwrap();
        core.confirm_archive(&file_name, &sha).unwrap();

        let error = core
            .remove_archive(&file_name, &sha256_hex(b"some other bytes"))
            .expect_err("wrong hash must refuse deletion");
        assert_eq!(error.code, BackupErrorCode::HashMismatch);
        assert!(subfolder_of(&fixture.selected_dir)
            .join(&file_name)
            .is_file());
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .any(|entry| entry.file_name == file_name));
    }

    #[test]
    fn retention_rejects_a_foreign_archive_without_current_ledger_ownership() {
        let fixture = fixture();
        let core = core(&fixture);
        configure(&core, &fixture.selected_dir);
        let foreign = subfolder_of(&fixture.selected_dir).join("Foreign Retention.tesina");
        fs::write(&foreign, b"foreign retention bytes").unwrap();

        let error = core
            .remove_archive(
                "Foreign Retention.tesina",
                &sha256_hex(b"foreign retention bytes"),
            )
            .expect_err("retention must require current-set ledger ownership");

        assert_eq!(error.code, BackupErrorCode::Unauthorized);
        assert_eq!(fs::read(foreign).unwrap(), b"foreign retention bytes");
    }

    #[test]
    fn remove_archive_with_right_hash_deletes_file_and_ledger_entry() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        let sha = core.write_archive(&file_name, b"old bytes").unwrap();
        core.confirm_archive(&file_name, &sha).unwrap();

        core.remove_archive(&file_name, &sha).unwrap();
        assert!(!subfolder_of(&fixture.selected_dir)
            .join(&file_name)
            .exists());
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .all(|entry| entry.file_name != file_name));
        // The wizard test archive entry remains.
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .any(|entry| { entry.file_name == canonical_archive_name(&active.backup_set_id, 1) }));
    }

    #[test]
    fn active_removal_resumes_after_crash_immediately_after_quarantine_rename() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        let sha = core.write_archive(&file_name, b"retention bytes").unwrap();
        core.confirm_archive(&file_name, &sha).unwrap();
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();
        let quarantine = active_quarantine_name(&file_name, &sha);

        anchor.rename_no_replace(&file_name, &quarantine).unwrap();
        anchor.sync_directory().unwrap();
        core.remove_archive(&file_name, &sha)
            .expect("retry must discover and finish deterministic evidence");

        assert!(!anchor.child_exists(&file_name).unwrap());
        assert!(!anchor.child_exists(&quarantine).unwrap());
        assert!(!anchor
            .child_exists(&deletion_stage_name(&quarantine))
            .unwrap());
        assert!(core
            .ledger_entries()
            .unwrap()
            .iter()
            .all(|entry| entry.file_name != file_name));
    }

    #[test]
    fn removal_keeps_a_new_file_that_arrives_after_quarantine() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();
        let path = subfolder_of(&fixture.selected_dir).join("Raced.tesina");
        fs::write(&path, b"recorded bytes").unwrap();
        let expected = sha256_hex(b"recorded bytes");

        quarantine_and_remove_archive(&anchor, "Raced.tesina", &expected, |_| {
            fs::write(&path, b"new synced bytes")
                .map_err(|error| BackupError::io("test replacement failed", &error))
        })
        .unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new synced bytes");
        assert!(fs::read_dir(subfolder_of(&fixture.selected_dir))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".delete-")));
    }

    #[test]
    fn removal_restores_quarantined_bytes_changed_after_validation() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();
        let path = subfolder_of(&fixture.selected_dir).join("Changed Quarantine.tesina");
        fs::write(&path, b"recorded bytes").unwrap();
        let expected = sha256_hex(b"recorded bytes");

        let error = quarantine_and_remove_archive(
            &anchor,
            "Changed Quarantine.tesina",
            &expected,
            |quarantine| {
                fs::write(quarantine, b"provider replacement")
                    .map_err(|error| BackupError::io("test replacement failed", &error))
            },
        )
        .expect_err("changed quarantine bytes must not be deleted");

        assert_eq!(error.code, BackupErrorCode::HashMismatch);
        assert_eq!(fs::read(path).unwrap(), b"provider replacement");
    }

    #[test]
    fn removal_preserves_a_final_name_swap_before_delete_staging() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let anchor = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();
        let public = subfolder_of(&fixture.selected_dir).join("Final Swap.tesina");
        fs::write(&public, b"recorded bytes").unwrap();
        let expected = sha256_hex(b"recorded bytes");
        let retained_original = subfolder_of(&fixture.selected_dir).join("provider-held-evidence");

        let error = quarantine_and_remove_archive_with_hooks(
            &anchor,
            "Final Swap.tesina",
            &expected,
            |_| Ok(()),
            |evidence| {
                fs::rename(evidence, &retained_original)
                    .map_err(|error| BackupError::io("test evidence move failed", &error))?;
                fs::write(evidence, b"provider replacement")
                    .map_err(|error| BackupError::io("test replacement failed", &error))
            },
        )
        .expect_err("a final evidence-path swap must not delete either file");

        assert_eq!(error.code, BackupErrorCode::Io);
        assert_eq!(fs::read(public).unwrap(), b"provider replacement");
        assert_eq!(fs::read(retained_original).unwrap(), b"recorded bytes");
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
            .write_archive(&canonical_archive_name(&active.backup_set_id, 2), b"x")
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
        let active = configure(&core, &fixture.selected_dir);
        fs::remove_dir_all(&fixture.selected_dir).unwrap();

        let error = core
            .write_archive(&canonical_archive_name(&active.backup_set_id, 2), b"x")
            .expect_err("missing folder must be denied");
        assert_eq!(error.code, BackupErrorCode::FolderUnavailable);
        // Still configured (record loads) but unavailable, so UI can offer
        // Retry / Choose another folder.
        let reloaded =
            BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
                .unwrap();
        let status = reloaded.status();
        assert!(status.configured && !status.folder_available);
    }

    #[test]
    fn disable_deletes_record_but_leaves_archives_and_ledger_file() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let file_name = canonical_archive_name(&active.backup_set_id, 2);
        core.write_archive(&file_name, b"kept").unwrap();

        core.disable().unwrap();
        assert!(!core.control_dir.join(DIRECTORY_FILE_NAME).exists());
        assert!(
            core.control_dir.join(LEDGER_FILE_NAME).exists(),
            "ledger retained"
        );
        assert!(subfolder_of(&fixture.selected_dir)
            .join(file_name)
            .is_file());
        assert!(!core.status().configured);
        // Disabling twice stays idempotent.
        core.disable().unwrap();

        let reloaded =
            BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
                .unwrap();
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
            .write_archive(&canonical_archive_name(&first.backup_set_id, 2), b"one")
            .unwrap();
        core_instance.disable().unwrap();

        // Re-enable into a second folder: fresh set id never matches old entries.
        let second_dir = fixture._root.path().join("SecondFolder");
        fs::create_dir_all(&second_dir).unwrap();
        let second = configure(&core_instance, &second_dir);
        assert_ne!(first.backup_set_id, second.backup_set_id);

        let reloaded =
            BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
                .unwrap();
        let entries = reloaded.ledger_entries().unwrap();
        assert!(!entries.is_empty());
        assert!(entries
            .iter()
            .all(|entry| entry.backup_set_id == second.backup_set_id));
        assert!(entries
            .iter()
            .all(|entry| entry.file_name != "First Set.tesina"));

        // Old entries are retained on disk (never authorize a fresh set id).
        let raw = load_ledger(&core_instance.control_store).unwrap();
        assert!(raw
            .entries
            .iter()
            .any(|entry| entry.backup_set_id == first.backup_set_id));
    }

    #[test]
    fn untrusted_invalid_directory_record_is_ignored_during_bootstrap() {
        let fixture = fixture();
        let control_dir = fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME);
        fs::create_dir(&control_dir).unwrap();
        fs::write(
            control_dir.join(DIRECTORY_FILE_NAME),
            br#"{"schemaVersion":99,"canonicalFolderPath":"/x","backupSetId":"nope"}"#,
        )
        .unwrap();
        assert!(!core(&fixture).status().configured);
    }

    #[test]
    fn precreated_protected_config_without_native_cache_token_is_ignored() {
        let fixture = fixture();
        let control_dir = fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME);
        fs::create_dir(&control_dir).unwrap();
        let forged = BackupDirectoryConfig {
            schema_version: 1,
            canonical_folder_path: fixture.selected_dir.to_string_lossy().into_owned(),
            backup_set_id: "11111111-1111-4111-8111-111111111111".to_owned(),
        };
        fs::write(
            control_dir.join(DIRECTORY_FILE_NAME),
            serde_json::to_vec_pretty(&forged).unwrap(),
        )
        .unwrap();

        let opened = core(&fixture);

        let status = opened.status();
        assert!(!status.configured);
        assert!(status.requires_reauthorization);
    }

    #[test]
    fn renderer_visible_legacy_records_are_inert_and_never_promoted() {
        let fixture = fixture();
        let forged = BackupDirectoryConfig {
            schema_version: 1,
            canonical_folder_path: fixture.selected_dir.to_string_lossy().into_owned(),
            backup_set_id: "11111111-1111-4111-8111-111111111111".to_owned(),
        };
        let legacy = fixture.app_data_dir.join(DIRECTORY_FILE_NAME);
        fs::write(&legacy, serde_json::to_vec_pretty(&forged).unwrap()).unwrap();

        let opened = core(&fixture);

        assert!(!opened.status().configured);
        assert!(opened.status().requires_reauthorization);
        assert!(legacy.is_file(), "legacy evidence remains untouched");
        assert!(!opened.control_dir.join(DIRECTORY_FILE_NAME).exists());
    }

    #[test]
    fn legacy_evidence_requires_reauthorization_only_until_a_new_native_set_activates() {
        let fixture = fixture();
        fs::write(
            fixture.app_data_dir.join(DIRECTORY_FILE_NAME),
            b"renderer-visible legacy evidence",
        )
        .unwrap();

        let opened = core(&fixture);
        assert!(opened.status().requires_reauthorization);
        let active = configure(&opened, &fixture.selected_dir);
        drop(opened);

        let restarted = core(&fixture);
        let status = restarted.status();
        assert!(status.configured);
        assert!(!status.requires_reauthorization);
        assert_eq!(
            status.backup_set_id.as_deref(),
            Some(active.backup_set_id.as_str())
        );
        assert!(fixture.app_data_dir.join(DIRECTORY_FILE_NAME).is_file());
    }

    #[test]
    fn clean_start_creates_matching_fixed_size_authority_and_mirror_tokens() {
        let fixture = fixture();
        let opened = core(&fixture);
        let authority_token = fs::read(
            fixture
                .app_cache_dir
                .join(CONTROL_DIRECTORY_NAME)
                .join("backup-trust-token.bin"),
        )
        .expect("native cache token");
        let mirror_token = fs::read(
            fixture
                .app_data_dir
                .join(CONTROL_DIRECTORY_NAME)
                .join(TRUST_TOKEN_FILE_NAME),
        )
        .expect("AppData trust mirror");

        assert_eq!(authority_token.len(), TRUST_TOKEN_BYTES);
        assert_eq!(mirror_token, authority_token);
        assert!(opened.control_dir.starts_with(
            fs::canonicalize(&fixture.app_cache_dir).expect("canonical app cache root")
        ));
        let status = opened.status();
        assert!(!status.configured);
        assert!(!status.requires_reauthorization);
    }

    #[test]
    fn cache_clear_forces_reauthorization_across_normal_restarts_and_keeps_archives() {
        let fixture = fixture();
        let configured = core(&fixture);
        let active = configure(&configured, &fixture.selected_dir);
        let archive = subfolder_of(&fixture.selected_dir)
            .join(canonical_archive_name(&active.backup_set_id, 1));
        assert!(archive.is_file());
        fs::remove_dir_all(fixture.app_cache_dir.join(CONTROL_DIRECTORY_NAME)).unwrap();

        let after_clear = core(&fixture);
        let status = after_clear.status();
        assert!(!status.configured);
        assert!(status.requires_reauthorization);
        assert!(archive.is_file());

        let restarted = core(&fixture);
        let status = restarted.status();
        assert!(!status.configured);
        assert!(status.requires_reauthorization);
        assert!(archive.is_file());
    }

    #[test]
    fn oversized_sparse_config_is_quarantined_and_startup_stays_usable() {
        let fixture = fixture();
        let opened = core(&fixture);
        let oversized = opened.control_dir.join(DIRECTORY_FILE_NAME);
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(oversized)
            .unwrap();
        file.set_len((1024 * 1024 + 1) as u64).unwrap();
        drop(file);

        let recovered =
            BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
                .expect("bounded record corruption must not abort application setup");

        let status = recovered.status();
        assert!(!status.configured);
        assert!(status.requires_reauthorization);
        assert!(quarantined_control_directories(&fixture)
            .iter()
            .any(|directory| {
                fs::metadata(directory.join(DIRECTORY_FILE_NAME))
                    .map(|metadata| metadata.len() == (MAX_CONTROL_RECORD_BYTES + 1) as u64)
                    .unwrap_or(false)
            }));
        let active = configure(&recovered, &fixture.selected_dir);
        assert_eq!(
            recovered.status().backup_set_id.as_deref(),
            Some(active.backup_set_id.as_str()),
            "native picker and test flow must recover after a reset"
        );
    }

    #[test]
    fn malformed_trusted_config_is_quarantined_and_archives_remain_untouched() {
        let fixture = fixture();
        let opened = core(&fixture);
        let active = configure(&opened, &fixture.selected_dir);
        let archive = subfolder_of(&fixture.selected_dir)
            .join(canonical_archive_name(&active.backup_set_id, 1));
        let malformed =
            br#"{"schemaVersion":1,"canonicalFolderPath":"/forged","backupSetId":"not-a-uuid"}"#;
        fs::write(opened.control_dir.join(DIRECTORY_FILE_NAME), malformed).unwrap();

        let recovered =
            BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
                .expect("trusted config corruption must degrade to a disabled backup core");

        let status = recovered.status();
        assert!(!status.configured);
        assert!(status.requires_reauthorization);
        assert_eq!(fs::read(archive).unwrap(), b"test archive bytes");
        assert_quarantined_record(&fixture, DIRECTORY_FILE_NAME, malformed);
    }

    #[test]
    fn malformed_and_oversized_trusted_ledgers_are_quarantined_without_aborting_setup() {
        for oversized in [false, true] {
            let fixture = fixture();
            let opened = core(&fixture);
            let ledger_path = opened.control_dir.join(LEDGER_FILE_NAME);
            let expected = if oversized {
                let file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&ledger_path)
                    .unwrap();
                file.set_len((MAX_CONTROL_RECORD_BYTES + 1) as u64).unwrap();
                drop(file);
                None
            } else {
                fs::write(&ledger_path, b"not json").unwrap();
                Some(&b"not json"[..])
            };

            let recovered = BackupDirectoryCore::new(
                fixture.app_data_dir.clone(),
                fixture.app_cache_dir.clone(),
            )
            .expect("trusted ledger corruption must not propagate through application setup");

            let status = recovered.status();
            assert!(!status.configured);
            assert!(status.requires_reauthorization);
            if let Some(expected) = expected {
                assert_quarantined_record(&fixture, LEDGER_FILE_NAME, expected);
            } else {
                assert!(quarantined_control_directories(&fixture)
                    .iter()
                    .any(|directory| {
                        fs::metadata(directory.join(LEDGER_FILE_NAME))
                            .map(|metadata| metadata.len() == (MAX_CONTROL_RECORD_BYTES + 1) as u64)
                            .unwrap_or(false)
                    }));
            }
        }
    }

    #[test]
    fn active_config_requires_matching_validated_ledger_ownership_on_restart() {
        for unmatched in [false, true] {
            let fixture = fixture();
            let opened = core(&fixture);
            let active = configure(&opened, &fixture.selected_dir);
            let config_bytes = fs::read(opened.control_dir.join(DIRECTORY_FILE_NAME)).unwrap();
            if unmatched {
                let unrelated = Ledger {
                    schema_version: 1,
                    entries: vec![LedgerEntry {
                        file_name: "Unrelated Test.tesina".to_owned(),
                        sha256: sha256_hex(b"unrelated"),
                        created_at: "2026-08-18T12:00:00Z".to_owned(),
                        backup_set_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                    }],
                };
                fs::write(
                    opened.control_dir.join(LEDGER_FILE_NAME),
                    serde_json::to_vec_pretty(&unrelated).unwrap(),
                )
                .unwrap();
            } else {
                fs::remove_file(opened.control_dir.join(LEDGER_FILE_NAME)).unwrap();
            }

            let recovered = BackupDirectoryCore::new(
                fixture.app_data_dir.clone(),
                fixture.app_cache_dir.clone(),
            )
            .expect("missing or unmatched authorization proof must disable only backups");

            let status = recovered.status();
            assert!(!status.configured);
            assert!(status.requires_reauthorization);
            assert_quarantined_record(&fixture, DIRECTORY_FILE_NAME, &config_bytes);
            assert!(subfolder_of(&fixture.selected_dir)
                .join(canonical_archive_name(&active.backup_set_id, 1))
                .is_file());
        }
    }

    #[test]
    fn committed_active_set_clears_a_stale_reauthorization_marker_on_restart() {
        let fixture = fixture();
        let opened = core(&fixture);
        configure(&opened, &fixture.selected_dir);
        fs::write(opened.control_dir.join(REAUTHORIZATION_FILE_NAME), [1]).unwrap();

        let restarted = core(&fixture);

        let status = restarted.status();
        assert!(status.configured);
        assert!(!status.requires_reauthorization);
        assert!(!restarted
            .control_dir
            .join(REAUTHORIZATION_FILE_NAME)
            .exists());
    }

    #[test]
    fn trusted_ledger_entry_cap_resets_to_reauthorization_without_rewriting_evidence() {
        let fixture = fixture();
        let opened = core(&fixture);
        let ledger = Ledger {
            schema_version: 1,
            entries: (0..=MAX_LEDGER_ENTRIES)
                .map(|index| LedgerEntry {
                    file_name: format!("Bounded Ledger {index}.tesina"),
                    sha256: sha256_hex(index.to_string().as_bytes()),
                    created_at: "2026-08-18T12:00:00Z".to_owned(),
                    backup_set_id: "11111111-1111-4111-8111-111111111111".to_owned(),
                })
                .collect(),
        };
        let ledger_path = opened.control_dir.join(LEDGER_FILE_NAME);
        fs::write(&ledger_path, serde_json::to_vec(&ledger).unwrap()).unwrap();
        let before = fs::read(&ledger_path).unwrap();

        let recovered =
            BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
                .expect("an over-cap trusted ledger must disable backups, not application setup");
        assert!(!recovered.status().configured);
        assert!(recovered.status().requires_reauthorization);
        assert_quarantined_record(&fixture, LEDGER_FILE_NAME, &before);
    }

    #[test]
    fn activation_and_confirmation_never_persist_a_ledger_over_the_entry_cap() {
        let full_ledger = || Ledger {
            schema_version: 1,
            entries: (0..MAX_LEDGER_ENTRIES)
                .map(|index| LedgerEntry {
                    file_name: format!("Bounded Ownership {index}.tesina"),
                    sha256: sha256_hex(index.to_string().as_bytes()),
                    created_at: "2026-08-18T12:00:00Z".to_owned(),
                    backup_set_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                })
                .collect(),
        };

        let activation_fixture = fixture();
        let activation_core = core(&activation_fixture);
        write_json_atomic_with_hook(
            &activation_core.control_store,
            LEDGER_FILE_NAME,
            &full_ledger(),
            || Ok(()),
        )
        .unwrap();
        let pending = activation_core
            .begin_configuration(activation_fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let test_name = canonical_archive_name(&pending.backup_set_id, 31);
        activation_core
            .write_test_archive_at_operation(
                &test_name,
                b"validated setup",
                &activation_core.selected_operation(),
            )
            .unwrap();
        let error = activation_core
            .activate_configuration()
            .expect_err("activation must not append beyond the ledger cap");
        assert_eq!(error.code, BackupErrorCode::ResourceLimit);
        assert!(!activation_core
            .control_dir
            .join(DIRECTORY_FILE_NAME)
            .exists());
        assert_eq!(
            load_ledger(&activation_core.control_store)
                .unwrap()
                .entries
                .len(),
            MAX_LEDGER_ENTRIES
        );

        let confirmation_fixture = fixture();
        let confirmation_core = core(&confirmation_fixture);
        let active = configure(&confirmation_core, &confirmation_fixture.selected_dir);
        write_json_atomic_with_hook(
            &confirmation_core.control_store,
            LEDGER_FILE_NAME,
            &full_ledger(),
            || Ok(()),
        )
        .unwrap();
        let candidate = canonical_archive_name(&active.backup_set_id, 32);
        let sha = confirmation_core
            .write_archive_at_operation(
                &candidate,
                b"pending confirmation",
                &confirmation_core.selected_operation(),
            )
            .unwrap();
        let error = confirmation_core
            .confirm_archive(&candidate, &sha)
            .expect_err("confirmation must not append beyond the ledger cap");
        assert_eq!(error.code, BackupErrorCode::ResourceLimit);
        assert_eq!(
            load_ledger(&confirmation_core.control_store)
                .unwrap()
                .entries
                .len(),
            MAX_LEDGER_ENTRIES
        );
        assert!(confirmation_core
            .lock()
            .pending_archives
            .iter()
            .any(|pending| pending.file_name == candidate));
    }

    #[test]
    fn precreated_non_directory_control_path_is_quarantined_before_bootstrap() {
        let fixture = fixture();
        let precreated = fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME);
        fs::write(&precreated, b"renderer-controlled evidence").unwrap();

        let opened = core(&fixture);

        assert!(!opened.status().configured);
        assert!(opened.status().requires_reauthorization);
        assert!(opened.control_dir.is_dir());
        assert!(opened.control_dir.join(TRUST_TOKEN_FILE_NAME).is_file());
        assert_ne!(
            fs::read(&precreated).ok().as_deref(),
            Some(&b"renderer-controlled evidence"[..])
        );
    }

    #[test]
    fn precreated_non_directory_cache_path_disables_backups_without_aborting_setup() {
        let fixture = fixture();
        let precreated = fixture.app_cache_dir.join(CONTROL_DIRECTORY_NAME);
        fs::write(&precreated, b"ambiguous cache evidence").unwrap();

        let opened =
            BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
                .expect("a replaceable cache-control type conflict must not abort app setup");

        assert!(!opened.status().configured);
        assert!(opened.status().requires_reauthorization);
        assert!(fixture.app_cache_dir.join(CONTROL_DIRECTORY_NAME).is_dir());
    }

    #[test]
    fn trusted_control_record_type_conflict_is_quarantined_and_disabled() {
        let fixture = fixture();
        let opened = core(&fixture);
        fs::create_dir(opened.control_dir.join(DIRECTORY_FILE_NAME)).unwrap();

        let recovered =
            BackupDirectoryCore::new(fixture.app_data_dir.clone(), fixture.app_cache_dir.clone())
                .expect("a replaceable child-record type conflict must not abort app setup");

        assert!(!recovered.status().configured);
        assert!(recovered.status().requires_reauthorization);
        assert!(quarantined_control_directories(&fixture)
            .iter()
            .any(|directory| directory.join(DIRECTORY_FILE_NAME).is_dir()));
    }

    #[test]
    fn unusable_application_data_root_remains_a_fatal_constructor_error() {
        let root = TempDir::new().unwrap();
        let app_data = root.path().join("app-data-file");
        let app_cache = root.path().join("app-cache");
        fs::write(&app_data, b"not a directory").unwrap();

        let error = BackupDirectoryCore::new(app_data, app_cache)
            .err()
            .expect("the application data root is not backup-only state and must remain fatal");

        assert_eq!(error.code, BackupErrorCode::Io);
    }

    #[cfg(unix)]
    #[test]
    fn native_control_anchor_never_follows_a_child_swapped_to_a_symlink_before_open() {
        let root = TempDir::new().unwrap();
        let parent = root.path().join("app-data");
        let outside = root.path().join("outside");
        fs::create_dir(&parent).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("evidence"), b"outside").unwrap();

        let error = NativeDirectoryAnchor::open_or_create_with_hook(
            &parent,
            CONTROL_DIRECTORY_NAME,
            "native backup control directory",
            || {
                fs::remove_dir(parent.join(CONTROL_DIRECTORY_NAME)).unwrap();
                std::os::unix::fs::symlink(&outside, parent.join(CONTROL_DIRECTORY_NAME)).unwrap();
                Ok(())
            },
        )
        .expect_err("the held parent must not allow a child symlink redirect");

        assert!(matches!(
            error.code,
            BackupErrorCode::SymlinkRejected | BackupErrorCode::Io
        ));
        assert_eq!(fs::read(outside.join("evidence")).unwrap(), b"outside");
    }

    #[cfg(unix)]
    #[test]
    fn empty_precreated_control_directory_alias_never_exposes_the_new_trust_token() {
        let fixture = fixture();
        let precreated = fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME);
        fs::create_dir(&precreated).unwrap();
        fs::write(precreated.join("inert-evidence"), b"precreated").unwrap();
        let alias = fixture.app_data_dir.join("renderer-allowed-alias");
        std::os::unix::fs::symlink(CONTROL_DIRECTORY_NAME, &alias).unwrap();

        let opened = core(&fixture);

        assert!(opened.control_dir.join(TRUST_TOKEN_FILE_NAME).is_file());
        assert!(fs::read(alias.join(TRUST_TOKEN_FILE_NAME)).is_err());
        assert_eq!(
            fs::read(alias.join("inert-evidence")).unwrap(),
            b"precreated"
        );
        assert_ne!(
            fs::canonicalize(&alias).unwrap(),
            fs::canonicalize(&opened.control_dir).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn empty_precreated_cache_directory_alias_never_exposes_the_new_trust_token() {
        let fixture = fixture();
        let precreated = fixture.app_cache_dir.join(CONTROL_DIRECTORY_NAME);
        fs::create_dir(&precreated).unwrap();
        fs::write(precreated.join("inert-evidence"), b"precreated cache").unwrap();
        let alias = fixture.app_cache_dir.join("renderer-allowed-cache-alias");
        std::os::unix::fs::symlink(CONTROL_DIRECTORY_NAME, &alias).unwrap();

        let opened = core(&fixture);

        assert!(!opened.status().configured);
        assert!(opened.status().requires_reauthorization);
        assert!(fixture
            .app_cache_dir
            .join(CONTROL_DIRECTORY_NAME)
            .join(TRUST_TOKEN_FILE_NAME)
            .is_file());
        assert!(fs::read(alias.join(TRUST_TOKEN_FILE_NAME)).is_err());
        assert_eq!(
            fs::read(alias.join("inert-evidence")).unwrap(),
            b"precreated cache"
        );
        assert_ne!(
            fs::canonicalize(&alias).unwrap(),
            fs::canonicalize(fixture.app_cache_dir.join(CONTROL_DIRECTORY_NAME)).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn precreated_control_symlink_is_quarantined_without_touching_its_target() {
        let fixture = fixture();
        let outside = fixture._root.path().join("renderer-readable-outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("evidence"), b"outside").unwrap();
        std::os::unix::fs::symlink(&outside, fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME))
            .unwrap();

        let opened = core(&fixture);

        assert!(!opened.status().configured);
        assert!(opened.status().requires_reauthorization);
        assert_eq!(fs::read(outside.join("evidence")).unwrap(), b"outside");
        assert!(!outside.join(TRUST_TOKEN_FILE_NAME).exists());
        assert!(opened.control_dir.join(TRUST_TOKEN_FILE_NAME).is_file());
    }

    #[cfg(unix)]
    #[test]
    fn precreated_token_symlink_is_never_followed_and_forces_control_reset() {
        let fixture = fixture();
        let control = fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME);
        fs::create_dir(&control).unwrap();
        let outside = fixture._root.path().join("renderer-token-evidence");
        fs::write(&outside, [7_u8; TRUST_TOKEN_BYTES]).unwrap();
        std::os::unix::fs::symlink(&outside, control.join(TRUST_TOKEN_FILE_NAME)).unwrap();

        let opened = core(&fixture);

        assert!(!opened.status().configured);
        assert!(opened.status().requires_reauthorization);
        assert_eq!(fs::read(&outside).unwrap(), [7_u8; TRUST_TOKEN_BYTES]);
        assert_ne!(
            fs::read(opened.control_dir.join(TRUST_TOKEN_FILE_NAME)).unwrap(),
            [7_u8; TRUST_TOKEN_BYTES]
        );
    }

    #[cfg(windows)]
    #[test]
    fn precreated_control_reparse_directory_is_quarantined_without_touching_its_target() {
        let fixture = fixture();
        let outside = fixture._root.path().join("renderer-readable-outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("evidence"), b"outside").unwrap();
        std::os::windows::fs::symlink_dir(
            &outside,
            fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME),
        )
        .unwrap();

        let opened = core(&fixture);

        assert!(!opened.status().configured);
        assert!(opened.status().requires_reauthorization);
        assert_eq!(fs::read(outside.join("evidence")).unwrap(), b"outside");
        assert!(!outside.join(TRUST_TOKEN_FILE_NAME).exists());
        assert!(opened.control_dir.join(TRUST_TOKEN_FILE_NAME).is_file());
    }

    #[cfg(windows)]
    #[test]
    fn empty_precreated_control_directory_alias_never_exposes_new_windows_trust_token() {
        let fixture = fixture();
        let precreated = fixture.app_data_dir.join(CONTROL_DIRECTORY_NAME);
        fs::create_dir(&precreated).unwrap();
        fs::write(precreated.join("inert-evidence"), b"precreated").unwrap();
        let alias = fixture.app_data_dir.join("renderer-allowed-alias");
        std::os::windows::fs::symlink_dir(CONTROL_DIRECTORY_NAME, &alias).unwrap();

        let opened = core(&fixture);

        assert!(opened.control_dir.join(TRUST_TOKEN_FILE_NAME).is_file());
        assert!(fs::read(alias.join(TRUST_TOKEN_FILE_NAME)).is_err());
        assert_eq!(
            fs::read(alias.join("inert-evidence")).unwrap(),
            b"precreated"
        );
        assert_ne!(
            fs::canonicalize(&alias).unwrap(),
            fs::canonicalize(&opened.control_dir).unwrap()
        );
    }

    fn canonical_archive_name(backup_set_id: &str, second: usize) -> String {
        format!(
            "Tesina Library - {} - 2026-08-18T12-00-{second:02}Z.tesina",
            &backup_set_id[..8]
        )
    }

    #[test]
    fn native_write_admission_requires_the_exact_pending_and_active_set_prefix() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let operation = core.selected_operation();
        let wrong = canonical_archive_name("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 0);
        let error = core
            .write_test_archive_at_operation(&wrong, b"wrong pending set", &operation)
            .expect_err("a different pending-set prefix must be rejected");
        assert_eq!(error.code, BackupErrorCode::InvalidFileName);

        let test_name = canonical_archive_name(&pending.backup_set_id, 1);
        core.write_test_archive_at_operation(&test_name, b"pending set", &operation)
            .unwrap();
        let active = core.activate_configuration().unwrap();
        assert_eq!(active.backup_set_id, pending.backup_set_id);

        let wrong = canonical_archive_name("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 2);
        let error = core
            .write_archive_at_operation(&wrong, b"wrong active set", &operation)
            .expect_err("a different active-set prefix must be rejected");
        assert_eq!(error.code, BackupErrorCode::InvalidFileName);
        let correct = canonical_archive_name(&active.backup_set_id, 3);
        core.write_archive_at_operation(&correct, b"active set", &operation)
            .unwrap();
    }

    #[test]
    fn wrong_prefix_and_full_occupancy_preflight_reject_before_body_materialization() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        let wrong = canonical_archive_name("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 0);
        let pending_materialized = std::cell::Cell::new(false);
        let _permit = core.try_archive_body_admission().unwrap();
        let error = core
            .preflight_test_archive_write(&wrong)
            .and_then(|()| {
                pending_materialized.set(true);
                clone_raw_bytes_bounded(b"must not clone", MAX_ARCHIVE_BYTES).map(|_| ())
            })
            .expect_err("a wrong pending prefix must fail before cloning the raw body");
        assert_eq!(error.code, BackupErrorCode::InvalidFileName);
        assert!(!pending_materialized.get());
        drop(_permit);

        let test_name = canonical_archive_name(&pending.backup_set_id, 1);
        core.write_test_archive_at_operation(&test_name, b"validated", &core.selected_operation())
            .unwrap();
        let active = core.activate_configuration().unwrap();
        let subfolder = subfolder_of(&fixture.selected_dir);
        for second in 0..MAX_ACTIVE_ARCHIVE_COUNT {
            fs::write(
                subfolder.join(canonical_archive_name(&active.backup_set_id, second)),
                b"present",
            )
            .unwrap();
        }
        let blocked = canonical_archive_name(&active.backup_set_id, MAX_ACTIVE_ARCHIVE_COUNT);
        let active_materialized = std::cell::Cell::new(false);
        let _permit = core.try_archive_body_admission().unwrap();
        let error = core
            .preflight_active_archive_write(&blocked)
            .and_then(|()| {
                active_materialized.set(true);
                clone_raw_bytes_bounded(b"must not clone", MAX_ARCHIVE_BYTES).map(|_| ())
            })
            .expect_err("full occupancy must fail before cloning the raw body");
        assert_eq!(error.code, BackupErrorCode::ResourceLimit);
        assert!(!active_materialized.get());
        assert!(!subfolder.join(blocked).exists());
    }

    #[test]
    fn unavailable_pending_provider_is_rejected_before_test_body_materialization() {
        let fixture = fixture();
        let core = core(&fixture);
        let pending = core
            .begin_configuration(fixture.selected_dir.to_str().unwrap())
            .unwrap();
        fs::remove_dir(subfolder_of(&fixture.selected_dir)).unwrap();
        let name = canonical_archive_name(&pending.backup_set_id, 41);
        let materialized = std::cell::Cell::new(false);

        let error = core
            .preflight_test_archive_write(&name)
            .and_then(|()| {
                materialized.set(true);
                clone_raw_bytes_bounded(b"must not clone", MAX_ARCHIVE_BYTES).map(|_| ())
            })
            .expect_err("provider availability must be checked before cloning the test body");

        assert_eq!(error.code, BackupErrorCode::FolderUnavailable);
        assert!(!materialized.get());
    }

    #[cfg(any(target_os = "macos", windows))]
    #[test]
    fn occupancy_counts_case_aliases_according_to_held_volume_semantics() {
        let fixture = fixture();
        let core = core(&fixture);
        let active = configure(&core, &fixture.selected_dir);
        let subfolder = resolve_subfolder(Path::new(&active.canonical_folder_path)).unwrap();
        let canonical = canonical_archive_name(&active.backup_set_id, 42);
        let case_alias = canonical.to_ascii_uppercase();
        fs::write(
            subfolder_of(&fixture.selected_dir).join(&case_alias),
            b"alias",
        )
        .unwrap();

        let case_sensitive = subfolder.is_case_sensitive_volume().unwrap();
        assert_eq!(
            count_present_automatic_archives(&subfolder, &active.backup_set_id, 1).unwrap(),
            usize::from(!case_sensitive),
        );
        assert_eq!(
            validate_automatic_archive_name(&case_alias, &active.backup_set_id)
                .unwrap_err()
                .code,
            BackupErrorCode::InvalidFileName,
            "renderer admission remains exact-case even on case-insensitive volumes",
        );
    }

    #[test]
    fn restart_stable_name_occupancy_caps_unledgered_active_set_and_external_removal_frees_space() {
        let fixture = fixture();
        let core_instance = core(&fixture);
        let active = configure(&core_instance, &fixture.selected_dir);
        let operation = core_instance.selected_operation();
        let mut names = Vec::new();
        for second in 2..=MAX_ACTIVE_ARCHIVE_COUNT {
            let name = canonical_archive_name(&active.backup_set_id, second);
            core_instance
                .write_archive_at_operation(&name, b"unconfirmed", &operation)
                .unwrap();
            names.push(name);
        }
        drop(core_instance);

        let restarted = core(&fixture);
        let operation = restarted.selected_operation();
        let blocked = canonical_archive_name(&active.backup_set_id, MAX_ACTIVE_ARCHIVE_COUNT + 1);
        let error = restarted
            .write_archive_at_operation(&blocked, b"must not reach disk", &operation)
            .expect_err("unledgered matching names must still count after restart");
        assert_eq!(error.code, BackupErrorCode::ResourceLimit);
        assert!(!subfolder_of(&fixture.selected_dir).join(&blocked).exists());

        fs::remove_file(subfolder_of(&fixture.selected_dir).join(&names[0])).unwrap();
        restarted
            .write_archive_at_operation(&blocked, b"capacity returned", &operation)
            .expect("external removal of a matching name must free one slot");
    }

    #[test]
    fn rfc3339_formatting_is_correct() {
        assert_eq!(rfc3339_from_unix(0), "1970-01-01T00:00:00Z");
        // 2026-08-08 19:42:00 UTC
        assert_eq!(rfc3339_from_unix(1_786_218_120), "2026-08-08T19:42:00Z");
        assert_eq!(rfc3339_from_unix(951_827_696), "2000-02-29T12:34:56Z");
    }
}
