use same_file::Handle as FileIdentity;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::io::ErrorKind;
use std::io::{self, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
#[cfg(not(feature = "packaged-portable-smoke"))]
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
const MAX_RELATED_FILES_PER_DESTINATION: usize = 4;
const MAX_EXTERNAL_SAVE_AUTHORIZATIONS: usize = 4;
const RECOVERY_QUARANTINE_SUFFIX: &str = ".tesina-recovery";
const DUPLICATE_RECOVERY_SUFFIX: &str = ".tesina-duplicate-recovery";
const DELETE_READY_SUFFIX: &str = ".tesina-delete-ready";
static RELATED_FILE_MUTATION_LOCK: Mutex<()> = Mutex::new(());
static EXTERNAL_ARCHIVE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
#[cfg(feature = "packaged-portable-smoke")]
static PACKAGED_SMOKE_DESTINATION_CONSUMED: AtomicBool = AtomicBool::new(false);

#[derive(Debug)]
struct ExternalArchiveAdmission;

impl ExternalArchiveAdmission {
    fn try_acquire() -> Result<Self, ExternalFileError> {
        EXTERNAL_ARCHIVE_IN_FLIGHT
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map(|_| Self)
            .map_err(|_| {
                ExternalFileError::resource_limit(
                    "another external archive read or write is already in progress",
                )
            })
    }
}

impl Drop for ExternalArchiveAdmission {
    fn drop(&mut self) {
        EXTERNAL_ARCHIVE_IN_FLIGHT.store(false, Ordering::Release);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RelatedKind {
    Temporary,
    Previous,
}

impl RelatedKind {
    fn suffix(self) -> &'static str {
        match self {
            Self::Temporary => ".tmp",
            Self::Previous => ".prev",
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
struct RelatedTarget {
    destination: PathBuf,
    kind: RelatedKind,
}

#[derive(Debug)]
struct AuthorizedRelated {
    target: RelatedTarget,
    directory: Arc<AnchoredRelatedDir>,
}

#[derive(Debug)]
struct ExternalSaveAuthorization {
    destination: PathBuf,
    resolved_destination: PathBuf,
    directory: Arc<AnchoredRelatedDir>,
}

#[derive(Debug, Default)]
pub struct ExternalSaveAuthorizations {
    entries: Mutex<HashMap<String, Arc<ExternalSaveAuthorization>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSaveSelection {
    path: String,
    authorization_token: String,
}

#[derive(Debug)]
struct AnchoredRelatedDir {
    logical_parent: PathBuf,
    resolved_parent: PathBuf,
    directory: fs::File,
    #[cfg(windows)]
    _ancestor_directories: Vec<fs::File>,
}

impl AnchoredRelatedDir {
    fn open(logical_parent: &Path) -> Result<Self, String> {
        if !logical_parent.is_absolute() {
            return Err("related file parent must be absolute".to_owned());
        }
        let resolved_parent = fs::canonicalize(logical_parent)
            .map_err(|error| format!("cannot resolve selected destination directory: {error}"))?;
        #[cfg(windows)]
        let (directory, ancestor_directories) =
            Self::open_windows_directory_chain(&resolved_parent)?;
        #[cfg(not(windows))]
        let directory = Self::open_directory(&resolved_parent)?;
        let held_identity = directory
            .try_clone()
            .and_then(FileIdentity::from_file)
            .map_err(|error| format!("cannot identify selected destination directory: {error}"))?;
        let current_parent = fs::canonicalize(logical_parent).map_err(|error| {
            format!("cannot revalidate selected destination directory: {error}")
        })?;
        let current_identity = FileIdentity::from_path(&current_parent).map_err(|error| {
            format!("cannot identify current selected destination directory: {error}")
        })?;
        if held_identity != current_identity {
            return Err("selected destination directory changed during authorization".to_owned());
        }
        Ok(Self {
            logical_parent: logical_parent.to_path_buf(),
            resolved_parent: current_parent,
            directory,
            #[cfg(windows)]
            _ancestor_directories: ancestor_directories,
        })
    }

    #[cfg(unix)]
    fn open_directory(path: &Path) -> Result<fs::File, String> {
        use rustix::fs::{openat, Mode, OFlags, CWD};

        openat(
            CWD,
            path,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map(fs::File::from)
        .map_err(|error| format!("cannot hold selected destination directory: {error}"))
    }

    #[cfg(windows)]
    fn open_windows_directory(path: &Path) -> Result<fs::File, String> {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };

        let mut options = fs::OpenOptions::new();
        options
            .access_mode(FILE_READ_ATTRIBUTES.0)
            .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0);
        options
            .open(path)
            .map_err(|error| format!("cannot hold selected destination directory: {error}"))
    }

    #[cfg(windows)]
    fn open_windows_directory_chain(path: &Path) -> Result<(fs::File, Vec<fs::File>), String> {
        let mut directories = path.ancestors().collect::<Vec<_>>();
        directories.reverse();
        let mut handles = directories
            .into_iter()
            .map(Self::open_windows_directory)
            .collect::<Result<Vec<_>, _>>()?;
        let directory = handles
            .pop()
            .ok_or_else(|| "selected destination directory has no anchor".to_owned())?;
        Ok((directory, handles))
    }

    #[cfg(not(any(unix, windows)))]
    fn open_directory(path: &Path) -> Result<fs::File, String> {
        fs::File::open(path)
            .map_err(|error| format!("cannot hold selected destination directory: {error}"))
    }

    fn checked_name<'a>(&self, path: &'a Path) -> Result<&'a OsStr, String> {
        if path.parent() != Some(self.logical_parent.as_path()) {
            return Err("related file escaped the selected destination directory".to_owned());
        }
        path.file_name()
            .ok_or_else(|| "related file has no name".to_owned())
    }

    fn resolved_child(&self, path: &Path) -> Result<PathBuf, String> {
        Ok(self.resolved_parent.join(self.checked_name(path)?))
    }

    #[cfg(unix)]
    fn open_child_read(&self, path: &Path, label: &str) -> Result<fs::File, String> {
        use rustix::fs::{openat, Mode, OFlags};

        let name = self.checked_name(path)?;
        openat(
            &self.directory,
            name,
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map(fs::File::from)
        .map_err(|error| format!("cannot open {label}: {error}"))
    }

    #[cfg(windows)]
    fn open_child_read(&self, path: &Path, label: &str) -> Result<fs::File, String> {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;

        fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(self.resolved_child(path)?)
            .map_err(|error| format!("cannot open {label}: {error}"))
    }

    #[cfg(not(any(unix, windows)))]
    fn open_child_read(&self, path: &Path, label: &str) -> Result<fs::File, String> {
        fs::File::open(self.resolved_child(path)?)
            .map_err(|error| format!("cannot open {label}: {error}"))
    }

    #[cfg(unix)]
    fn create_child_new(&self, path: &Path, label: &str) -> Result<fs::File, String> {
        use rustix::fs::{openat, Mode, OFlags};

        let name = self.checked_name(path)?;
        openat(
            &self.directory,
            name,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::from_raw_mode(0o666),
        )
        .map(fs::File::from)
        .map_err(|error| format!("cannot create {label} exclusively: {error}"))
    }

    #[cfg(not(unix))]
    fn create_child_new(&self, path: &Path, label: &str) -> Result<fs::File, String> {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.resolved_child(path)?)
            .map_err(|error| format!("cannot create {label} exclusively: {error}"))
    }

    fn ensure_regular(&self, path: &Path, label: &str) -> Result<FileIdentity, String> {
        let file = self.open_child_read(path, label)?;
        let metadata = file
            .metadata()
            .map_err(|error| format!("cannot inspect {label}: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!("{label} is not a regular file"));
        }
        FileIdentity::from_file(file).map_err(|error| format!("cannot identify {label}: {error}"))
    }

    fn regular_exists(&self, path: &Path, label: &str) -> Result<bool, String> {
        match self.open_child_read(path, label) {
            Ok(file) => {
                let metadata = file
                    .metadata()
                    .map_err(|error| format!("cannot inspect {label}: {error}"))?;
                if !metadata.file_type().is_symlink() && metadata.is_file() {
                    Ok(true)
                } else {
                    Err(format!("{label} is not a regular file"))
                }
            }
            Err(error) => {
                #[cfg(unix)]
                {
                    use rustix::fs::{statat, AtFlags};
                    use rustix::io::Errno;

                    if matches!(
                        statat(
                            &self.directory,
                            self.checked_name(path)?,
                            AtFlags::SYMLINK_NOFOLLOW
                        ),
                        Err(Errno::NOENT)
                    ) {
                        return Ok(false);
                    }
                }
                #[cfg(not(unix))]
                if matches!(
                    fs::symlink_metadata(self.resolved_child(path)?),
                    Err(ref source) if source.kind() == ErrorKind::NotFound
                ) {
                    return Ok(false);
                }
                Err(error)
            }
        }
    }

    #[cfg(unix)]
    fn for_each_entry<F>(&self, mut visit: F) -> Result<(), String>
    where
        F: FnMut(PathBuf),
    {
        use rustix::fs::Dir;
        use std::os::unix::ffi::OsStrExt;

        let directory = Dir::read_from(&self.directory)
            .map_err(|error| format!("cannot inspect related files: {error}"))?;
        for entry in directory {
            let entry =
                entry.map_err(|error| format!("cannot inspect related file entry: {error}"))?;
            let name = OsStr::from_bytes(entry.file_name().to_bytes());
            visit(self.logical_parent.join(name));
        }
        Ok(())
    }

    #[cfg(not(unix))]
    fn for_each_entry<F>(&self, mut visit: F) -> Result<(), String>
    where
        F: FnMut(PathBuf),
    {
        let entries = fs::read_dir(&self.resolved_parent)
            .map_err(|error| format!("cannot inspect related files: {error}"))?;
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("cannot inspect related file entry: {error}"))?;
            visit(self.logical_parent.join(entry.file_name()));
        }
        Ok(())
    }

    #[cfg(unix)]
    fn rename_no_replace(&self, from: &Path, to: &Path) -> Result<(), PublishError> {
        use rustix::fs::{renameat_with, RenameFlags};
        use rustix::io::Errno;

        let from = self.checked_name(from).map_err(PublishError::Other)?;
        let to = self.checked_name(to).map_err(PublishError::Other)?;
        match renameat_with(
            &self.directory,
            from,
            &self.directory,
            to,
            RenameFlags::NOREPLACE,
        ) {
            Ok(()) => Ok(()),
            Err(Errno::EXIST | Errno::NOTEMPTY) => Err(PublishError::NameTaken(
                "destination already exists".to_owned(),
            )),
            Err(error) => Err(PublishError::Other(format!(
                "cannot publish destination without replacing it: {error}"
            ))),
        }
    }

    #[cfg(windows)]
    fn rename_no_replace(&self, from: &Path, to: &Path) -> Result<(), PublishError> {
        rename_path_no_replace(
            &self.resolved_child(from).map_err(PublishError::Other)?,
            &self.resolved_child(to).map_err(PublishError::Other)?,
        )
    }

    #[cfg(not(any(unix, windows)))]
    fn rename_no_replace(&self, from: &Path, to: &Path) -> Result<(), PublishError> {
        rename_path_no_replace(
            &self.resolved_child(from).map_err(PublishError::Other)?,
            &self.resolved_child(to).map_err(PublishError::Other)?,
        )
    }

    #[cfg(unix)]
    fn remove_child(&self, path: &Path) -> Result<(), String> {
        use rustix::fs::{unlinkat, AtFlags};

        unlinkat(&self.directory, self.checked_name(path)?, AtFlags::empty())
            .map_err(|error| format!("cannot remove file: {error}"))?;
        self.sync()
    }

    #[cfg(not(unix))]
    fn remove_child(&self, path: &Path) -> Result<(), String> {
        fs::remove_file(self.resolved_child(path)?)
            .map_err(|error| format!("cannot remove file: {error}"))
    }

    #[cfg(unix)]
    fn sync(&self) -> Result<(), String> {
        self.directory
            .sync_all()
            .map_err(|error| format!("cannot sync published directory: {error}"))
    }

    #[cfg(not(unix))]
    fn sync(&self) -> Result<(), String> {
        Ok(())
    }
}

impl ExternalSaveAuthorizations {
    fn register_selected_destination(
        &self,
        destination: &Path,
    ) -> Result<ExternalSaveSelection, ExternalFileError> {
        if !destination.is_absolute() {
            return Err(ExternalFileError::unauthorized(
                "the save dialog returned a non-absolute destination",
            ));
        }
        let destination_text = destination.to_str().ok_or_else(|| {
            ExternalFileError::unauthorized("the selected destination is not valid UTF-8")
        })?;
        let name = destination
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or_else(|| ExternalFileError::unauthorized("selected destination has no name"))?;
        if !name.to_ascii_lowercase().ends_with(".tesina") {
            return Err(ExternalFileError::unauthorized(
                "selected destination must use the .tesina extension",
            ));
        }
        let parent = destination
            .parent()
            .ok_or_else(|| ExternalFileError::unauthorized("selected destination has no parent"))?;
        let directory =
            Arc::new(AnchoredRelatedDir::open(parent).map_err(ExternalFileError::unauthorized)?);
        let resolved_destination = directory
            .resolved_child(destination)
            .map_err(ExternalFileError::unauthorized)?;
        ensure_destination_anchor_in(&directory, destination)
            .map_err(ExternalFileError::unauthorized)?;
        let authorization = Arc::new(ExternalSaveAuthorization {
            destination: destination.to_path_buf(),
            resolved_destination,
            directory,
        });
        let mut entries = self.entries.lock().map_err(|_| {
            ExternalFileError::io("external save authorization state is unavailable")
        })?;
        if entries.len() >= MAX_EXTERNAL_SAVE_AUTHORIZATIONS {
            return Err(ExternalFileError::resource_limit(
                "too many manual save authorizations are active",
            ));
        }
        let authorization_token = loop {
            let candidate = Uuid::new_v4().simple().to_string();
            if !entries.contains_key(&candidate) {
                break candidate;
            }
        };
        entries.insert(authorization_token.clone(), authorization);
        Ok(ExternalSaveSelection {
            path: destination_text.to_owned(),
            authorization_token,
        })
    }

    fn authorize_related(
        &self,
        authorization_token: &str,
        path: &Path,
        expected_kind: RelatedKind,
    ) -> Result<AuthorizedRelated, ExternalFileError> {
        let authorization = self.authorization(authorization_token)?;
        let target = classify_related(path).map_err(ExternalFileError::unauthorized)?;
        if target.kind != expected_kind {
            return Err(ExternalFileError::unauthorized(
                "related file has the wrong operation kind",
            ));
        }
        if target.destination != authorization.destination {
            return Err(ExternalFileError::unauthorized(
                "manual save authorization does not match this destination",
            ));
        }
        let resolved_destination = authorization
            .directory
            .resolved_child(&target.destination)
            .map_err(ExternalFileError::unauthorized)?;
        if resolved_destination != authorization.resolved_destination {
            return Err(ExternalFileError::unauthorized(
                "resolved destination does not match the manual save authorization",
            ));
        }
        ensure_destination_anchor_in(&authorization.directory, &target.destination)
            .map_err(ExternalFileError::unauthorized)?;
        Ok(AuthorizedRelated {
            target,
            directory: authorization.directory.clone(),
        })
    }

    fn authorize_destination(
        &self,
        authorization_token: &str,
        path: &Path,
    ) -> Result<Arc<ExternalSaveAuthorization>, ExternalFileError> {
        let authorization = self.authorization(authorization_token)?;
        if path != authorization.destination {
            return Err(ExternalFileError::unauthorized(
                "manual save authorization does not match this destination",
            ));
        }
        let resolved_destination = authorization
            .directory
            .resolved_child(path)
            .map_err(ExternalFileError::unauthorized)?;
        if resolved_destination != authorization.resolved_destination {
            return Err(ExternalFileError::unauthorized(
                "resolved destination does not match the manual save authorization",
            ));
        }
        ensure_destination_anchor_in(&authorization.directory, path)
            .map_err(ExternalFileError::unauthorized)?;
        Ok(authorization)
    }

    fn authorize_any_related(
        &self,
        authorization_token: &str,
        path: &Path,
    ) -> Result<AuthorizedRelated, ExternalFileError> {
        let target = classify_related(path).map_err(ExternalFileError::unauthorized)?;
        self.authorize_related(authorization_token, path, target.kind)
    }

    fn authorization(
        &self,
        authorization_token: &str,
    ) -> Result<Arc<ExternalSaveAuthorization>, ExternalFileError> {
        decode_save_authorization_header(authorization_token)
            .map_err(ExternalFileError::unauthorized)?;
        self.entries
            .lock()
            .map_err(|_| ExternalFileError::io("external save authorization state is unavailable"))?
            .get(authorization_token)
            .cloned()
            .ok_or_else(|| {
                ExternalFileError::unauthorized(
                    "manual save authorization is missing, finished, or revoked",
                )
            })
    }

    fn finish(&self, authorization_token: &str) -> Result<(), ExternalFileError> {
        decode_save_authorization_header(authorization_token)
            .map_err(ExternalFileError::unauthorized)?;
        let removed = self
            .entries
            .lock()
            .map_err(|_| ExternalFileError::io("external save authorization state is unavailable"))?
            .remove(authorization_token);
        if removed.is_none() {
            return Err(ExternalFileError::unauthorized(
                "manual save authorization is missing, finished, or revoked",
            ));
        }
        Ok(())
    }
}

#[cfg(all(
    feature = "packaged-portable-smoke",
    not(feature = "packaged-backup-smoke")
))]
fn register_packaged_smoke_destination(
    authorizations: &ExternalSaveAuthorizations,
    consumed: &AtomicBool,
    destination: &str,
) -> Result<ExternalSaveSelection, ExternalFileError> {
    consumed
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| {
            ExternalFileError::unauthorized(
                "the packaged portable smoke destination was already consumed",
            )
        })?;
    let destination = PathBuf::from(destination);
    if destination.exists() {
        return Err(ExternalFileError::unauthorized(
            "the packaged portable smoke destination must not exist",
        ));
    }
    authorizations.register_selected_destination(&destination)
}

#[cfg(feature = "packaged-backup-smoke")]
fn register_packaged_backup_smoke_destination(
    authorizations: &ExternalSaveAuthorizations,
    consumed: &AtomicBool,
    destination: &str,
) -> Result<ExternalSaveSelection, ExternalFileError> {
    consumed
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| {
            ExternalFileError::unauthorized(
                "the packaged backup smoke destination was already consumed",
            )
        })?;
    authorizations.register_selected_destination(Path::new(destination))
}

#[derive(Debug, Serialize)]
pub struct ExternalFileError {
    code: &'static str,
    detail: String,
}

impl ExternalFileError {
    fn io(detail: impl Into<String>) -> Self {
        Self {
            code: "portable/io",
            detail: detail.into(),
        }
    }

    fn unauthorized(detail: impl Into<String>) -> Self {
        Self {
            code: "portable/path-not-authorized",
            detail: detail.into(),
        }
    }

    fn name_taken(detail: impl Into<String>) -> Self {
        Self {
            code: "portable/name-taken",
            detail: detail.into(),
        }
    }

    fn resource_limit(detail: impl Into<String>) -> Self {
        Self {
            code: "portable/resource-limit",
            detail: detail.into(),
        }
    }
}

impl From<String> for ExternalFileError {
    fn from(detail: String) -> Self {
        Self::io(detail)
    }
}

#[derive(Debug)]
enum PublishError {
    NameTaken(String),
    Other(String),
}

impl PublishError {
    fn detail(self) -> String {
        match self {
            Self::NameTaken(detail) | Self::Other(detail) => detail,
        }
    }
}

fn classify_related(path: &Path) -> Result<RelatedTarget, String> {
    if !path.is_absolute() {
        return Err("related file path must be absolute".to_owned());
    }
    let parent = path.parent().ok_or("related file has no parent")?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("related file name is invalid UTF-8")?;
    let kind = if name.ends_with(RelatedKind::Temporary.suffix()) {
        RelatedKind::Temporary
    } else if name.ends_with(RelatedKind::Previous.suffix()) {
        RelatedKind::Previous
    } else {
        return Err("related file must use the .tmp or .prev suffix".to_owned());
    };
    let stem = name
        .strip_suffix(kind.suffix())
        .ok_or("related file suffix is invalid")?;
    let (destination_name, token) = stem
        .rsplit_once('.')
        .ok_or("related file is missing its operation token")?;
    if !destination_name.to_ascii_lowercase().ends_with(".tesina") {
        return Err("related destination must use the .tesina extension".to_owned());
    }
    let parsed = Uuid::parse_str(token)
        .map_err(|_| "related file token is not a canonical UUID".to_owned())?;
    if parsed.get_version_num() != 4
        || parsed.get_variant() != uuid::Variant::RFC4122
        || parsed.hyphenated().to_string() != token
    {
        return Err("related file token is not a canonical UUID".to_owned());
    }
    Ok(RelatedTarget {
        destination: parent.join(destination_name),
        kind,
    })
}

fn recovery_path(path: &Path, suffix: &str) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("recovery file has no parent")?;
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or("recovery file name is invalid UTF-8")?;
    Ok(parent.join(format!("{name}{suffix}")))
}

fn direct_recovery_path(path: &Path) -> Result<PathBuf, String> {
    recovery_path(path, RECOVERY_QUARANTINE_SUFFIX)
}

fn duplicate_recovery_path(path: &Path) -> Result<PathBuf, String> {
    recovery_path(path, DUPLICATE_RECOVERY_SUFFIX)
}

fn deletion_stage_path(path: &Path) -> Result<PathBuf, String> {
    recovery_path(path, DELETE_READY_SUFFIX)
}

fn classify_recovery(path: &Path) -> Result<RelatedTarget, String> {
    let parent = path.parent().ok_or("recovery file has no parent")?;
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or("recovery file name is invalid UTF-8")?;
    let recovery_name = name.strip_suffix(DELETE_READY_SUFFIX).unwrap_or(name);
    let logical_name = [DUPLICATE_RECOVERY_SUFFIX, RECOVERY_QUARANTINE_SUFFIX]
        .into_iter()
        .find_map(|suffix| recovery_name.strip_suffix(suffix))
        .ok_or("file is not native recovery evidence")?;
    classify_related(&parent.join(logical_name))
}

fn classify_related_or_recovery(path: &Path) -> Result<RelatedTarget, String> {
    classify_related(path).or_else(|_| classify_recovery(path))
}

fn related_evidence_paths(path: &Path) -> Result<[PathBuf; 4], String> {
    classify_related(path)?;
    let direct = direct_recovery_path(path)?;
    let duplicate = duplicate_recovery_path(path)?;
    Ok([
        direct.clone(),
        deletion_stage_path(&direct)?,
        duplicate.clone(),
        deletion_stage_path(&duplicate)?,
    ])
}

fn related_exists_in(directory: &AnchoredRelatedDir, path: &Path) -> Result<bool, String> {
    if directory.regular_exists(path, "related path")? {
        return Ok(true);
    }
    for recovery in related_evidence_paths(path)? {
        if directory.regular_exists(&recovery, "related recovery evidence")? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn related_evidence_path_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
) -> Result<PathBuf, String> {
    if directory.regular_exists(path, "related path")? {
        return Ok(path.to_path_buf());
    }
    for recovery in related_evidence_paths(path)? {
        if directory.regular_exists(&recovery, "related recovery evidence")? {
            return Ok(recovery);
        }
    }
    Ok(path.to_path_buf())
}

fn restore_related_evidence_in(directory: &AnchoredRelatedDir, path: &Path) -> Result<(), String> {
    if directory.regular_exists(path, "related path")? {
        return Ok(());
    }
    for recovery in related_evidence_paths(path)? {
        if directory.regular_exists(&recovery, "related recovery evidence")? {
            directory
                .rename_no_replace(&recovery, path)
                .map_err(PublishError::detail)?;
            return directory.sync();
        }
    }
    Ok(())
}

#[cfg(windows)]
fn same_destination_for_quota(left: &Path, right: &Path) -> bool {
    left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
}

#[cfg(all(target_os = "macos", test))]
fn same_destination_for_quota(left: &Path, right: &Path) -> bool {
    if left == right
        || matches!(
            (fs::canonicalize(left), fs::canonicalize(right)),
            (Ok(canonical_left), Ok(canonical_right)) if canonical_left == canonical_right
        )
    {
        return true;
    }
    let Some(parent) = left.parent() else {
        return false;
    };
    same_destination_for_quota_on_macos(
        left,
        right,
        macos_volume_is_case_sensitive(parent).unwrap_or(false),
    )
}

#[cfg(target_os = "macos")]
fn same_destination_for_quota_on_macos(left: &Path, right: &Path, case_sensitive: bool) -> bool {
    use unicode_casefold::UnicodeCaseFold;
    use unicode_normalization::UnicodeNormalization;

    let (Some(left_parent), Some(right_parent)) = (left.parent(), right.parent()) else {
        return false;
    };
    if left_parent != right_parent {
        return false;
    }
    let (Some(left_name), Some(right_name)) = (left.file_name(), right.file_name()) else {
        return false;
    };
    let (Some(left_name), Some(right_name)) = (left_name.to_str(), right_name.to_str()) else {
        return false;
    };
    if case_sensitive {
        left_name.nfc().eq(right_name.nfc())
    } else {
        left_name.case_fold().nfc().eq(right_name.case_fold().nfc())
    }
}

#[cfg(all(target_os = "macos", test))]
fn macos_volume_is_case_sensitive(path: &Path) -> Option<bool> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes()).ok()?;
    match unsafe { libc::pathconf(path.as_ptr(), libc::_PC_CASE_SENSITIVE) } {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn same_destination_for_quota(left: &Path, right: &Path) -> bool {
    left == right
}

fn related_mutation_guard() -> Result<MutexGuard<'static, ()>, ExternalFileError> {
    RELATED_FILE_MUTATION_LOCK
        .lock()
        .map_err(|_| ExternalFileError::io("related file mutation lock is unavailable"))
}

#[cfg(test)]
fn anchor_for(path: &Path) -> Result<AnchoredRelatedDir, String> {
    let parent = path.parent().ok_or("related file has no parent")?;
    AnchoredRelatedDir::open(parent)
}

#[cfg(windows)]
fn same_destination_for_quota_in(
    _directory: &AnchoredRelatedDir,
    left: &Path,
    right: &Path,
) -> bool {
    same_destination_for_quota(left, right)
}

#[cfg(target_os = "macos")]
fn same_destination_for_quota_in(
    directory: &AnchoredRelatedDir,
    left: &Path,
    right: &Path,
) -> bool {
    use std::os::fd::AsRawFd;

    if matches!(
        (
            directory.ensure_regular(left, "quota destination"),
            directory.ensure_regular(right, "quota destination"),
        ),
        (Ok(left_identity), Ok(right_identity)) if left_identity == right_identity
    ) {
        return true;
    }
    let case_sensitive =
        match unsafe { libc::fpathconf(directory.directory.as_raw_fd(), libc::_PC_CASE_SENSITIVE) }
        {
            0 => false,
            1 => true,
            _ => false,
        };
    same_destination_for_quota_on_macos(left, right, case_sensitive)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn same_destination_for_quota_in(
    _directory: &AnchoredRelatedDir,
    left: &Path,
    right: &Path,
) -> bool {
    same_destination_for_quota(left, right)
}

fn ensure_related_file_quota_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
) -> Result<(), ExternalFileError> {
    let target = classify_related(path).map_err(ExternalFileError::unauthorized)?;
    let mut count = 0_usize;
    let mut temporary_count = 0_usize;
    directory
        .for_each_entry(|entry| {
            let Ok(candidate) = classify_related_or_recovery(&entry) else {
                return;
            };
            if same_destination_for_quota_in(directory, &candidate.destination, &target.destination)
            {
                count = count.saturating_add(1);
                if candidate.kind == RelatedKind::Temporary {
                    temporary_count = temporary_count.saturating_add(1);
                }
            }
        })
        .map_err(ExternalFileError::io)?;
    let required_slots = match target.kind {
        RelatedKind::Temporary => temporary_count.saturating_add(2),
        RelatedKind::Previous => 1,
    };
    if count.saturating_add(required_slots) > MAX_RELATED_FILES_PER_DESTINATION {
        return Err(ExternalFileError::resource_limit(format!(
            "the selected destination has {count} recovery files and insufficient reserved capacity"
        )));
    }
    Ok(())
}

#[cfg(any(not(feature = "packaged-portable-smoke"), test))]
fn validate_save_suggested_name(name: &str) -> Result<&str, ExternalFileError> {
    if name.is_empty()
        || name.contains(['/', '\\', '\0'])
        || !name.to_ascii_lowercase().ends_with(".tesina")
    {
        return Err(ExternalFileError::unauthorized(
            "suggested save name must be a .tesina file name",
        ));
    }
    Ok(name)
}

fn decode_save_authorization_header(value: &str) -> Result<&str, String> {
    if value.len() != 32
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("manual save authorization token is invalid".to_owned());
    }
    Ok(value)
}

fn request_related_path(request: &tauri::ipc::Request<'_>) -> Result<PathBuf, ExternalFileError> {
    let encoded = request
        .headers()
        .get("x-tesina-related-path-encoded")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ExternalFileError::unauthorized("related file path header is missing"))?;
    decode_related_path_header(encoded)
        .map(PathBuf::from)
        .map_err(ExternalFileError::unauthorized)
}

fn request_save_authorization_token(
    request: &tauri::ipc::Request<'_>,
) -> Result<String, ExternalFileError> {
    let value = request
        .headers()
        .get("x-tesina-save-authorization")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ExternalFileError::unauthorized("manual save authorization header is missing")
        })?;
    decode_save_authorization_header(value)
        .map(str::to_owned)
        .map_err(ExternalFileError::unauthorized)
}

fn decode_related_path_header(encoded: &str) -> Result<String, String> {
    const MAX_ENCODED_PATH_BYTES: usize = 16 * 1024;
    if encoded.len() > MAX_ENCODED_PATH_BYTES || !encoded.is_ascii() {
        return Err("encoded related file path is invalid".to_owned());
    }
    let source = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(source.len());
    let mut index = 0;
    while index < source.len() {
        if source[index] == b'%' {
            if index + 2 >= source.len() {
                return Err("encoded related file path has a truncated escape".to_owned());
            }
            let high = (source[index + 1] as char)
                .to_digit(16)
                .ok_or("encoded related file path has an invalid escape")?;
            let low = (source[index + 2] as char)
                .to_digit(16)
                .ok_or("encoded related file path has an invalid escape")?;
            decoded.push(((high << 4) | low) as u8);
            index += 3;
        } else {
            decoded.push(source[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| "encoded related file path is not UTF-8".to_owned())
}

fn clone_raw_bytes_bounded(bytes: &[u8], max_bytes: usize) -> Result<Vec<u8>, ExternalFileError> {
    if bytes.len() > max_bytes {
        return Err(ExternalFileError::resource_limit(
            "temporary archive exceeds the archive limit",
        ));
    }
    Ok(bytes.to_vec())
}

fn request_bytes(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, ExternalFileError> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => clone_raw_bytes_bounded(bytes, MAX_ARCHIVE_BYTES),
        tauri::ipc::InvokeBody::Json(_) => Err(ExternalFileError::io(
            "related file command requires a binary request body",
        )),
    }
}

fn validated_external_archive_limit(max_bytes: u64) -> Result<usize, ExternalFileError> {
    if max_bytes > MAX_ARCHIVE_BYTES as u64 {
        return Err(ExternalFileError::resource_limit(format!(
            "the requested archive limit exceeds the native {}-byte cap",
            MAX_ARCHIVE_BYTES
        )));
    }
    usize::try_from(max_bytes)
        .map_err(|_| ExternalFileError::resource_limit("the requested archive limit is too large"))
}

#[cfg(test)]
fn ensure_destination_anchor(path: &Path) -> Result<(), String> {
    let directory = anchor_for(path)?;
    ensure_destination_anchor_in(&directory, path)
}

fn ensure_destination_anchor_in(directory: &AnchoredRelatedDir, path: &Path) -> Result<(), String> {
    directory
        .regular_exists(path, "selected destination")
        .map(|_| ())
}

#[cfg(test)]
fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    let directory = anchor_for(path)?;
    read_bounded_with_limit_in(&directory, path, MAX_ARCHIVE_BYTES)
}

#[cfg(test)]
fn read_bounded_with_limit(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    let directory = anchor_for(path)?;
    read_bounded_with_limit_in(&directory, path, max_bytes)
}

fn read_bounded_with_limit_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let evidence = related_evidence_path_in(directory, path)?;
    read_path_bounded_with_limit_in(directory, &evidence, "related file", max_bytes)
}

fn read_regular_bounded_with_limit_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    read_path_bounded_with_limit_in(directory, path, "selected destination", max_bytes)
}

fn read_path_bounded_with_limit_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    label: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let (mut file, _) = open_regular_owned_in(directory, path, label)?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("cannot read {label}: {error}"))?;
    if bytes.len() > max_bytes {
        return Err(format!("{label} exceeds the archive limit"));
    }
    Ok(bytes)
}

#[cfg(test)]
fn hash_bounded(path: &Path) -> Result<String, String> {
    let directory = anchor_for(path)?;
    hash_bounded_with_limit_in(&directory, path, MAX_ARCHIVE_BYTES)
}

#[cfg(test)]
fn hash_bounded_with_limit(path: &Path, max_bytes: usize) -> Result<String, String> {
    let directory = anchor_for(path)?;
    hash_bounded_with_limit_in(&directory, path, max_bytes)
}

fn hash_bounded_with_limit_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    max_bytes: usize,
) -> Result<String, String> {
    let evidence = related_evidence_path_in(directory, path)?;
    let (mut file, _) = open_regular_owned_in(directory, &evidence, "related file")?;
    hash_open_bounded_with_limit(&mut file, max_bytes)
}

fn hash_regular_bounded_with_limit_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    max_bytes: usize,
) -> Result<String, String> {
    let (mut file, _) = open_regular_owned_in(directory, path, "selected destination")?;
    hash_open_bounded_with_limit(&mut file, max_bytes)
}

fn hash_open_bounded_with_limit(file: &mut fs::File, max_bytes: usize) -> Result<String, String> {
    file.rewind()
        .map_err(|error| format!("cannot rewind related file: {error}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut total = 0_usize;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("cannot hash related file: {error}"))?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read);
        if total > max_bytes {
            return Err("related file exceeds the archive limit".to_owned());
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(test)]
fn write_temp_no_replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let directory = anchor_for(path)?;
    write_temp_no_replace_in(&directory, path, bytes)
}

fn write_temp_no_replace_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    bytes: &[u8],
) -> Result<(), String> {
    for recovery in related_evidence_paths(path)? {
        if directory.regular_exists(&recovery, "temporary recovery evidence")? {
            return Err("temporary recovery evidence already exists".to_owned());
        }
    }
    let mut file = directory.create_child_new(path, "temporary file")?;
    let owned_identity = file
        .try_clone()
        .and_then(FileIdentity::from_file)
        .map_err(|error| format!("cannot identify temporary file: {error}"))?;
    let result = file
        .write_all(bytes)
        .map_err(|error| format!("cannot write temporary file: {error}"))
        .and_then(|_| {
            file.sync_all()
                .map_err(|error| format!("cannot sync temporary file: {error}"))
        });
    drop(file);
    if result.is_err() {
        let _ = cleanup_created_file_with_hook_in(directory, path, &owned_identity, || Ok(()));
    }
    result
}

#[cfg(test)]
fn write_temp_no_replace_limited(path: &Path, bytes: &[u8]) -> Result<(), ExternalFileError> {
    let directory = anchor_for(path).map_err(ExternalFileError::unauthorized)?;
    write_temp_no_replace_limited_in(&directory, path, bytes)
}

fn write_temp_no_replace_limited_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    bytes: &[u8],
) -> Result<(), ExternalFileError> {
    let _guard = related_mutation_guard()?;
    ensure_related_file_quota_in(directory, path)?;
    write_temp_no_replace_in(directory, path, bytes).map_err(ExternalFileError::io)
}

#[cfg(test)]
fn open_regular_owned_with_hook<F>(
    path: &Path,
    label: &str,
    after_metadata: F,
) -> Result<(fs::File, FileIdentity), String>
where
    F: FnOnce() -> Result<(), String>,
{
    let directory = anchor_for(path)?;
    open_regular_owned_with_hook_in(&directory, path, label, after_metadata)
}

fn open_regular_owned_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    label: &str,
) -> Result<(fs::File, FileIdentity), String> {
    open_regular_owned_with_hook_in(directory, path, label, || Ok(()))
}

fn open_regular_owned_with_hook_in<F>(
    directory: &AnchoredRelatedDir,
    path: &Path,
    label: &str,
    after_metadata: F,
) -> Result<(fs::File, FileIdentity), String>
where
    F: FnOnce() -> Result<(), String>,
{
    directory.ensure_regular(path, label)?;
    after_metadata()?;
    let file = directory.open_child_read(path, label)?;
    if !file
        .metadata()
        .map_err(|error| format!("cannot inspect {label}: {error}"))?
        .is_file()
    {
        return Err(format!("{label} is not a regular file"));
    }
    let owned_identity = file
        .try_clone()
        .and_then(FileIdentity::from_file)
        .map_err(|error| format!("cannot identify {label}: {error}"))?;
    let public_identity = directory.ensure_regular(path, &format!("public {label}"))?;
    if owned_identity != public_identity {
        return Err(format!("{label} changed while it was being opened"));
    }
    Ok((file, owned_identity))
}

fn validate_opened_source_with_limit(
    source: &mut fs::File,
    expected_sha256: Option<&str>,
    max_bytes: usize,
) -> Result<(), String> {
    let actual = hash_open_bounded_with_limit(source, max_bytes)?;
    if let Some(expected_sha256) = expected_sha256 {
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            return Err(
                "the publication source hash does not match the validated archive".to_owned(),
            );
        }
    }
    Ok(())
}

fn validate_opened_source(
    source: &mut fs::File,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    validate_opened_source_with_limit(source, expected_sha256, MAX_ARCHIVE_BYTES)
}

#[cfg(windows)]
fn rename_path_no_replace(from: &Path, to: &Path) -> Result<(), PublishError> {
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
            Err(PublishError::NameTaken(
                "destination already exists".to_owned(),
            ))
        }
        Err(error) => Err(PublishError::Other(format!(
            "cannot publish destination without replacing it: {error}"
        ))),
    }
}

#[cfg(not(any(unix, windows)))]
fn rename_path_no_replace(_from: &Path, _to: &Path) -> Result<(), PublishError> {
    Err(PublishError::Other(
        "no-replace publication is unsupported on this platform".to_owned(),
    ))
}

#[cfg(test)]
fn restore_quarantined_no_replace(quarantine: &Path, public: &Path) -> Result<(), String> {
    let directory = anchor_for(public)?;
    restore_quarantined_no_replace_in(&directory, quarantine, public)
}

fn restore_quarantined_no_replace_in(
    directory: &AnchoredRelatedDir,
    quarantine: &Path,
    public: &Path,
) -> Result<(), String> {
    match directory.rename_no_replace(quarantine, public) {
        Ok(()) => directory.sync(),
        Err(PublishError::NameTaken(_)) => Err(
            "the public pathname now belongs to another file; quarantine was retained".to_owned(),
        ),
        Err(error) => Err(format!(
            "cannot restore quarantined file without replacing public state: {}",
            error.detail()
        )),
    }
}

fn copy_open_bounded(
    source: &mut fs::File,
    target: &mut fs::File,
    max_bytes: usize,
) -> io::Result<()> {
    source
        .rewind()
        .map_err(|error| io::Error::new(error.kind(), format!("cannot rewind: {error}")))?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut total = 0_usize;
    loop {
        let read = source.read(&mut buffer)?;
        if read == 0 {
            return Ok(());
        }
        total = total.saturating_add(read);
        if total > max_bytes {
            return Err(io::Error::new(
                ErrorKind::InvalidData,
                "operation evidence exceeds the archive limit",
            ));
        }
        target.write_all(&buffer[..read])?;
    }
}

#[cfg(test)]
fn restore_opened_evidence_with_limit(
    source: &mut fs::File,
    path: &Path,
    max_bytes: usize,
) -> Result<(), String> {
    let directory = anchor_for(path)?;
    restore_opened_evidence_with_limit_in(&directory, source, path, max_bytes)
}

fn restore_opened_evidence_with_limit_in(
    directory: &AnchoredRelatedDir,
    source: &mut fs::File,
    path: &Path,
    max_bytes: usize,
) -> Result<(), String> {
    let mut evidence = directory.create_child_new(path, "operation evidence")?;
    let evidence_identity = evidence
        .try_clone()
        .and_then(FileIdentity::from_file)
        .map_err(|error| format!("cannot identify restored operation evidence: {error}"))?;
    let outcome = copy_open_bounded(source, &mut evidence, max_bytes)
        .and_then(|()| evidence.sync_all())
        .map_err(|error| format!("cannot restore operation evidence: {error}"));
    drop(evidence);
    if let Err(error) = outcome {
        let cleanup =
            cleanup_created_file_with_hook_in(directory, path, &evidence_identity, || Ok(()));
        return Err(match cleanup {
            Ok(()) => error,
            Err(cleanup_error) => format!("{error}; {cleanup_error}"),
        });
    }
    directory
        .sync()
        .map_err(|error| format!("operation evidence was restored but {error}"))
}

fn restore_opened_evidence_in(
    directory: &AnchoredRelatedDir,
    source: &mut fs::File,
    path: &Path,
) -> Result<(), String> {
    restore_opened_evidence_with_limit_in(directory, source, path, MAX_ARCHIVE_BYTES)
}

fn restore_opened_recovery_evidence_with_limit_in(
    directory: &AnchoredRelatedDir,
    source: &mut fs::File,
    path: &Path,
    max_bytes: usize,
) -> Result<(), String> {
    classify_recovery(path)?;
    let mut evidence = directory.create_child_new(path, "recovery operation evidence")?;
    let outcome = copy_open_bounded(source, &mut evidence, max_bytes)
        .and_then(|()| evidence.sync_all())
        .map_err(|error| format!("cannot restore recovery operation evidence: {error}"));
    drop(evidence);
    if let Err(error) = outcome {
        return Err(format!(
            "{error}; bounded partial evidence was retained at its discoverable recovery name"
        ));
    }
    directory
        .sync()
        .map_err(|error| format!("recovery operation evidence was restored but {error}"))
}

fn restore_opened_recovery_evidence_in(
    directory: &AnchoredRelatedDir,
    source: &mut fs::File,
    path: &Path,
) -> Result<(), String> {
    restore_opened_recovery_evidence_with_limit_in(directory, source, path, MAX_ARCHIVE_BYTES)
}

fn unverified_publication_error(
    directory: &AnchoredRelatedDir,
    source: &mut fs::File,
    original: &Path,
    detail: impl Into<String>,
) -> PublishError {
    let detail = detail.into();
    PublishError::Other(
        match restore_opened_evidence_in(directory, source, original) {
            Ok(()) => format!("{detail}; the operation evidence was restored"),
            Err(error) => format!("{detail}; {error}"),
        },
    )
}

fn changed_source_error(
    directory: &AnchoredRelatedDir,
    source: &mut fs::File,
    evidence_target: Option<&Path>,
    detail: impl Into<String>,
) -> PublishError {
    let detail = detail.into();
    let Some(evidence_target) = evidence_target else {
        return PublishError::Other(detail);
    };
    PublishError::Other(
        match restore_opened_evidence_in(directory, source, evidence_target) {
            Ok(()) => format!("{detail}; the operation evidence was preserved"),
            Err(error) => format!("{detail}; {error}"),
        },
    )
}

fn ensure_public_identity_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    owned_identity: &FileIdentity,
    label: &str,
) -> Result<(), String> {
    let public_identity = directory.ensure_regular(path, label)?;
    if &public_identity != owned_identity {
        return Err(format!("{label} pathname belongs to another file"));
    }
    Ok(())
}

fn publish_opened_no_replace_with_hooks<BeforePublish, AfterRename, AfterPublish>(
    directory: &AnchoredRelatedDir,
    from: &Path,
    to: &Path,
    source: &mut fs::File,
    owned_identity: &FileIdentity,
    expected_sha256: Option<&str>,
    reject_source_reappearance: bool,
    before_publish: BeforePublish,
    after_rename: AfterRename,
    after_publish: AfterPublish,
) -> Result<(), PublishError>
where
    BeforePublish: FnOnce() -> Result<(), String>,
    AfterRename: FnOnce() -> Result<(), String>,
    AfterPublish: FnOnce() -> Result<(), String>,
{
    before_publish().map_err(PublishError::Other)?;
    let evidence_target = reject_source_reappearance.then_some(to);
    if let Err(error) =
        ensure_public_identity_in(directory, from, owned_identity, "publication source")
    {
        return Err(changed_source_error(
            directory,
            source,
            evidence_target,
            error,
        ));
    }
    validate_opened_source(source, expected_sha256).map_err(PublishError::Other)?;
    if let Err(error) =
        ensure_public_identity_in(directory, from, owned_identity, "publication source")
    {
        return Err(changed_source_error(
            directory,
            source,
            evidence_target,
            error,
        ));
    }
    directory.rename_no_replace(from, to)?;
    if let Err(error) = ensure_public_identity_in(directory, to, owned_identity, "publication") {
        return Err(unverified_publication_error(directory, source, from, error));
    }
    if let Err(error) = after_rename() {
        return Err(unverified_publication_error(
            directory,
            source,
            from,
            format!("publication verification was interrupted: {error}"),
        ));
    }
    if let Err(error) = ensure_public_identity_in(directory, to, owned_identity, "publication") {
        return Err(unverified_publication_error(directory, source, from, error));
    }
    if let Err(error) = validate_opened_source(source, expected_sha256) {
        return Err(unverified_publication_error(directory, source, from, error));
    }
    if let Err(error) = ensure_public_identity_in(directory, to, owned_identity, "publication") {
        return Err(unverified_publication_error(directory, source, from, error));
    }
    if let Err(error) = directory.sync() {
        return Err(unverified_publication_error(directory, source, from, error));
    }
    after_publish().map_err(PublishError::Other)?;
    if reject_source_reappearance
        && directory
            .regular_exists(from, "publication source")
            .map_err(PublishError::Other)?
    {
        return Err(PublishError::Other(
            "the source pathname reappeared after publication".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
fn cleanup_created_file_with_hook<F>(
    path: &Path,
    owned_identity: &FileIdentity,
    before_quarantine: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    let directory = anchor_for(path)?;
    cleanup_created_file_with_hook_in(&directory, path, owned_identity, before_quarantine)
}

fn cleanup_created_file_with_hook_in<F>(
    directory: &AnchoredRelatedDir,
    path: &Path,
    owned_identity: &FileIdentity,
    before_quarantine: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    before_quarantine()?;
    if !directory.regular_exists(path, "created file")? {
        return Ok(());
    }
    let quarantine = direct_recovery_path(path)?;
    if directory.regular_exists(&quarantine, "created-file recovery evidence")? {
        return Err("created-file recovery evidence already exists".to_owned());
    }
    directory
        .rename_no_replace(path, &quarantine)
        .map_err(|error| {
            format!(
                "cannot quarantine incomplete destination: {}",
                error.detail()
            )
        })?;
    let current = directory.ensure_regular(&quarantine, "quarantined destination")?;
    if owned_identity == &current {
        return directory
            .remove_child(&quarantine)
            .map_err(|error| format!("cannot remove incomplete destination: {error}"));
    }
    let restoration = restore_quarantined_no_replace_in(directory, &quarantine, path);
    Err(match restoration {
        Ok(()) => "the incomplete destination pathname belonged to another file and was restored"
            .to_owned(),
        Err(error) => {
            format!("the incomplete destination pathname belongs to another file; {error}")
        }
    })
}

#[cfg(test)]
fn atomic_rename_no_replace(
    from: &Path,
    to: &Path,
    expected_sha256: &str,
) -> Result<(), PublishError> {
    let directory = anchor_for(from).map_err(PublishError::Other)?;
    atomic_rename_no_replace_with_hook_in(&directory, from, to, expected_sha256, || Ok(()))
}

#[cfg(test)]
fn atomic_rename_no_replace_with_hook<F>(
    from: &Path,
    to: &Path,
    expected_sha256: &str,
    before_cleanup: F,
) -> Result<(), PublishError>
where
    F: FnOnce() -> Result<(), String>,
{
    let directory = anchor_for(from).map_err(PublishError::Other)?;
    atomic_rename_no_replace_with_hook_in(&directory, from, to, expected_sha256, before_cleanup)
}

fn atomic_rename_no_replace_with_hook_in<F>(
    directory: &AnchoredRelatedDir,
    from: &Path,
    to: &Path,
    expected_sha256: &str,
    before_cleanup: F,
) -> Result<(), PublishError>
where
    F: FnOnce() -> Result<(), String>,
{
    atomic_rename_no_replace_with_hooks_in(
        directory,
        from,
        to,
        expected_sha256,
        || Ok(()),
        || Ok(()),
        before_cleanup,
    )
}

#[cfg(test)]
fn atomic_rename_no_replace_with_hooks<BeforePublish, AfterRename, BeforeCleanup>(
    from: &Path,
    to: &Path,
    expected_sha256: &str,
    before_publish: BeforePublish,
    after_rename: AfterRename,
    before_cleanup: BeforeCleanup,
) -> Result<(), PublishError>
where
    BeforePublish: FnOnce() -> Result<(), String>,
    AfterRename: FnOnce() -> Result<(), String>,
    BeforeCleanup: FnOnce() -> Result<(), String>,
{
    let directory = anchor_for(from).map_err(PublishError::Other)?;
    atomic_rename_no_replace_with_hooks_in(
        &directory,
        from,
        to,
        expected_sha256,
        before_publish,
        after_rename,
        before_cleanup,
    )
}

fn atomic_rename_no_replace_with_hooks_in<BeforePublish, AfterRename, BeforeCleanup>(
    directory: &AnchoredRelatedDir,
    from: &Path,
    to: &Path,
    expected_sha256: &str,
    before_publish: BeforePublish,
    after_rename: AfterRename,
    before_cleanup: BeforeCleanup,
) -> Result<(), PublishError>
where
    BeforePublish: FnOnce() -> Result<(), String>,
    AfterRename: FnOnce() -> Result<(), String>,
    BeforeCleanup: FnOnce() -> Result<(), String>,
{
    let related = classify_related(from).map_err(PublishError::Other)?;
    if related.destination != to {
        return Err(PublishError::Other(
            "related file does not belong to the destination".to_owned(),
        ));
    }
    restore_related_evidence_in(directory, from).map_err(PublishError::Other)?;
    let (mut source, owned_identity) =
        open_regular_owned_in(directory, from, "related file").map_err(PublishError::Other)?;
    publish_opened_no_replace_with_hooks(
        directory,
        from,
        to,
        &mut source,
        &owned_identity,
        Some(expected_sha256),
        false,
        before_publish,
        after_rename,
        before_cleanup,
    )
}

#[cfg(test)]
fn preserve_destination_no_replace(
    destination: &Path,
    previous: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    let directory = anchor_for(previous)?;
    preserve_destination_no_replace_with_hook_in(
        &directory,
        destination,
        previous,
        expected_sha256,
        || Ok(()),
    )
    .map_err(|error| error.detail)
}

#[cfg(test)]
fn preserve_destination_no_replace_limited(
    destination: &Path,
    previous: &Path,
    expected_sha256: &str,
) -> Result<(), ExternalFileError> {
    let directory = anchor_for(previous).map_err(ExternalFileError::unauthorized)?;
    preserve_destination_no_replace_limited_in(&directory, destination, previous, expected_sha256)
}

fn preserve_destination_no_replace_limited_in(
    directory: &AnchoredRelatedDir,
    destination: &Path,
    previous: &Path,
    expected_sha256: &str,
) -> Result<(), ExternalFileError> {
    let _guard = related_mutation_guard()?;
    if !related_exists_in(directory, previous).map_err(ExternalFileError::io)? {
        ensure_related_file_quota_in(directory, previous)?;
    }
    preserve_destination_no_replace_with_hook_in(
        directory,
        destination,
        previous,
        expected_sha256,
        || Ok(()),
    )
}

#[cfg(test)]
fn preserve_destination_no_replace_with_hook<F>(
    destination: &Path,
    previous: &Path,
    expected_sha256: &str,
    before_cleanup: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    let directory = anchor_for(previous)?;
    preserve_destination_no_replace_with_hook_in(
        &directory,
        destination,
        previous,
        expected_sha256,
        before_cleanup,
    )
    .map_err(|error| error.detail)
}

fn preserve_destination_no_replace_with_hook_in<F>(
    directory: &AnchoredRelatedDir,
    destination: &Path,
    previous: &Path,
    expected_sha256: &str,
    before_cleanup: F,
) -> Result<(), ExternalFileError>
where
    F: FnOnce() -> Result<(), String>,
{
    preserve_destination_no_replace_with_hooks_in(
        directory,
        destination,
        previous,
        expected_sha256,
        || Ok(()),
        || Ok(()),
        before_cleanup,
        || Ok(()),
        || Ok(()),
    )
}

#[cfg(test)]
fn preserve_destination_no_replace_with_hooks<
    BeforePublish,
    AfterRename,
    BeforeCleanup,
    AfterQuarantine,
    BeforeFinalValidation,
>(
    destination: &Path,
    previous: &Path,
    expected_sha256: &str,
    before_publish: BeforePublish,
    after_rename: AfterRename,
    before_cleanup: BeforeCleanup,
    after_quarantine: AfterQuarantine,
    before_final_validation: BeforeFinalValidation,
) -> Result<(), String>
where
    BeforePublish: FnOnce() -> Result<(), String>,
    AfterRename: FnOnce() -> Result<(), String>,
    BeforeCleanup: FnOnce() -> Result<(), String>,
    AfterQuarantine: FnOnce() -> Result<(), String>,
    BeforeFinalValidation: FnOnce() -> Result<(), String>,
{
    let directory = anchor_for(previous)?;
    preserve_destination_no_replace_with_hooks_in(
        &directory,
        destination,
        previous,
        expected_sha256,
        before_publish,
        after_rename,
        before_cleanup,
        after_quarantine,
        before_final_validation,
    )
    .map_err(|error| error.detail)
}

fn preserve_destination_no_replace_with_hooks_in<
    BeforePublish,
    AfterRename,
    BeforeCleanup,
    AfterQuarantine,
    BeforeFinalValidation,
>(
    directory: &AnchoredRelatedDir,
    destination: &Path,
    previous: &Path,
    expected_sha256: &str,
    before_publish: BeforePublish,
    after_rename: AfterRename,
    before_cleanup: BeforeCleanup,
    after_quarantine: AfterQuarantine,
    before_final_validation: BeforeFinalValidation,
) -> Result<(), ExternalFileError>
where
    BeforePublish: FnOnce() -> Result<(), String>,
    AfterRename: FnOnce() -> Result<(), String>,
    BeforeCleanup: FnOnce() -> Result<(), String>,
    AfterQuarantine: FnOnce() -> Result<(), String>,
    BeforeFinalValidation: FnOnce() -> Result<(), String>,
{
    let related = classify_related(previous)?;
    if related.kind != RelatedKind::Previous || related.destination != destination {
        return Err(ExternalFileError::io(
            "preserved file does not belong to the destination",
        ));
    }
    restore_related_evidence_in(directory, previous)?;
    let duplicate = duplicate_recovery_path(previous)?;
    let previous_exists = directory.regular_exists(previous, "preserved file")?;
    let destination_exists = directory.regular_exists(destination, "destination")?;
    let duplicate_exists = directory.regular_exists(&duplicate, "duplicate recovery evidence")?;
    if !destination_exists && previous_exists {
        validate_recovery_copy_in(directory, previous, expected_sha256, "preserved file")?;
        if duplicate_exists {
            validate_recovery_copy_in(
                directory,
                &duplicate,
                expected_sha256,
                "duplicate recovery evidence",
            )?;
        }
        return Ok(());
    }
    if destination_exists && duplicate_exists {
        return Err(ExternalFileError::io(
            "duplicate recovery evidence exists while the destination is occupied",
        ));
    }
    let (mut source, owned_identity) =
        open_regular_owned_in(directory, destination, "destination")?;
    validate_opened_source(&mut source, Some(expected_sha256))?;
    if previous_exists {
        let (mut published, published_identity) =
            open_regular_owned_in(directory, previous, "preserved file")?;
        if validate_opened_source(&mut published, Some(expected_sha256)).is_err() {
            return Err(ExternalFileError::io(
                "preserved file already exists with different bytes",
            ));
        }
        ensure_public_identity_in(directory, previous, &published_identity, "preserved file")?;
        before_cleanup()?;
        validate_opened_source(&mut source, Some(expected_sha256))?;
        ensure_public_identity_in(directory, destination, &owned_identity, "destination")?;
        validate_recovery_copy_identity_in(
            directory,
            previous,
            expected_sha256,
            &published_identity,
            "preserved file",
        )?;
        ensure_related_file_quota_in(directory, previous)?;
        directory
            .rename_no_replace(destination, &duplicate)
            .map_err(PublishError::detail)?;
        let outcome = (|| {
            directory.sync()?;
            ensure_public_identity_in(
                directory,
                &duplicate,
                &owned_identity,
                "duplicate recovery evidence",
            )?;
            validate_opened_source(&mut source, Some(expected_sha256))?;
            after_quarantine()?;
            before_final_validation()?;
            validate_recovery_copy_identity_in(
                directory,
                previous,
                expected_sha256,
                &published_identity,
                "preserved file",
            )?;
            ensure_public_identity_in(
                directory,
                &duplicate,
                &owned_identity,
                "duplicate recovery evidence",
            )?;
            validate_opened_source(&mut source, Some(expected_sha256))?;
            Ok(())
        })();
        if let Err(error) = outcome {
            if directory.regular_exists(&duplicate, "duplicate recovery evidence")? {
                let restoration =
                    restore_quarantined_no_replace_in(directory, &duplicate, destination);
                return Err(ExternalFileError::io(match restoration {
                    Ok(()) => error,
                    Err(restoration_error) => format!("{error}; {restoration_error}"),
                }));
            }
            return Err(ExternalFileError::io(error));
        }
        return Ok(());
    } else {
        publish_opened_no_replace_with_hooks(
            directory,
            destination,
            previous,
            &mut source,
            &owned_identity,
            Some(expected_sha256),
            true,
            before_publish,
            after_rename,
            before_cleanup,
        )
        .map_err(PublishError::detail)?;
        return Ok(());
    }
}

fn validate_recovery_copy_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    expected_sha256: &str,
    label: &str,
) -> Result<(), String> {
    let (mut file, identity) = open_regular_owned_in(directory, path, label)?;
    validate_opened_source(&mut file, Some(expected_sha256))?;
    ensure_public_identity_in(directory, path, &identity, label)
}

fn validate_recovery_copy_identity_in(
    directory: &AnchoredRelatedDir,
    path: &Path,
    expected_sha256: &str,
    expected_identity: &FileIdentity,
    label: &str,
) -> Result<(), String> {
    let (mut file, identity) = open_regular_owned_in(directory, path, label)?;
    if &identity != expected_identity {
        return Err(format!("{label} changed before recovery completed"));
    }
    validate_opened_source(&mut file, Some(expected_sha256))?;
    ensure_public_identity_in(directory, path, expected_identity, label)
}

async fn run_external_archive_worker<T, E, F>(worker: F) -> Result<T, ExternalFileError>
where
    T: Send + 'static,
    E: Into<ExternalFileError> + Send + 'static,
    F: FnOnce() -> Result<T, E> + Send + 'static,
{
    let _admission = ExternalArchiveAdmission::try_acquire()?;
    tauri::async_runtime::spawn_blocking(worker)
        .await
        .map_err(|error| ExternalFileError::io(format!("external file worker failed: {error}")))?
        .map_err(Into::into)
}

#[cfg(not(feature = "packaged-portable-smoke"))]
#[tauri::command]
pub async fn external_pick_save_destination(
    window: tauri::Window,
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    suggested_name: String,
) -> Result<Option<ExternalSaveSelection>, ExternalFileError> {
    let suggested_name = validate_save_suggested_name(&suggested_name)?.to_owned();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .add_filter("Tesina", &["tesina"])
        .set_file_name(suggested_name)
        .set_parent(&window)
        .save_file(move |selection| {
            let _ = sender.send(selection);
        });
    let selection = receiver.await.map_err(|_| {
        ExternalFileError::io("native save dialog closed without returning a result")
    })?;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|error| ExternalFileError::unauthorized(format!("invalid save path: {error}")))?;
    state.register_selected_destination(&path).map(Some)
}

#[cfg(all(
    feature = "packaged-portable-smoke",
    not(feature = "packaged-backup-smoke")
))]
#[tauri::command]
pub async fn external_pick_save_destination(
    _window: tauri::Window,
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    _suggested_name: String,
) -> Result<Option<ExternalSaveSelection>, ExternalFileError> {
    let destination =
        std::env::var("TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION").map_err(|_| {
            ExternalFileError::unauthorized(
                "the packaged portable smoke destination is not configured",
            )
        })?;
    register_packaged_smoke_destination(&state, &PACKAGED_SMOKE_DESTINATION_CONSUMED, &destination)
        .map(Some)
}

#[cfg(feature = "packaged-backup-smoke")]
#[tauri::command]
pub async fn external_pick_save_destination(
    _window: tauri::Window,
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    _suggested_name: String,
) -> Result<Option<ExternalSaveSelection>, ExternalFileError> {
    let destination =
        std::env::var("TESINA_PACKAGED_PORTABLE_SMOKE_DESTINATION").map_err(|_| {
            ExternalFileError::unauthorized(
                "the packaged portable smoke destination is not configured",
            )
        })?;
    register_packaged_backup_smoke_destination(
        &state,
        &PACKAGED_SMOKE_DESTINATION_CONSUMED,
        &destination,
    )
    .map(Some)
}

#[tauri::command]
pub fn external_finish_save_authorization(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    authorization_token: String,
) -> Result<(), ExternalFileError> {
    state.finish(&authorization_token)
}

#[tauri::command]
pub async fn external_destination_exists(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    path: String,
    authorization_token: String,
) -> Result<bool, ExternalFileError> {
    let path = PathBuf::from(path);
    let authorization = state.authorize_destination(&authorization_token, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        authorization
            .directory
            .regular_exists(&path, "selected destination")
    })
    .await
    .map_err(|error| ExternalFileError::io(format!("external file worker failed: {error}")))?
    .map_err(ExternalFileError::io)
}

#[tauri::command]
pub async fn external_read_destination(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    path: String,
    max_bytes: u64,
    authorization_token: String,
) -> Result<tauri::ipc::Response, ExternalFileError> {
    let _admission = ExternalArchiveAdmission::try_acquire()?;
    let max_bytes = validated_external_archive_limit(max_bytes)?;
    let path = PathBuf::from(path);
    let authorization = state.authorize_destination(&authorization_token, &path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_regular_bounded_with_limit_in(&authorization.directory, &path, max_bytes)
    })
    .await
    .map_err(|error| ExternalFileError::io(format!("external file worker failed: {error}")))?
    .map_err(ExternalFileError::io)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn external_hash_destination(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    path: String,
    max_bytes: u64,
    authorization_token: String,
) -> Result<String, ExternalFileError> {
    let max_bytes = validated_external_archive_limit(max_bytes)?;
    let path = PathBuf::from(path);
    let authorization = state.authorize_destination(&authorization_token, &path)?;
    run_external_archive_worker(move || {
        hash_regular_bounded_with_limit_in(&authorization.directory, &path, max_bytes)
    })
    .await
}

#[tauri::command]
pub async fn external_write_temp(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), ExternalFileError> {
    let _admission = ExternalArchiveAdmission::try_acquire()?;
    let path = request_related_path(&request)?;
    let authorization_token = request_save_authorization_token(&request)?;
    let authorized =
        state.authorize_related(&authorization_token, &path, RelatedKind::Temporary)?;
    let bytes = request_bytes(&request)?;
    tauri::async_runtime::spawn_blocking(move || {
        write_temp_no_replace_limited_in(&authorized.directory, &path, &bytes)
    })
    .await
    .map_err(|error| ExternalFileError::io(format!("external file worker failed: {error}")))?
}

#[tauri::command]
pub async fn external_read_temp(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    path: String,
    max_bytes: u64,
    authorization_token: String,
) -> Result<tauri::ipc::Response, ExternalFileError> {
    let _admission = ExternalArchiveAdmission::try_acquire()?;
    let max_bytes = validated_external_archive_limit(max_bytes)?;
    let path = PathBuf::from(path);
    let authorized =
        state.authorize_related(&authorization_token, &path, RelatedKind::Temporary)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_bounded_with_limit_in(&authorized.directory, &path, max_bytes)
    })
    .await
    .map_err(|error| ExternalFileError::io(format!("external file worker failed: {error}")))?
    .map_err(ExternalFileError::io)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn external_related_exists(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    path: String,
    authorization_token: String,
) -> Result<bool, ExternalFileError> {
    let path = PathBuf::from(path);
    let authorized = state.authorize_any_related(&authorization_token, &path)?;
    tauri::async_runtime::spawn_blocking(move || related_exists_in(&authorized.directory, &path))
        .await
        .map_err(|error| ExternalFileError::io(format!("external file worker failed: {error}")))?
        .map_err(ExternalFileError::io)
}

#[tauri::command]
pub async fn external_hash_previous(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    path: String,
    max_bytes: u64,
    authorization_token: String,
) -> Result<String, ExternalFileError> {
    let max_bytes = validated_external_archive_limit(max_bytes)?;
    let path = PathBuf::from(path);
    let authorized = state.authorize_related(&authorization_token, &path, RelatedKind::Previous)?;
    run_external_archive_worker(move || {
        hash_bounded_with_limit_in(&authorized.directory, &path, max_bytes)
    })
    .await
}

#[tauri::command]
pub async fn external_preserve_destination(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    destination: String,
    previous: String,
    expected_sha256: String,
    authorization_token: String,
) -> Result<(), ExternalFileError> {
    let destination = PathBuf::from(destination);
    let previous = PathBuf::from(previous);
    let authorized =
        state.authorize_related(&authorization_token, &previous, RelatedKind::Previous)?;
    if authorized.target.destination != destination {
        return Err(ExternalFileError::unauthorized(
            "preserved file does not match the selected destination",
        ));
    }
    run_external_archive_worker(move || {
        preserve_destination_no_replace_limited_in(
            &authorized.directory,
            &destination,
            &previous,
            &expected_sha256,
        )
    })
    .await
}

#[tauri::command]
pub async fn external_rename_no_replace(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    from: String,
    to: String,
    expected_sha256: String,
    authorization_token: String,
) -> Result<(), ExternalFileError> {
    let from = PathBuf::from(from);
    let to = PathBuf::from(to);
    let authorized = state.authorize_any_related(&authorization_token, &from)?;
    if authorized.target.destination != to {
        return Err(ExternalFileError::unauthorized(
            "related file does not match the selected destination",
        ));
    }
    run_external_archive_worker(move || {
        let _guard = related_mutation_guard()?;
        atomic_rename_no_replace_with_hook_in(
            &authorized.directory,
            &from,
            &to,
            &expected_sha256,
            || Ok(()),
        )
        .map_err(|error| match error {
            PublishError::NameTaken(detail) => ExternalFileError::name_taken(detail),
            PublishError::Other(detail) => ExternalFileError::io(detail),
        })
    })
    .await
}

#[tauri::command]
pub async fn external_remove_temp(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    path: String,
    expected_sha256: String,
    authorization_token: String,
) -> Result<(), ExternalFileError> {
    let path = PathBuf::from(path);
    let authorized =
        state.authorize_related(&authorization_token, &path, RelatedKind::Temporary)?;
    run_external_archive_worker(move || {
        let _guard = related_mutation_guard()?;
        remove_if_hash_matches_with_hook_in(&authorized.directory, &path, &expected_sha256, |_| {
            Ok(())
        })
        .map_err(ExternalFileError::io)
    })
    .await
}

#[cfg(test)]
fn remove_if_hash_matches_with_hook<F>(
    path: &Path,
    expected_sha256: &str,
    after_quarantine: F,
) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let directory = anchor_for(path)?;
    remove_if_hash_matches_with_hook_in(&directory, path, expected_sha256, after_quarantine)
}

#[cfg(test)]
fn remove_previous_if_hash_matches_with_hooks<
    AfterQuarantine,
    AfterPrimaryRemove,
    AfterFinalIdentity,
>(
    path: &Path,
    expected_sha256: &str,
    installed_destination_sha256: &str,
    after_quarantine: AfterQuarantine,
    after_primary_remove: AfterPrimaryRemove,
    after_final_identity: AfterFinalIdentity,
) -> Result<(), String>
where
    AfterQuarantine: FnOnce(&Path) -> Result<(), String>,
    AfterPrimaryRemove: FnOnce() -> Result<(), String>,
    AfterFinalIdentity: FnMut(&Path) -> Result<(), String>,
{
    let directory = anchor_for(path)?;
    remove_regular_if_hash_matches_with_hooks_in(
        &directory,
        path,
        expected_sha256,
        Some(installed_destination_sha256),
        || Ok(()),
        after_quarantine,
        || Ok(()),
        after_primary_remove,
        after_final_identity,
    )
}

#[cfg(test)]
fn remove_previous_if_hash_matches_with_hook<AfterQuarantine>(
    path: &Path,
    expected_sha256: &str,
    installed_destination_sha256: &str,
    after_quarantine: AfterQuarantine,
) -> Result<(), String>
where
    AfterQuarantine: FnOnce(&Path) -> Result<(), String>,
{
    remove_previous_if_hash_matches_with_hooks(
        path,
        expected_sha256,
        installed_destination_sha256,
        after_quarantine,
        || Ok(()),
        |_| Ok(()),
    )
}

#[cfg(test)]
fn remove_temp_if_hash_matches_with_final_identity_hook<AfterFinalIdentity>(
    path: &Path,
    expected_sha256: &str,
    after_final_identity: AfterFinalIdentity,
) -> Result<(), String>
where
    AfterFinalIdentity: FnMut(&Path) -> Result<(), String>,
{
    let directory = anchor_for(path)?;
    remove_regular_if_hash_matches_with_hooks_in(
        &directory,
        path,
        expected_sha256,
        None,
        || Ok(()),
        |_| Ok(()),
        || Ok(()),
        || Ok(()),
        after_final_identity,
    )
}

fn remove_if_hash_matches_with_hook_in<F>(
    directory: &AnchoredRelatedDir,
    path: &Path,
    expected_sha256: &str,
    after_quarantine: F,
) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    classify_related(path)?;
    remove_regular_if_hash_matches_with_hooks_in(
        directory,
        path,
        expected_sha256,
        None,
        || Ok(()),
        after_quarantine,
        || Ok(()),
        || Ok(()),
        |_| Ok(()),
    )
}

fn remove_regular_if_hash_matches_with_hooks_in<
    BeforeQuarantine,
    AfterQuarantine,
    BeforeRemove,
    AfterPrimaryRemove,
    AfterFinalIdentity,
>(
    directory: &AnchoredRelatedDir,
    path: &Path,
    expected_sha256: &str,
    installed_destination_sha256: Option<&str>,
    before_quarantine: BeforeQuarantine,
    after_quarantine: AfterQuarantine,
    before_remove: BeforeRemove,
    after_primary_remove: AfterPrimaryRemove,
    mut after_final_identity: AfterFinalIdentity,
) -> Result<(), String>
where
    BeforeQuarantine: FnOnce() -> Result<(), String>,
    AfterQuarantine: FnOnce(&Path) -> Result<(), String>,
    BeforeRemove: FnOnce() -> Result<(), String>,
    AfterPrimaryRemove: FnOnce() -> Result<(), String>,
    AfterFinalIdentity: FnMut(&Path) -> Result<(), String>,
{
    let related = classify_related(path)?;
    let quarantine = direct_recovery_path(path)?;
    let duplicate = duplicate_recovery_path(path)?;
    let duplicate_exists = recovery_evidence_exists_in(directory, &duplicate)?;
    if duplicate_exists {
        if related.kind == RelatedKind::Previous
            && !directory.regular_exists(&related.destination, "installed destination")?
        {
            return Err(
                "the installed destination is missing; old recovery copies were retained"
                    .to_owned(),
            );
        }
        validate_recovery_evidence_in(directory, &duplicate, expected_sha256)?;
    }
    before_quarantine()?;
    let has_quarantine = recovery_evidence_exists_in(directory, &quarantine)?;
    let has_public_path = directory.regular_exists(path, "path")?;
    if has_quarantine && has_public_path {
        return Err(
            "both the public related file and its recovery evidence exist; nothing was deleted"
                .to_owned(),
        );
    }
    if !has_quarantine && has_public_path {
        directory
            .rename_no_replace(path, &quarantine)
            .map_err(|error| format!("cannot quarantine preserved file: {}", error.detail()))?;
    }
    let removed_primary = recovery_evidence_exists_in(directory, &quarantine)?;
    if removed_primary {
        let outcome = remove_recovery_evidence_with_hooks_in(
            directory,
            &quarantine,
            expected_sha256,
            || {
                after_quarantine(&quarantine)?;
                before_remove()?;
                Ok(())
            },
            &mut after_final_identity,
            || validate_installed_destination_in(directory, &related, installed_destination_sha256),
        );
        if let Err(error) = outcome {
            if directory.regular_exists(&quarantine, "quarantined file")? {
                let restoration = restore_quarantined_no_replace_in(directory, &quarantine, path);
                return Err(match restoration {
                    Ok(()) => error,
                    Err(restoration_error) => format!("{error}; {restoration_error}"),
                });
            }
            return Err(error);
        }
        after_primary_remove()?;
    }
    if duplicate_exists && recovery_evidence_exists_in(directory, &duplicate)? {
        if related.kind == RelatedKind::Previous
            && !directory.regular_exists(&related.destination, "installed destination")?
        {
            return Err(
                "the installed destination disappeared; duplicate recovery evidence was retained"
                    .to_owned(),
            );
        }
        remove_recovery_evidence_with_hooks_in(
            directory,
            &duplicate,
            expected_sha256,
            || Ok(()),
            &mut after_final_identity,
            || validate_installed_destination_in(directory, &related, installed_destination_sha256),
        )?;
    }
    Ok(())
}

fn recovery_evidence_exists_in(
    directory: &AnchoredRelatedDir,
    recovery: &Path,
) -> Result<bool, String> {
    Ok(directory.regular_exists(recovery, "recovery evidence")?
        || directory.regular_exists(&deletion_stage_path(recovery)?, "delete-ready evidence")?)
}

fn recovery_evidence_path_in(
    directory: &AnchoredRelatedDir,
    recovery: &Path,
) -> Result<PathBuf, String> {
    let stage = deletion_stage_path(recovery)?;
    let has_recovery = directory.regular_exists(recovery, "recovery evidence")?;
    let has_stage = directory.regular_exists(&stage, "delete-ready evidence")?;
    match (has_recovery, has_stage) {
        (true, false) => Ok(recovery.to_path_buf()),
        (false, true) => Ok(stage),
        (true, true) => Err(
            "both recovery evidence and its delete-ready stage exist; nothing was deleted"
                .to_owned(),
        ),
        (false, false) => Ok(recovery.to_path_buf()),
    }
}

fn validate_recovery_evidence_in(
    directory: &AnchoredRelatedDir,
    recovery: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    let evidence = recovery_evidence_path_in(directory, recovery)?;
    validate_recovery_copy_in(directory, &evidence, expected_sha256, "recovery evidence")
}

fn validate_installed_destination_in(
    directory: &AnchoredRelatedDir,
    related: &RelatedTarget,
    installed_destination_sha256: Option<&str>,
) -> Result<(), String> {
    if related.kind == RelatedKind::Temporary {
        return Ok(());
    }
    let expected = installed_destination_sha256
        .ok_or("previous-file cleanup requires the installed destination's validated digest")?;
    validate_recovery_copy_in(
        directory,
        &related.destination,
        expected,
        "installed destination",
    )
    .map_err(|_| {
        "the installed destination digest does not match; old recovery copies were retained"
            .to_owned()
    })
}

fn preserve_raced_recovery_evidence_in(
    directory: &AnchoredRelatedDir,
    source: &mut fs::File,
    recovery: &Path,
    stage: &Path,
    detail: impl Into<String>,
) -> String {
    let detail = detail.into();
    let restoration = match directory.regular_exists(stage, "raced delete-ready evidence") {
        Ok(true) => restore_quarantined_no_replace_in(directory, stage, recovery),
        Ok(false) => Ok(()),
        Err(error) => Err(error),
    };
    let evidence = match directory.regular_exists(stage, "restored operation evidence") {
        Ok(false) => restore_opened_recovery_evidence_in(directory, source, stage),
        Ok(true) => Err("delete-ready operation evidence path is occupied".to_owned()),
        Err(error) => Err(error),
    };
    match (restoration, evidence) {
        (Ok(()), Ok(())) => {
            format!("{detail}; the replacement and operation evidence were retained")
        }
        (restoration, evidence) => format!(
            "{detail}; replacement restoration: {}; evidence restoration: {}",
            restoration.err().unwrap_or_else(|| "ok".to_owned()),
            evidence.err().unwrap_or_else(|| "ok".to_owned())
        ),
    }
}

fn remove_recovery_evidence_with_hooks_in<BeforeFinalValidation, AfterFinalIdentity, BeforeDelete>(
    directory: &AnchoredRelatedDir,
    recovery: &Path,
    expected_sha256: &str,
    before_final_validation: BeforeFinalValidation,
    after_final_identity: &mut AfterFinalIdentity,
    before_delete: BeforeDelete,
) -> Result<(), String>
where
    BeforeFinalValidation: FnOnce() -> Result<(), String>,
    AfterFinalIdentity: FnMut(&Path) -> Result<(), String>,
    BeforeDelete: FnOnce() -> Result<(), String>,
{
    let stage = deletion_stage_path(recovery)?;
    let evidence = recovery_evidence_path_in(directory, recovery)?;
    let already_staged = evidence == stage;
    let (mut file, identity) = open_regular_owned_in(directory, &evidence, "recovery evidence")?;
    validate_opened_source(&mut file, Some(expected_sha256))
        .map_err(|_| "recovery evidence hash does not match; nothing was deleted".to_owned())?;
    ensure_public_identity_in(directory, &evidence, &identity, "recovery evidence")?;
    before_final_validation()?;
    validate_opened_source(&mut file, Some(expected_sha256)).map_err(|_| {
        "recovery evidence changed after validation; nothing was deleted".to_owned()
    })?;
    ensure_public_identity_in(directory, &evidence, &identity, "recovery evidence")?;
    after_final_identity(&evidence)?;
    if !already_staged {
        directory
            .rename_no_replace(recovery, &stage)
            .map_err(|error| {
                format!(
                    "cannot stage verified recovery deletion: {}",
                    error.detail()
                )
            })?;
        directory.sync()?;
    }
    let moved_validation =
        validate_opened_source(&mut file, Some(expected_sha256)).and_then(|_| {
            ensure_public_identity_in(
                directory,
                &stage,
                &identity,
                "delete-ready recovery evidence",
            )
        });
    if let Err(error) = moved_validation {
        return Err(preserve_raced_recovery_evidence_in(
            directory, &mut file, recovery, &stage, error,
        ));
    }
    if let Err(error) = before_delete() {
        let restoration = restore_quarantined_no_replace_in(directory, &stage, recovery);
        return Err(match restoration {
            Ok(()) => error,
            Err(restoration_error) => format!("{error}; {restoration_error}"),
        });
    }
    let final_validation =
        validate_opened_source(&mut file, Some(expected_sha256)).and_then(|_| {
            ensure_public_identity_in(
                directory,
                &stage,
                &identity,
                "delete-ready recovery evidence",
            )
        });
    if let Err(error) = final_validation {
        return Err(preserve_raced_recovery_evidence_in(
            directory, &mut file, recovery, &stage, error,
        ));
    }
    directory
        .remove_child(&stage)
        .map_err(|error| format!("cannot remove recovery evidence: {error}"))
}

#[tauri::command]
pub async fn external_remove_if_hash_matches(
    state: tauri::State<'_, ExternalSaveAuthorizations>,
    path: String,
    expected_sha256: String,
    installed_destination_sha256: String,
    authorization_token: String,
) -> Result<(), ExternalFileError> {
    let path = PathBuf::from(path);
    let authorized = state.authorize_related(&authorization_token, &path, RelatedKind::Previous)?;
    run_external_archive_worker(move || {
        let _guard = related_mutation_guard()?;
        remove_regular_if_hash_matches_with_hooks_in(
            &authorized.directory,
            &path,
            &expected_sha256,
            Some(&installed_destination_sha256),
            || Ok(()),
            |_| Ok(()),
            || Ok(()),
            || Ok(()),
            |_| Ok(()),
        )
        .map_err(ExternalFileError::io)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const TOKEN: &str = "00000000-0000-4000-8000-0000000000ab";

    fn digest(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn expected_recovery_path(path: &Path, suffix: &str) -> PathBuf {
        let name = path.file_name().and_then(OsStr::to_str).unwrap();
        path.with_file_name(format!("{name}{suffix}"))
    }

    fn related_path(destination: &Path, token: &str, kind: RelatedKind) -> PathBuf {
        let name = destination.file_name().and_then(OsStr::to_str).unwrap();
        destination.with_file_name(format!("{name}.{token}{}", kind.suffix()))
    }

    #[test]
    fn cumulative_dialog_scope_without_a_save_token_cannot_authorize_related_files() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = related_path(&destination, TOKEN, RelatedKind::Temporary);
        let authorizations = ExternalSaveAuthorizations::default();

        let error = authorizations
            .authorize_related(
                "grant-from-an-open-dialog",
                &temporary,
                RelatedKind::Temporary,
            )
            .expect_err("a cumulative filesystem grant is not a manual-save authorization");

        assert_eq!(error.code, "portable/path-not-authorized");
        assert!(!temporary.exists());
    }

    #[test]
    fn save_token_authorizes_only_its_exact_destination() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let other = root.path().join("Other.tesina");
        let descendant = root.path().join("nested").join("Library.tesina");
        let temporary = related_path(&destination, TOKEN, RelatedKind::Temporary);
        let other_temporary = related_path(&other, TOKEN, RelatedKind::Temporary);
        let descendant_temporary = related_path(&descendant, TOKEN, RelatedKind::Temporary);
        let authorizations = ExternalSaveAuthorizations::default();
        let selection = authorizations
            .register_selected_destination(&destination)
            .unwrap();

        authorizations
            .authorize_destination(&selection.authorization_token, &destination)
            .expect("the token authorizes its exact selected destination");
        authorizations
            .authorize_related(
                &selection.authorization_token,
                &temporary,
                RelatedKind::Temporary,
            )
            .expect("the selected destination authorizes its journaled temporary sibling");
        for unauthorized in [&other_temporary, &descendant_temporary] {
            let error = authorizations
                .authorize_related(
                    &selection.authorization_token,
                    unauthorized,
                    RelatedKind::Temporary,
                )
                .expect_err("the token must not authorize another destination");
            assert_eq!(error.code, "portable/path-not-authorized");
        }
        for unauthorized in [&other, &descendant] {
            let error = authorizations
                .authorize_destination(&selection.authorization_token, unauthorized)
                .expect_err("the token must not authorize another destination path");
            assert_eq!(error.code, "portable/path-not-authorized");
        }
    }

    #[test]
    fn authorized_destination_reads_and_hashes_are_exact_and_bounded() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        fs::write(&destination, b"archive").unwrap();
        let authorizations = ExternalSaveAuthorizations::default();
        let selection = authorizations
            .register_selected_destination(&destination)
            .unwrap();
        let authorization = authorizations
            .authorize_destination(&selection.authorization_token, &destination)
            .unwrap();

        assert!(authorization
            .directory
            .regular_exists(&destination, "selected destination")
            .unwrap());
        assert_eq!(
            read_regular_bounded_with_limit_in(&authorization.directory, &destination, 7).unwrap(),
            b"archive"
        );
        assert_eq!(
            hash_regular_bounded_with_limit_in(&authorization.directory, &destination, 7).unwrap(),
            digest(b"archive")
        );
        assert!(
            read_regular_bounded_with_limit_in(&authorization.directory, &destination, 6).is_err()
        );
        assert!(
            hash_regular_bounded_with_limit_in(&authorization.directory, &destination, 6).is_err()
        );
    }

    #[test]
    fn finished_save_token_cannot_be_reused() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = related_path(&destination, TOKEN, RelatedKind::Temporary);
        let authorizations = ExternalSaveAuthorizations::default();
        let selection = authorizations
            .register_selected_destination(&destination)
            .unwrap();

        authorizations
            .finish(&selection.authorization_token)
            .expect("the active save lifecycle can be finished once");
        let error = authorizations
            .authorize_related(
                &selection.authorization_token,
                &temporary,
                RelatedKind::Temporary,
            )
            .expect_err("a finished token must be revoked");

        assert_eq!(error.code, "portable/path-not-authorized");
    }

    #[test]
    fn save_token_preserves_unicode_and_uppercase_destination_names() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("学生.TESINA");
        let previous = related_path(&destination, TOKEN, RelatedKind::Previous);
        let authorizations = ExternalSaveAuthorizations::default();
        let selection = authorizations
            .register_selected_destination(&destination)
            .unwrap();

        let authorized = authorizations
            .authorize_related(
                &selection.authorization_token,
                &previous,
                RelatedKind::Previous,
            )
            .expect("Unicode and uppercase .TESINA remain exact save destinations");

        assert_eq!(selection.path, destination.to_string_lossy());
        assert!(selection.authorization_token.is_ascii());
        assert_eq!(authorized.target.destination, destination);
    }

    #[test]
    fn concurrent_save_authorizations_remain_isolated() {
        let root = TempDir::new().unwrap();
        let first_destination = root.path().join("First.tesina");
        let second_destination = root.path().join("Second.tesina");
        let authorizations = std::sync::Arc::new(ExternalSaveAuthorizations::default());

        let (first, second) = std::thread::scope(|scope| {
            let first_state = authorizations.clone();
            let first_destination = first_destination.clone();
            let first =
                scope.spawn(move || first_state.register_selected_destination(&first_destination));
            let second_state = authorizations.clone();
            let second_destination = second_destination.clone();
            let second = scope
                .spawn(move || second_state.register_selected_destination(&second_destination));
            (
                first.join().unwrap().unwrap(),
                second.join().unwrap().unwrap(),
            )
        });
        let first_temporary = related_path(&first_destination, TOKEN, RelatedKind::Temporary);
        let second_temporary = related_path(&second_destination, TOKEN, RelatedKind::Temporary);

        authorizations
            .authorize_related(
                &first.authorization_token,
                &first_temporary,
                RelatedKind::Temporary,
            )
            .unwrap();
        authorizations
            .authorize_related(
                &second.authorization_token,
                &second_temporary,
                RelatedKind::Temporary,
            )
            .unwrap();
        assert!(authorizations
            .authorize_related(
                &first.authorization_token,
                &second_temporary,
                RelatedKind::Temporary,
            )
            .is_err());
        assert!(authorizations
            .authorize_related(
                &second.authorization_token,
                &first_temporary,
                RelatedKind::Temporary,
            )
            .is_err());
        assert_ne!(first.authorization_token, second.authorization_token);
    }

    #[test]
    fn save_authorization_cap_releases_held_handles_on_finish() {
        let root = TempDir::new().unwrap();
        let authorizations = ExternalSaveAuthorizations::default();
        let active = (0..MAX_EXTERNAL_SAVE_AUTHORIZATIONS)
            .map(|index| {
                authorizations
                    .register_selected_destination(
                        &root.path().join(format!("Library-{index}.tesina")),
                    )
                    .unwrap()
            })
            .collect::<Vec<_>>();
        let fifth = root.path().join(format!(
            "Library-{}.tesina",
            MAX_EXTERNAL_SAVE_AUTHORIZATIONS
        ));

        let error = authorizations
            .register_selected_destination(&fifth)
            .expect_err("a fifth active save must not retain another directory handle");
        assert_eq!(error.code, "portable/resource-limit");

        authorizations
            .finish(&active[0].authorization_token)
            .unwrap();
        authorizations
            .register_selected_destination(&fifth)
            .expect("finishing a lifecycle frees one authorization slot");
    }

    #[test]
    fn authorizes_only_uuid_related_files_for_the_selected_destination() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        let authorizations = ExternalSaveAuthorizations::default();
        let selection = authorizations
            .register_selected_destination(&destination)
            .unwrap();

        let temp_target = authorizations
            .authorize_related(
                &selection.authorization_token,
                &temporary,
                RelatedKind::Temporary,
            )
            .expect("the selected destination authorizes its temporary sibling");
        assert_eq!(temp_target.target.destination, destination);
        assert_eq!(temp_target.target.kind, RelatedKind::Temporary);
        assert!(authorizations
            .authorize_related(
                &selection.authorization_token,
                &previous,
                RelatedKind::Previous,
            )
            .is_ok());

        let wrong_uuid = root.path().join("Library.tesina.not-a-uuid.tmp");
        let uppercase_uuid = root
            .path()
            .join(format!("Library.tesina.{}.tmp", TOKEN.to_uppercase()));
        let non_v4_uuid = root
            .path()
            .join("Library.tesina.00000000-0000-1000-8000-000000000001.tmp");
        let non_rfc4122_uuid = root
            .path()
            .join("Library.tesina.00000000-0000-4000-0000-000000000001.tmp");
        let unrelated = root.path().join(format!("Other.tesina.{TOKEN}.tmp"));
        for invalid in [
            &wrong_uuid,
            &uppercase_uuid,
            &non_v4_uuid,
            &non_rfc4122_uuid,
            &unrelated,
        ] {
            assert!(authorizations
                .authorize_related(
                    &selection.authorization_token,
                    invalid,
                    RelatedKind::Temporary,
                )
                .is_err());
        }
        assert!(authorizations
            .authorize_related(
                &selection.authorization_token,
                &temporary,
                RelatedKind::Previous,
            )
            .is_err());

        let uppercase_destination = root.path().join("Library.TESINA");
        let uppercase_temporary = root.path().join(format!("Library.TESINA.{TOKEN}.tmp"));
        let uppercase_selection = authorizations
            .register_selected_destination(&uppercase_destination)
            .unwrap();
        assert!(authorizations
            .authorize_related(
                &uppercase_selection.authorization_token,
                &uppercase_temporary,
                RelatedKind::Temporary,
            )
            .is_ok());

        let recovery = direct_recovery_path(&temporary).unwrap();
        assert!(classify_recovery(&recovery).is_ok());
        assert!(authorizations
            .authorize_related(
                &selection.authorization_token,
                &recovery,
                RelatedKind::Temporary,
            )
            .is_err());
        let delete_ready = deletion_stage_path(&recovery).unwrap();
        assert!(classify_recovery(&delete_ready).is_ok());
        assert!(authorizations
            .authorize_related(
                &selection.authorization_token,
                &delete_ready,
                RelatedKind::Temporary,
            )
            .is_err());
    }

    #[test]
    fn decodes_unicode_related_paths_from_ascii_headers() {
        assert_eq!(
            decode_related_path_header(
                "%2Fexports%2F%E5%AD%A6%E7%94%9F.tesina.00000000-0000-4000-8000-000000000001.tmp"
            )
            .unwrap(),
            "/exports/学生.tesina.00000000-0000-4000-8000-000000000001.tmp"
        );
        assert!(decode_related_path_header("%E5%AD").is_err());
        assert!(decode_related_path_header("%GG").is_err());
    }

    #[test]
    fn validates_native_save_suggested_names_without_accepting_paths() {
        assert_eq!(
            validate_save_suggested_name("学生.TESINA").unwrap(),
            "学生.TESINA"
        );
        for invalid in [
            "",
            "nested/Library.tesina",
            "nested\\Library.tesina",
            "Library.zip",
        ] {
            assert!(validate_save_suggested_name(invalid).is_err());
        }
    }

    #[cfg(all(
        feature = "packaged-portable-smoke",
        not(feature = "packaged-backup-smoke")
    ))]
    #[test]
    fn packaged_smoke_destination_is_absent_exact_and_one_shot() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let authorizations = ExternalSaveAuthorizations::default();
        let consumed = AtomicBool::new(false);

        let selection = register_packaged_smoke_destination(
            &authorizations,
            &consumed,
            destination.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(selection.path, destination.to_str().unwrap());
        assert!(authorizations
            .authorize_destination(&selection.authorization_token, &destination)
            .is_ok());

        let repeated = register_packaged_smoke_destination(
            &authorizations,
            &consumed,
            destination.to_str().unwrap(),
        )
        .unwrap_err();
        assert_eq!(repeated.code, "portable/path-not-authorized");

        for invalid in ["relative.tesina", "/tmp/Library.zip"] {
            let error = register_packaged_smoke_destination(
                &authorizations,
                &AtomicBool::new(false),
                invalid,
            )
            .unwrap_err();
            assert_eq!(error.code, "portable/path-not-authorized");
        }

        let occupied = root.path().join("Occupied.tesina");
        fs::write(&occupied, b"unrelated").unwrap();
        let error = register_packaged_smoke_destination(
            &authorizations,
            &AtomicBool::new(false),
            occupied.to_str().unwrap(),
        )
        .unwrap_err();
        assert_eq!(error.code, "portable/path-not-authorized");
        assert_eq!(fs::read(occupied).unwrap(), b"unrelated");
    }

    #[cfg(feature = "packaged-backup-smoke")]
    #[test]
    fn packaged_backup_smoke_accepts_absent_and_occupied_exact_destinations_without_writing() {
        let root = TempDir::new().unwrap();
        let authorizations = ExternalSaveAuthorizations::default();

        let absent = root.path().join("New Library.tesina");
        let absent_selection = register_packaged_backup_smoke_destination(
            &authorizations,
            &AtomicBool::new(false),
            absent.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(absent_selection.path, absent.to_str().unwrap());
        assert!(!absent.exists());

        let occupied = root.path().join("Existing Library.tesina");
        let original = b"existing packaged export";
        fs::write(&occupied, original).unwrap();
        let consumed = AtomicBool::new(false);
        let occupied_selection = register_packaged_backup_smoke_destination(
            &authorizations,
            &consumed,
            occupied.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(occupied_selection.path, occupied.to_str().unwrap());
        assert_eq!(fs::read(&occupied).unwrap(), original);
        assert!(authorizations
            .authorize_destination(&occupied_selection.authorization_token, &occupied)
            .is_ok());

        let repeated = register_packaged_backup_smoke_destination(
            &authorizations,
            &consumed,
            occupied.to_str().unwrap(),
        )
        .unwrap_err();
        assert_eq!(repeated.code, "portable/path-not-authorized");

        for invalid in [
            "relative.tesina".to_owned(),
            root.path().join("Library.zip").display().to_string(),
        ] {
            let error = register_packaged_backup_smoke_destination(
                &authorizations,
                &AtomicBool::new(false),
                &invalid,
            )
            .unwrap_err();
            assert_eq!(error.code, "portable/path-not-authorized");
        }
    }

    #[test]
    fn save_picker_command_definitions_are_mutually_exclusive() {
        let source = include_str!("external_files.rs");
        let production = source.split("\n#[cfg(test)]\nmod tests {").next().unwrap();
        let marker = "pub async fn external_pick_save_destination(";
        let definitions = production.match_indices(marker).collect::<Vec<_>>();
        assert_eq!(
            definitions.len(),
            3,
            "expected dialog, portable, and backup variants"
        );

        let cfg_window = |offset: usize| &production[offset.saturating_sub(180)..offset];
        let dialog = cfg_window(definitions[0].0);
        assert!(dialog.contains("not(feature = \"packaged-portable-smoke\")"));

        let portable = cfg_window(definitions[1].0);
        assert!(portable.contains("feature = \"packaged-portable-smoke\""));
        assert!(portable.contains("not(feature = \"packaged-backup-smoke\")"));

        let backup = cfg_window(definitions[2].0);
        assert!(backup.contains("feature = \"packaged-backup-smoke\""));
        assert!(!backup.contains("not(feature = \"packaged-backup-smoke\")"));
    }

    #[test]
    fn save_authorization_tokens_are_ascii_bounded_and_opaque() {
        let root = TempDir::new().unwrap();
        let selection = ExternalSaveAuthorizations::default()
            .register_selected_destination(&root.path().join("Library.tesina"))
            .unwrap();

        assert_eq!(
            decode_save_authorization_header(&selection.authorization_token).unwrap(),
            selection.authorization_token
        );
        assert!(decode_save_authorization_header("é").is_err());
        assert!(decode_save_authorization_header("not-a-token").is_err());
    }

    #[test]
    fn raw_body_limit_is_checked_before_bytes_are_cloned() {
        assert_eq!(clone_raw_bytes_bounded(b"four", 4).unwrap(), b"four");
        let error =
            clone_raw_bytes_bounded(b"five!", 4).expect_err("an oversized body must be rejected");
        assert_eq!(error.code, "portable/resource-limit");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn archive_worker_admission_rejects_concurrent_hash_read_write_and_mutation_then_releases(
    ) {
        let (started_sender, started_receiver) = tokio::sync::oneshot::channel();
        let (release_sender, release_receiver) = std::sync::mpsc::channel();
        let first_hash = tokio::spawn(run_external_archive_worker(move || {
            started_sender.send(()).unwrap();
            release_receiver.recv().unwrap();
            Ok::<_, String>("first hash".to_owned())
        }));
        started_receiver.await.unwrap();

        let second_hash = run_external_archive_worker(|| Ok::<_, String>("second hash".to_owned()))
            .await
            .expect_err("a concurrent hash must fail before spawning another worker");
        assert_eq!(second_hash.code, "portable/resource-limit");
        for operation in ["read", "write"] {
            let error = ExternalArchiveAdmission::try_acquire()
                .expect_err("a concurrent archive operation must fail without waiting");
            assert_eq!(error.code, "portable/resource-limit", "{operation}");
        }

        release_sender.send(()).unwrap();
        assert_eq!(first_hash.await.unwrap().unwrap(), "first hash");
        let after_success = ExternalArchiveAdmission::try_acquire()
            .expect("a completed hash returns archive capacity");
        drop(after_success);

        let (mutation_started_sender, mutation_started_receiver) = tokio::sync::oneshot::channel();
        let (mutation_release_sender, mutation_release_receiver) = std::sync::mpsc::channel();
        let first_mutation = tokio::spawn(run_external_archive_worker(move || {
            let _guard = related_mutation_guard()?;
            mutation_started_sender.send(()).unwrap();
            mutation_release_receiver.recv().unwrap();
            Ok::<_, ExternalFileError>(())
        }));
        mutation_started_receiver.await.unwrap();

        let queued = Arc::new(AtomicBool::new(false));
        let queued_in_worker = Arc::clone(&queued);
        let second_mutation = run_external_archive_worker(move || {
            queued_in_worker.store(true, Ordering::SeqCst);
            let _guard = related_mutation_guard()?;
            Ok::<_, ExternalFileError>(())
        })
        .await
        .expect_err("a concurrent mutation must fail before entering the blocking pool");
        assert_eq!(second_mutation.code, "portable/resource-limit");
        assert!(!queued.load(Ordering::SeqCst));

        mutation_release_sender.send(()).unwrap();
        first_mutation.await.unwrap().unwrap();
        run_external_archive_worker(|| Ok::<_, ExternalFileError>(()))
            .await
            .expect("a completed mutation returns archive capacity");

        let worker_error =
            run_external_archive_worker(|| Err::<String, _>("expected hash failure".to_owned()))
                .await
                .expect_err("worker errors must remain typed I/O failures");
        assert_eq!(worker_error.code, "portable/io");
        ExternalArchiveAdmission::try_acquire()
            .expect("a failed hash also returns archive capacity");
    }

    #[test]
    fn related_file_quota_is_shared_by_temp_and_previous_files() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let mut related = Vec::new();
        for index in 0..2 {
            let suffix = if index % 2 == 0 { "tmp" } else { "prev" };
            let path = root.path().join(format!(
                "Library.tesina.{}.{suffix}",
                Uuid::new_v4().hyphenated()
            ));
            fs::write(&path, format!("related-{index}")).unwrap();
            related.push(path);
        }

        let fifth = root.path().join(format!(
            "Library.tesina.{}.tmp",
            Uuid::new_v4().hyphenated()
        ));
        let error = write_temp_no_replace_limited(&fifth, b"next")
            .expect_err("a new temp must reserve capacity for its previous file");
        assert_eq!(error.code, "portable/resource-limit");
        assert!(!fifth.exists());

        let removed = related.remove(0);
        let removed_hash = digest(&fs::read(&removed).unwrap());
        remove_if_hash_matches_with_hook(&removed, &removed_hash, |_| Ok(())).unwrap();
        write_temp_no_replace_limited(&fifth, b"next")
            .expect("hash-bound removal must free reserved capacity");
        assert_eq!(fs::read(fifth).unwrap(), b"next");
        assert!(!destination.exists());
    }

    #[test]
    fn related_file_quota_is_independent_for_other_destinations() {
        let root = TempDir::new().unwrap();
        for index in 0..MAX_RELATED_FILES_PER_DESTINATION {
            let suffix = if index % 2 == 0 { "tmp" } else { "prev" };
            let path = root.path().join(format!(
                "Library.tesina.{}.{suffix}",
                Uuid::new_v4().hyphenated(),
            ));
            fs::write(path, b"library").unwrap();
        }
        let other = root
            .path()
            .join(format!("Other.tesina.{}.tmp", Uuid::new_v4().hyphenated()));
        write_temp_no_replace_limited(&other, b"other")
            .expect("another destination has its own quota");
        assert_eq!(fs::read(other).unwrap(), b"other");
    }

    #[test]
    fn preservation_cannot_add_a_previous_file_beyond_the_quota() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        fs::write(&destination, b"previous bytes").unwrap();
        for index in 0..MAX_RELATED_FILES_PER_DESTINATION {
            let suffix = if index % 2 == 0 { "tmp" } else { "prev" };
            let path = root.path().join(format!(
                "Library.tesina.{}.{suffix}",
                Uuid::new_v4().hyphenated(),
            ));
            fs::write(path, b"archive").unwrap();
        }
        let previous = root.path().join(format!(
            "Library.tesina.{}.prev",
            Uuid::new_v4().hyphenated()
        ));

        let error = preserve_destination_no_replace_limited(
            &destination,
            &previous,
            &digest(b"previous bytes"),
        )
        .expect_err("preservation must share the related-file quota");

        assert_eq!(error.code, "portable/resource-limit");
        assert_eq!(fs::read(destination).unwrap(), b"previous bytes");
        assert!(!previous.exists());
    }

    #[test]
    fn concurrent_related_writes_cannot_exceed_the_quota() {
        let root = TempDir::new().unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let mut workers = Vec::new();
        for _ in 0..8 {
            let parent = root.path().to_path_buf();
            let barrier = barrier.clone();
            workers.push(std::thread::spawn(move || {
                let path = parent.join(format!(
                    "Library.tesina.{}.tmp",
                    Uuid::new_v4().hyphenated()
                ));
                barrier.wait();
                write_temp_no_replace_limited(&path, b"archive")
            }));
        }
        let successes = workers
            .into_iter()
            .map(|worker| worker.join().unwrap().is_ok())
            .filter(|success| *success)
            .count();
        assert_eq!(successes, MAX_RELATED_FILES_PER_DESTINATION / 2);
        let related_count = fs::read_dir(root.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| classify_related(&entry.path()).is_ok())
            .count();
        assert_eq!(related_count, MAX_RELATED_FILES_PER_DESTINATION / 2);
    }

    #[cfg(unix)]
    #[test]
    fn quota_count_never_follows_a_swapped_parent_directory() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let selected = root.path().join("selected");
        let moved = root.path().join("moved-selected");
        let outside = root.path().join("outside");
        fs::create_dir(&selected).unwrap();
        fs::create_dir(&outside).unwrap();
        for suffix in ["tmp", "prev"] {
            fs::write(
                selected.join(format!(
                    "Library.tesina.{}.{suffix}",
                    Uuid::new_v4().hyphenated()
                )),
                b"recovery",
            )
            .unwrap();
        }
        let next = selected.join(format!(
            "Library.tesina.{}.tmp",
            Uuid::new_v4().hyphenated()
        ));
        let directory = AnchoredRelatedDir::open(&selected).unwrap();
        fs::rename(&selected, &moved).unwrap();
        symlink(&outside, &selected).unwrap();

        let error = ensure_related_file_quota_in(&directory, &next)
            .expect_err("the held directory's recovery files must count toward quota");
        assert_eq!(error.code, "portable/resource-limit");
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    #[test]
    fn quota_does_not_pool_case_distinct_nonexistent_destinations() {
        let root = TempDir::new().unwrap();
        let lower = root.path().join("library.tesina");
        let upper = root.path().join("LIBRARY.TESINA");

        assert!(!same_destination_for_quota(&lower, &upper));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn quota_respects_volume_case_behavior_for_nonexistent_destinations() {
        let root = TempDir::new().unwrap();
        let lower = root.path().join("library.tesina");
        let upper = root.path().join("LIBRARY.TESINA");

        assert!(same_destination_for_quota_on_macos(&lower, &upper, false));
        assert!(!same_destination_for_quota_on_macos(&lower, &upper, true));
        let case_sensitive = macos_volume_is_case_sensitive(root.path()).unwrap_or(false);
        assert_eq!(same_destination_for_quota(&lower, &upper), !case_sensitive,);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn quota_pools_normalization_equivalent_destination_names() {
        let root = TempDir::new().unwrap();
        let composed = root.path().join("Caf\u{e9}.tesina");
        let decomposed = root.path().join("Cafe\u{301}.tesina");

        assert!(same_destination_for_quota_on_macos(
            &composed,
            &decomposed,
            true,
        ));
        assert!(same_destination_for_quota_on_macos(
            &composed,
            &decomposed,
            false,
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn quota_uses_full_unicode_case_folding_on_case_insensitive_volumes() {
        let root = TempDir::new().unwrap();
        let sharp_s = root.path().join("Stra\u{df}e.tesina");
        let expanded = root.path().join("STRASSE.tesina");
        let capital_sigma = root.path().join("\u{39f}\u{3a3}.tesina");
        let final_sigma = root.path().join("\u{3bf}\u{3c2}.tesina");

        assert!(same_destination_for_quota_on_macos(
            &sharp_s, &expanded, false,
        ));
        assert!(same_destination_for_quota_on_macos(
            &capital_sigma,
            &final_sigma,
            false,
        ));
        assert!(!same_destination_for_quota_on_macos(
            &sharp_s, &expanded, true,
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn quota_prefers_existing_destination_identity_over_lexical_names() {
        let root = TempDir::new().unwrap();
        let first = root.path().join("First.tesina");
        let alias = root.path().join("Alias.tesina");
        fs::write(&first, b"archive").unwrap();
        fs::hard_link(&first, &alias).unwrap();
        let directory = AnchoredRelatedDir::open(root.path()).unwrap();

        assert!(same_destination_for_quota_in(&directory, &first, &alias));
    }

    #[test]
    fn deterministic_recovery_files_count_toward_the_related_quota() {
        let root = TempDir::new().unwrap();
        let crashed = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        let direct = direct_recovery_path(&crashed).unwrap();
        fs::write(deletion_stage_path(&direct).unwrap(), b"crash evidence").unwrap();
        for _ in 0..3 {
            fs::write(
                root.path().join(format!(
                    "Library.tesina.{}.prev",
                    Uuid::new_v4().hyphenated()
                )),
                b"recovery",
            )
            .unwrap();
        }
        let next = root.path().join(format!(
            "Library.tesina.{}.prev",
            Uuid::new_v4().hyphenated()
        ));
        let directory = AnchoredRelatedDir::open(root.path()).unwrap();

        let error = ensure_related_file_quota_in(&directory, &next)
            .expect_err("crash recovery evidence must consume the final quota slot");
        assert_eq!(error.code, "portable/resource-limit");
    }

    #[test]
    fn duplicate_recovery_creation_cannot_grow_a_full_quota() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let first = root.path().join(format!(
            "Library.tesina.{}.prev",
            Uuid::new_v4().hyphenated()
        ));
        let second = root.path().join(format!(
            "Library.tesina.{}.prev",
            Uuid::new_v4().hyphenated()
        ));
        for path in [&first, &second] {
            fs::write(path, b"old archive").unwrap();
        }
        for _ in 0..2 {
            fs::write(
                root.path().join(format!(
                    "Library.tesina.{}.tmp",
                    Uuid::new_v4().hyphenated()
                )),
                b"pending archive",
            )
            .unwrap();
        }

        let mut outcomes = Vec::new();
        for previous in [&first, &second] {
            fs::write(&destination, b"old archive").unwrap();
            outcomes.push(preserve_destination_no_replace_limited(
                &destination,
                previous,
                &digest(b"old archive"),
            ));
        }

        assert!(outcomes.iter().all(|outcome| matches!(
            outcome,
            Err(error) if error.code == "portable/resource-limit"
        )));
        assert!(!duplicate_recovery_path(&first).unwrap().exists());
        assert!(!duplicate_recovery_path(&second).unwrap().exists());
        let directory = AnchoredRelatedDir::open(root.path()).unwrap();
        let mut count = 0;
        directory
            .for_each_entry(|entry| {
                if classify_related_or_recovery(&entry).is_ok() {
                    count += 1;
                }
            })
            .unwrap();
        assert_eq!(count, MAX_RELATED_FILES_PER_DESTINATION);
    }

    #[test]
    fn installs_a_sibling_without_replacing_an_existing_destination() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"new").unwrap();
        atomic_rename_no_replace(&temporary, &destination, &digest(b"new")).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        assert!(!temporary.exists());

        let second = root
            .path()
            .join("Library.tesina.00000000-0000-4000-8000-000000000002.tmp");
        fs::write(&second, b"other").unwrap();
        atomic_rename_no_replace(&second, &destination, &digest(b"other"))
            .expect_err("an existing destination must never be replaced");
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        assert_eq!(fs::read(&second).unwrap(), b"other");
    }

    #[test]
    fn rejects_non_sibling_or_non_temporary_sources() {
        let root = TempDir::new().unwrap();
        let other = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let outside = other.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&outside, b"new").unwrap();
        assert!(atomic_rename_no_replace(&outside, &destination, &digest(b"new")).is_err());

        let wrong_name = root.path().join("unrelated.tmp");
        fs::write(&wrong_name, b"new").unwrap();
        assert!(atomic_rename_no_replace(&wrong_name, &destination, &digest(b"new")).is_err());
    }

    #[test]
    fn related_operations_cover_new_replacement_and_previous_file_recovery() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        write_temp_no_replace(&temporary, b"first archive").unwrap();
        assert_eq!(read_bounded(&temporary).unwrap(), b"first archive");
        assert_eq!(
            hash_bounded(&temporary).unwrap(),
            format!("{:x}", Sha256::digest(b"first archive"))
        );
        atomic_rename_no_replace(&temporary, &destination, &digest(b"first archive")).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"first archive");
        assert!(!temporary.exists());

        let second = root
            .path()
            .join("Library.tesina.00000000-0000-4000-8000-000000000002.tmp");
        let previous = root
            .path()
            .join("Library.tesina.00000000-0000-4000-8000-000000000003.prev");
        write_temp_no_replace(&second, b"second archive").unwrap();
        preserve_destination_no_replace(&destination, &previous, &digest(b"first archive"))
            .unwrap();
        assert!(!destination.exists());
        assert_eq!(fs::read(&previous).unwrap(), b"first archive");
        atomic_rename_no_replace(&second, &destination, &digest(b"second archive")).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"second archive");
        let previous_hash = format!("{:x}", Sha256::digest(b"first archive"));
        remove_previous_if_hash_matches_with_hook(
            &previous,
            &previous_hash,
            &digest(b"second archive"),
            |_| Ok(()),
        )
        .unwrap();
        assert!(!previous.exists());

        let recovery_previous = root
            .path()
            .join("Library.tesina.00000000-0000-4000-8000-000000000004.prev");
        preserve_destination_no_replace(
            &destination,
            &recovery_previous,
            &digest(b"second archive"),
        )
        .unwrap();
        atomic_rename_no_replace(&recovery_previous, &destination, &digest(b"second archive"))
            .unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"second archive");
        assert!(!recovery_previous.exists());
    }

    #[test]
    fn preservation_never_deletes_a_concurrent_destination_replacement() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"previous bytes").unwrap();

        preserve_destination_no_replace_with_hook(
            &destination,
            &previous,
            &digest(b"previous bytes"),
            || {
                fs::write(&destination, b"provider replacement").unwrap();
                Ok(())
            },
        )
        .expect_err("the replacement identity must stop preservation");

        assert_eq!(fs::read(&destination).unwrap(), b"provider replacement");
        assert_eq!(fs::read(&previous).unwrap(), b"previous bytes");
    }

    #[test]
    fn preservation_rejects_a_destination_changed_since_hashing() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"provider replacement").unwrap();

        preserve_destination_no_replace(&destination, &previous, &digest(b"previous bytes"))
            .expect_err("the journal digest must bind the preserved destination");

        assert_eq!(fs::read(&destination).unwrap(), b"provider replacement");
        assert!(!previous.exists());
    }

    #[test]
    fn installation_accepts_a_correct_destination_when_the_temp_name_reappears() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"archive bytes").unwrap();

        atomic_rename_no_replace_with_hook(
            &temporary,
            &destination,
            &digest(b"archive bytes"),
            || {
                fs::write(&temporary, b"provider replacement").unwrap();
                Ok(())
            },
        )
        .expect("the verified installed destination is authoritative");

        assert_eq!(fs::read(&destination).unwrap(), b"archive bytes");
        assert_eq!(fs::read(&temporary).unwrap(), b"provider replacement");
    }

    #[test]
    fn installation_keeps_a_swapped_source_without_publishing_it() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"archive bytes").unwrap();

        atomic_rename_no_replace_with_hooks(
            &temporary,
            &destination,
            &digest(b"archive bytes"),
            || {
                fs::remove_file(&temporary).unwrap();
                fs::write(&temporary, b"provider replacement").unwrap();
                Ok(())
            },
            || Ok(()),
            || Ok(()),
        )
        .expect_err("the replacement must remain at the temporary pathname");

        assert!(!destination.exists());
        assert_eq!(fs::read(&temporary).unwrap(), b"provider replacement");
    }

    #[cfg(unix)]
    #[test]
    fn publication_never_follows_a_swapped_parent_directory() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let selected = root.path().join("selected");
        let moved = root.path().join("moved-selected");
        let outside = root.path().join("outside");
        fs::create_dir(&selected).unwrap();
        fs::create_dir(&outside).unwrap();
        let destination = selected.join("Library.tesina");
        let temporary = selected.join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"archive bytes").unwrap();

        atomic_rename_no_replace_with_hooks(
            &temporary,
            &destination,
            &digest(b"archive bytes"),
            || {
                fs::rename(&selected, &moved).unwrap();
                fs::hard_link(
                    moved.join(format!("Library.tesina.{TOKEN}.tmp")),
                    outside.join(format!("Library.tesina.{TOKEN}.tmp")),
                )
                .unwrap();
                symlink(&outside, &selected).unwrap();
                Ok(())
            },
            || Ok(()),
            || Ok(()),
        )
        .expect("publication stays bound to the originally opened directory");

        assert_eq!(
            fs::read(moved.join("Library.tesina")).unwrap(),
            b"archive bytes"
        );
        assert!(!outside.join("Library.tesina").exists());
    }

    #[cfg(unix)]
    #[test]
    fn publication_evidence_never_follows_a_swapped_parent_directory() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let selected = root.path().join("selected");
        let moved = root.path().join("moved-selected");
        let outside = root.path().join("outside");
        fs::create_dir(&selected).unwrap();
        fs::create_dir(&outside).unwrap();
        let destination = selected.join("Library.tesina");
        let temporary = selected.join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"archive bytes").unwrap();

        atomic_rename_no_replace_with_hooks(
            &temporary,
            &destination,
            &digest(b"archive bytes"),
            || Ok(()),
            || {
                fs::rename(&selected, &moved).unwrap();
                symlink(&outside, &selected).unwrap();
                fs::remove_file(moved.join("Library.tesina")).unwrap();
                fs::write(moved.join("Library.tesina"), b"provider replacement").unwrap();
                Ok(())
            },
            || Ok(()),
        )
        .expect_err("a provider replacement must preserve evidence in the held directory");

        assert_eq!(
            fs::read(moved.join(format!("Library.tesina.{TOKEN}.tmp"))).unwrap(),
            b"archive bytes"
        );
        assert_eq!(
            fs::read(moved.join("Library.tesina")).unwrap(),
            b"provider replacement"
        );
        assert!(!outside.join(format!("Library.tesina.{TOKEN}.tmp")).exists());
        assert!(!outside.join("Library.tesina").exists());
    }

    #[cfg(windows)]
    #[test]
    fn held_directory_chain_cannot_be_renamed_on_windows() {
        let root = TempDir::new().unwrap();
        let ancestor = root.path().join("ancestor");
        let selected = ancestor.join("selected");
        let moved = root.path().join("moved-ancestor");
        fs::create_dir(&ancestor).unwrap();
        fs::create_dir(&selected).unwrap();

        let directory = AnchoredRelatedDir::open(&selected).unwrap();
        fs::rename(&ancestor, &moved)
            .expect_err("the held directory chain must deny delete sharing");
        drop(directory);
        fs::rename(&ancestor, &moved)
            .expect("dropping the anchors releases the directory rename lock");
    }

    #[test]
    fn installation_rejects_an_in_place_temp_mutation_before_publication() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"archive bytes").unwrap();

        atomic_rename_no_replace_with_hooks(
            &temporary,
            &destination,
            &digest(b"archive bytes"),
            || {
                let identity = FileIdentity::from_path(&temporary).unwrap();
                fs::write(&temporary, b"provider replacement").unwrap();
                assert_eq!(FileIdentity::from_path(&temporary).unwrap(), identity);
                Ok(())
            },
            || Ok(()),
            || Ok(()),
        )
        .expect_err("the digest mismatch must stop publication");

        assert!(!destination.exists());
        assert_eq!(fs::read(&temporary).unwrap(), b"provider replacement");
    }

    #[test]
    fn preservation_keeps_a_swapped_destination_and_preserves_operation_evidence() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"previous bytes").unwrap();

        preserve_destination_no_replace_with_hooks(
            &destination,
            &previous,
            &digest(b"previous bytes"),
            || {
                fs::remove_file(&destination).unwrap();
                fs::write(&destination, b"provider replacement").unwrap();
                Ok(())
            },
            || Ok(()),
            || Ok(()),
            || Ok(()),
            || Ok(()),
        )
        .expect_err("the replacement must remain public while operation evidence is preserved");

        assert_eq!(fs::read(&previous).unwrap(), b"previous bytes");
        assert_eq!(fs::read(&destination).unwrap(), b"provider replacement");
    }

    #[test]
    fn publication_preserves_a_provider_replacement_after_the_os_rename() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"archive bytes").unwrap();

        atomic_rename_no_replace_with_hooks(
            &temporary,
            &destination,
            &digest(b"archive bytes"),
            || Ok(()),
            || {
                fs::remove_file(&destination).unwrap();
                fs::write(&destination, b"provider replacement").unwrap();
                Ok(())
            },
            || Ok(()),
        )
        .expect_err("the provider replacement must stop publication verification");

        assert_eq!(fs::read(&destination).unwrap(), b"provider replacement");
        assert_eq!(fs::read(&temporary).unwrap(), b"archive bytes");
    }

    #[test]
    fn publication_rejects_an_in_place_mutation_after_the_os_rename() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"archive bytes").unwrap();

        atomic_rename_no_replace_with_hooks(
            &temporary,
            &destination,
            &digest(b"archive bytes"),
            || Ok(()),
            || {
                let identity = FileIdentity::from_path(&destination).unwrap();
                fs::write(&destination, b"provider replacement").unwrap();
                assert_eq!(FileIdentity::from_path(&destination).unwrap(), identity);
                Ok(())
            },
            || Ok(()),
        )
        .expect_err("the post-rename digest mismatch must reject publication");

        assert_eq!(fs::read(&destination).unwrap(), b"provider replacement");
        assert_eq!(fs::read(&temporary).unwrap(), b"provider replacement");
    }

    #[cfg(unix)]
    #[test]
    fn publication_rejects_a_same_inode_symlink_after_the_os_rename() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        let backing = root.path().join("held-archive");
        fs::write(&temporary, b"archive bytes").unwrap();
        fs::hard_link(&temporary, &backing).unwrap();

        atomic_rename_no_replace_with_hooks(
            &temporary,
            &destination,
            &digest(b"archive bytes"),
            || Ok(()),
            || {
                fs::remove_file(&destination).unwrap();
                symlink(&backing, &destination).unwrap();
                Ok(())
            },
            || Ok(()),
        )
        .expect_err("a symlink must never pass publication identity checks");

        assert!(fs::symlink_metadata(&destination)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&temporary).unwrap(), b"archive bytes");
    }

    #[test]
    fn preservation_resumes_after_previous_was_published_before_cleanup() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"previous bytes").unwrap();
        fs::write(&previous, b"previous bytes").unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"previous bytes");
        assert_eq!(fs::read(&previous).unwrap(), b"previous bytes");

        preserve_destination_no_replace(&destination, &previous, &digest(b"previous bytes"))
            .expect("the retry recognizes the already-published previous file");

        assert!(!destination.exists());
        assert_eq!(fs::read(&previous).unwrap(), b"previous bytes");
        let duplicate = expected_recovery_path(&previous, ".tesina-duplicate-recovery");
        assert_eq!(fs::read(&duplicate).unwrap(), b"previous bytes");

        remove_previous_if_hash_matches_with_hook(
            &previous,
            &digest(b"previous bytes"),
            &digest(b"new archive"),
            |_| Ok(()),
        )
        .expect_err("old copies remain until a public destination is installed");
        assert_eq!(fs::read(&previous).unwrap(), b"previous bytes");
        assert_eq!(fs::read(&duplicate).unwrap(), b"previous bytes");

        fs::write(&destination, b"new archive").unwrap();
        remove_previous_if_hash_matches_with_hook(
            &previous,
            &digest(b"previous bytes"),
            &digest(b"new archive"),
            |_| Ok(()),
        )
        .expect("post-install cleanup removes both journal-derived old copies");
        assert!(!previous.exists());
        assert!(!duplicate.exists());
        assert_eq!(fs::read(destination).unwrap(), b"new archive");
    }

    #[test]
    fn duplicate_recovery_mismatch_never_deletes_the_other_old_copy() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"previous bytes").unwrap();
        fs::write(&previous, b"previous bytes").unwrap();
        preserve_destination_no_replace(&destination, &previous, &digest(b"previous bytes"))
            .unwrap();
        let duplicate = duplicate_recovery_path(&previous).unwrap();
        fs::write(&duplicate, b"provider replacement").unwrap();
        fs::write(&destination, b"new archive").unwrap();

        remove_previous_if_hash_matches_with_hook(
            &previous,
            &digest(b"previous bytes"),
            &digest(b"new archive"),
            |_| Ok(()),
        )
        .expect_err("every retained old copy is validated before either is deleted");

        assert_eq!(fs::read(previous).unwrap(), b"previous bytes");
        assert_eq!(fs::read(duplicate).unwrap(), b"provider replacement");
        assert_eq!(fs::read(destination).unwrap(), b"new archive");
    }

    #[test]
    fn previous_cleanup_rejects_an_unvalidated_installed_destination() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"provider replacement").unwrap();
        fs::write(&previous, b"previous bytes").unwrap();

        remove_previous_if_hash_matches_with_hooks(
            &previous,
            &digest(b"previous bytes"),
            &digest(b"installed archive"),
            |_| Ok(()),
            || Ok(()),
            |_| Ok(()),
        )
        .expect_err("old evidence must remain when the installed digest does not match");

        assert_eq!(fs::read(previous).unwrap(), b"previous bytes");
        assert_eq!(fs::read(destination).unwrap(), b"provider replacement");
    }

    #[test]
    fn previous_cleanup_revalidates_destination_before_each_old_copy() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"previous bytes").unwrap();
        fs::write(&previous, b"previous bytes").unwrap();
        preserve_destination_no_replace(&destination, &previous, &digest(b"previous bytes"))
            .unwrap();
        let duplicate = duplicate_recovery_path(&previous).unwrap();
        fs::write(&destination, b"installed archive").unwrap();

        remove_previous_if_hash_matches_with_hooks(
            &previous,
            &digest(b"previous bytes"),
            &digest(b"installed archive"),
            |_| Ok(()),
            || {
                fs::write(&destination, b"provider replacement").unwrap();
                Ok(())
            },
            |_| Ok(()),
        )
        .expect_err("the second old copy must remain after the installed archive changes");

        assert!(!previous.exists());
        assert_eq!(fs::read(duplicate).unwrap(), b"previous bytes");
        assert_eq!(fs::read(destination).unwrap(), b"provider replacement");
    }

    #[test]
    fn disappearing_installed_destination_retains_an_old_recovery_copy() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"previous bytes").unwrap();
        fs::write(&previous, b"previous bytes").unwrap();
        preserve_destination_no_replace(&destination, &previous, &digest(b"previous bytes"))
            .unwrap();
        let duplicate = duplicate_recovery_path(&previous).unwrap();
        fs::write(&destination, b"new archive").unwrap();

        remove_previous_if_hash_matches_with_hooks(
            &previous,
            &digest(b"previous bytes"),
            &digest(b"new archive"),
            |_| Ok(()),
            || {
                fs::remove_file(&destination).unwrap();
                Ok(())
            },
            |_| Ok(()),
        )
        .expect_err("the final old copy is retained when the installed destination disappears");

        assert!(!previous.exists());
        assert_eq!(fs::read(duplicate).unwrap(), b"previous bytes");
        assert!(!destination.exists());
    }

    #[test]
    fn preservation_retry_keeps_an_in_place_destination_mutation() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"previous bytes").unwrap();
        fs::write(&previous, b"previous bytes").unwrap();

        preserve_destination_no_replace_with_hooks(
            &destination,
            &previous,
            &digest(b"previous bytes"),
            || Ok(()),
            || Ok(()),
            || {
                let identity = FileIdentity::from_path(&destination).unwrap();
                fs::write(&destination, b"provider replacement").unwrap();
                assert_eq!(FileIdentity::from_path(&destination).unwrap(), identity);
                Ok(())
            },
            || Ok(()),
            || Ok(()),
        )
        .expect_err("hash-bound cleanup must reject the in-place mutation");

        assert_eq!(fs::read(&destination).unwrap(), b"provider replacement");
        assert_eq!(fs::read(&previous).unwrap(), b"previous bytes");
    }

    #[test]
    fn preservation_retry_restores_destination_when_previous_changes_after_quarantine() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"previous bytes").unwrap();
        fs::write(&previous, b"previous bytes").unwrap();

        preserve_destination_no_replace_with_hooks(
            &destination,
            &previous,
            &digest(b"previous bytes"),
            || Ok(()),
            || Ok(()),
            || Ok(()),
            || {
                fs::remove_file(&previous).unwrap();
                fs::write(&previous, b"provider replacement").unwrap();
                Ok(())
            },
            || Ok(()),
        )
        .expect_err("the changed previous file must stop duplicate cleanup");

        assert_eq!(fs::read(&destination).unwrap(), b"previous bytes");
        assert_eq!(fs::read(&previous).unwrap(), b"provider replacement");
    }

    #[test]
    fn preservation_retry_revalidates_previous_immediately_before_deletion() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        fs::write(&destination, b"previous bytes").unwrap();
        fs::write(&previous, b"previous bytes").unwrap();

        preserve_destination_no_replace_with_hooks(
            &destination,
            &previous,
            &digest(b"previous bytes"),
            || Ok(()),
            || Ok(()),
            || Ok(()),
            || Ok(()),
            || {
                fs::remove_file(&previous).unwrap();
                fs::write(&previous, b"provider replacement").unwrap();
                Ok(())
            },
        )
        .expect_err("the final previous-file guard must stop deletion");

        assert_eq!(fs::read(&destination).unwrap(), b"previous bytes");
        assert_eq!(fs::read(&previous).unwrap(), b"provider replacement");
    }

    #[test]
    fn identity_checked_cleanup_never_deletes_a_replaced_temp_path() {
        let root = TempDir::new().unwrap();
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"owned partial").unwrap();
        let owned = FileIdentity::from_path(&temporary).unwrap();

        cleanup_created_file_with_hook(&temporary, &owned, || {
            fs::remove_file(&temporary).unwrap();
            fs::write(&temporary, b"provider replacement").unwrap();
            Ok(())
        })
        .expect_err("a replacement must not be deleted");

        assert_eq!(fs::read(temporary).unwrap(), b"provider replacement");
    }

    #[test]
    fn quarantine_restore_never_replaces_a_new_public_file() {
        let root = TempDir::new().unwrap();
        let public = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        let quarantine = root.path().join("quarantined");
        fs::write(&public, b"provider replacement").unwrap();
        fs::write(&quarantine, b"operation evidence").unwrap();

        restore_quarantined_no_replace(&quarantine, &public)
            .expect_err("the public collision must retain both files");

        assert_eq!(fs::read(&public).unwrap(), b"provider replacement");
        assert_eq!(fs::read(&quarantine).unwrap(), b"operation evidence");
    }

    #[test]
    fn recovery_evidence_copy_is_bounded_and_removes_its_partial_file() {
        let root = TempDir::new().unwrap();
        let source_path = root.path().join("source");
        let evidence_path = root.path().join("evidence");
        fs::write(&source_path, b"four").unwrap();
        let mut source = fs::File::open(source_path).unwrap();

        restore_opened_evidence_with_limit(&mut source, &evidence_path, 3)
            .expect_err("copying beyond the bound must fail");

        assert!(!evidence_path.exists());
    }

    #[test]
    fn bounded_delete_ready_copy_retains_discoverable_partial_evidence() {
        let root = TempDir::new().unwrap();
        let logical = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        let direct = direct_recovery_path(&logical).unwrap();
        let delete_ready = deletion_stage_path(&direct).unwrap();
        let source_path = root.path().join("source");
        fs::write(&source_path, b"four").unwrap();
        let mut source = fs::File::open(source_path).unwrap();
        let directory = AnchoredRelatedDir::open(root.path()).unwrap();

        restore_opened_recovery_evidence_with_limit_in(&directory, &mut source, &delete_ready, 3)
            .expect_err("a growing evidence source must stay bounded");

        assert!(delete_ready.exists());
        assert!(classify_recovery(&delete_ready).is_ok());
        assert!(related_exists_in(&directory, &logical).unwrap());
    }

    #[test]
    fn opened_source_validation_rejects_oversized_files() {
        let root = TempDir::new().unwrap();
        let source_path = root.path().join("source");
        fs::write(&source_path, b"four").unwrap();
        let mut source = fs::File::open(source_path).unwrap();

        validate_opened_source_with_limit(&mut source, None, 3)
            .expect_err("oversized preservation sources must be rejected");
    }

    #[cfg(unix)]
    #[test]
    fn related_reads_and_writes_reject_symlinks() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let target = root.path().join("target");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&target, b"outside").unwrap();
        symlink(&target, &temporary).unwrap();

        assert!(read_bounded(&temporary).is_err());
        assert!(write_temp_no_replace(&temporary, b"replacement").is_err());
        assert_eq!(fs::read(target).unwrap(), b"outside");
    }

    #[cfg(unix)]
    #[test]
    fn destination_anchor_rejects_a_selected_symlink() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let target = root.path().join("target.tesina");
        let destination = root.path().join("Library.tesina");
        fs::write(&target, b"outside").unwrap();
        symlink(&target, &destination).unwrap();

        assert!(ensure_destination_anchor(&destination).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn opening_a_related_file_rejects_a_symlink_swap() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let target = root.path().join("outside");
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&target, b"outside bytes").unwrap();
        fs::write(&temporary, b"owned bytes").unwrap();

        let opened = open_regular_owned_with_hook(&temporary, "related file", || {
            fs::remove_file(&temporary).unwrap();
            symlink(&target, &temporary).unwrap();
            Ok(())
        });

        assert!(opened.is_err());
        assert_eq!(fs::read(target).unwrap(), b"outside bytes");
    }

    #[test]
    fn related_reads_and_hashes_enforce_the_byte_limit() {
        let root = TempDir::new().unwrap();
        let temporary = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&temporary, b"four").unwrap();

        let caller_limit = validated_external_archive_limit(3).unwrap();
        assert!(read_bounded_with_limit(&temporary, caller_limit).is_err());
        assert!(hash_bounded_with_limit(&temporary, caller_limit).is_err());
        let error = validated_external_archive_limit(MAX_ARCHIVE_BYTES as u64 + 1)
            .expect_err("renderer limits above the native cap must be rejected");
        assert_eq!(error.code, "portable/resource-limit");
    }

    #[test]
    fn failed_copy_cleanup_preserves_a_replacement() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        fs::write(&destination, b"owned partial").unwrap();
        let owned = FileIdentity::from_path(&destination).unwrap();

        cleanup_created_file_with_hook(&destination, &owned, || {
            fs::remove_file(&destination).unwrap();
            fs::write(&destination, b"synced replacement").unwrap();
            Ok(())
        })
        .expect_err("a replacement must not be deleted");

        assert_eq!(fs::read(destination).unwrap(), b"synced replacement");
    }

    #[test]
    fn verified_removal_keeps_a_new_file_at_the_public_name() {
        let root = TempDir::new().unwrap();
        let path = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&path, b"previous").unwrap();
        let expected = format!("{:x}", Sha256::digest(b"previous"));

        remove_if_hash_matches_with_hook(&path, &expected, |_| {
            fs::write(&path, b"new synced bytes")
                .map_err(|error| format!("cannot write race fixture: {error}"))
        })
        .unwrap();

        assert_eq!(fs::read(path).unwrap(), b"new synced bytes");
    }

    #[test]
    fn verified_removal_keeps_quarantined_bytes_changed_after_validation() {
        let root = TempDir::new().unwrap();
        let path = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&path, b"previous").unwrap();
        let expected = digest(b"previous");

        remove_if_hash_matches_with_hook(&path, &expected, |quarantine| {
            fs::write(quarantine, b"provider replacement")
                .map_err(|error| format!("cannot write race fixture: {error}"))
        })
        .expect_err("bytes changed after validation must never be deleted");

        assert_eq!(fs::read(path).unwrap(), b"provider replacement");
    }

    #[cfg(unix)]
    #[test]
    fn removal_restoration_never_follows_a_swapped_parent_directory() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let selected = root.path().join("selected");
        let moved = root.path().join("moved-selected");
        let outside = root.path().join("outside");
        fs::create_dir(&selected).unwrap();
        fs::create_dir(&outside).unwrap();
        let path = selected.join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&path, b"previous").unwrap();

        remove_if_hash_matches_with_hook(&path, &digest(b"previous"), |_| {
            fs::rename(&selected, &moved).unwrap();
            symlink(&outside, &selected).unwrap();
            Err("interrupt removal after quarantine".to_owned())
        })
        .expect_err("interrupted removal must restore through the held directory");

        assert_eq!(
            fs::read(moved.join(format!("Library.tesina.{TOKEN}.tmp"))).unwrap(),
            b"previous"
        );
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }

    #[test]
    fn hash_mismatch_restores_the_related_file() {
        let root = TempDir::new().unwrap();
        let path = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&path, b"owned bytes").unwrap();

        remove_if_hash_matches_with_hook(&path, "wrong-hash", |_| Ok(()))
            .expect_err("mismatched bytes must not be deleted");

        assert_eq!(fs::read(path).unwrap(), b"owned bytes");
    }

    #[test]
    fn temp_cleanup_resumes_after_a_crash_left_deterministic_quarantine() {
        let root = TempDir::new().unwrap();
        let path = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        let quarantine = expected_recovery_path(&path, ".tesina-recovery");
        fs::write(&path, b"owned bytes").unwrap();
        fs::rename(&path, &quarantine).unwrap();

        remove_if_hash_matches_with_hook(&path, &digest(b"owned bytes"), |_| Ok(()))
            .expect("the journaled temp command resumes hash-bound deletion");

        assert!(!path.exists());
        assert!(!quarantine.exists());
    }

    #[test]
    fn resumed_cleanup_retains_both_public_and_quarantined_copies() {
        let root = TempDir::new().unwrap();
        let path = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        let quarantine = expected_recovery_path(&path, ".tesina-recovery");
        fs::write(&path, b"owned bytes").unwrap();
        fs::write(&quarantine, b"owned bytes").unwrap();

        remove_if_hash_matches_with_hook(&path, &digest(b"owned bytes"), |_| Ok(()))
            .expect_err("ambiguous crash evidence must fail closed without deleting either copy");

        assert_eq!(fs::read(path).unwrap(), b"owned bytes");
        assert_eq!(fs::read(quarantine).unwrap(), b"owned bytes");
    }

    #[test]
    fn direct_quarantine_final_name_swap_preserves_replacement_and_evidence() {
        let root = TempDir::new().unwrap();
        let path = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        fs::write(&path, b"owned bytes").unwrap();
        let direct = direct_recovery_path(&path).unwrap();
        let delete_ready = deletion_stage_path(&direct).unwrap();

        remove_temp_if_hash_matches_with_final_identity_hook(
            &path,
            &digest(b"owned bytes"),
            |verified_name| {
                fs::remove_file(verified_name).unwrap();
                fs::write(verified_name, b"provider replacement").unwrap();
                Ok(())
            },
        )
        .expect_err("a final name swap must not delete the replacement");

        assert_eq!(fs::read(path).unwrap(), b"provider replacement");
        assert_eq!(fs::read(&delete_ready).unwrap(), b"owned bytes");
        assert!(classify_recovery(&delete_ready).is_ok());
    }

    #[test]
    fn previous_cleanup_resumes_after_a_crash_left_deterministic_quarantine() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let path = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        let quarantine = expected_recovery_path(&path, ".tesina-recovery");
        fs::write(&destination, b"installed archive").unwrap();
        fs::write(&path, b"previous bytes").unwrap();
        fs::rename(&path, &quarantine).unwrap();

        remove_previous_if_hash_matches_with_hook(
            &path,
            &digest(b"previous bytes"),
            &digest(b"installed archive"),
            |_| Ok(()),
        )
        .expect("the journaled previous command resumes hash-bound deletion");

        assert!(!path.exists());
        assert!(!quarantine.exists());
    }

    #[test]
    fn related_reads_and_exists_resolve_deterministic_crash_evidence() {
        let root = TempDir::new().unwrap();
        let path = root.path().join(format!("Library.tesina.{TOKEN}.tmp"));
        let quarantine = direct_recovery_path(&path).unwrap();
        fs::write(&quarantine, b"owned bytes").unwrap();
        let directory = AnchoredRelatedDir::open(root.path()).unwrap();

        assert!(related_exists_in(&directory, &path).unwrap());
        assert_eq!(read_bounded(&path).unwrap(), b"owned bytes");
        assert_eq!(hash_bounded(&path).unwrap(), digest(b"owned bytes"));
    }

    #[test]
    fn previous_cleanup_resumes_when_only_duplicate_evidence_remains() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        let duplicate = duplicate_recovery_path(&previous).unwrap();
        fs::write(&destination, b"new archive").unwrap();
        fs::write(&duplicate, b"previous bytes").unwrap();
        let directory = AnchoredRelatedDir::open(root.path()).unwrap();
        assert!(related_exists_in(&directory, &previous).unwrap());

        remove_previous_if_hash_matches_with_hook(
            &previous,
            &digest(b"previous bytes"),
            &digest(b"new archive"),
            |_| Ok(()),
        )
        .expect("cleanup resumes after the first old copy was already removed");

        assert!(!previous.exists());
        assert!(!duplicate.exists());
        assert_eq!(fs::read(destination).unwrap(), b"new archive");
    }

    #[test]
    fn duplicate_recovery_final_name_swap_preserves_replacement_and_evidence() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let previous = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        let duplicate = duplicate_recovery_path(&previous).unwrap();
        let delete_ready = deletion_stage_path(&duplicate).unwrap();
        fs::write(&destination, b"installed archive").unwrap();
        fs::write(&duplicate, b"previous bytes").unwrap();

        remove_previous_if_hash_matches_with_hooks(
            &previous,
            &digest(b"previous bytes"),
            &digest(b"installed archive"),
            |_| Ok(()),
            || Ok(()),
            |verified_name| {
                fs::remove_file(verified_name).unwrap();
                fs::write(verified_name, b"provider replacement").unwrap();
                Ok(())
            },
        )
        .expect_err("a duplicate-evidence name swap must retain both byte sets");

        assert_eq!(fs::read(duplicate).unwrap(), b"provider replacement");
        assert_eq!(fs::read(&delete_ready).unwrap(), b"previous bytes");
        assert!(classify_recovery(&delete_ready).is_ok());
    }

    #[test]
    fn delete_ready_swap_during_before_delete_preserves_replacement_and_owned_evidence() {
        let root = TempDir::new().unwrap();
        let path = root.path().join(format!("Library.tesina.{TOKEN}.prev"));
        let recovery = direct_recovery_path(&path).unwrap();
        let delete_ready = deletion_stage_path(&recovery).unwrap();
        fs::write(&recovery, b"owned bytes").unwrap();
        let directory = AnchoredRelatedDir::open(root.path()).unwrap();
        fn after_final_identity(_: &Path) -> Result<(), String> {
            Ok(())
        }
        let mut after_final_identity = after_final_identity;

        remove_recovery_evidence_with_hooks_in(
            &directory,
            &recovery,
            &digest(b"owned bytes"),
            || Ok(()),
            &mut after_final_identity,
            || {
                fs::remove_file(&delete_ready).unwrap();
                fs::write(&delete_ready, b"provider replacement").unwrap();
                Ok(())
            },
        )
        .expect_err("a staged name swap must retain both byte sets");

        assert_eq!(fs::read(recovery).unwrap(), b"provider replacement");
        assert_eq!(fs::read(&delete_ready).unwrap(), b"owned bytes");
        assert!(classify_recovery(&delete_ready).is_ok());
    }
}
