use same_file::Handle as FileIdentity;
use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::io::ErrorKind;
use std::io::Read;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;

fn copy_no_replace(from: &Path, to: &Path) -> Result<(), String> {
    let mut source =
        fs::File::open(from).map_err(|error| format!("cannot open temporary file: {error}"))?;
    let mut destination = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|error| format!("cannot create destination exclusively: {error}"))?;
    let owned_identity = destination
        .try_clone()
        .and_then(FileIdentity::from_file)
        .map_err(|error| format!("cannot identify destination: {error}"))?;
    let result = io::copy(&mut source, &mut destination)
        .map_err(|error| format!("cannot copy temporary file: {error}"))
        .and_then(|_| {
            destination
                .sync_all()
                .map_err(|error| format!("cannot sync destination: {error}"))
        });
    drop(destination);
    if result.is_err() {
        let _ = cleanup_created_file_with_hook(to, &owned_identity, || Ok(()));
    }
    result
}

fn cleanup_created_file_with_hook<F>(
    path: &Path,
    owned_identity: &FileIdentity,
    before_quarantine: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    before_quarantine()?;
    if !path.exists() {
        return Ok(());
    }
    let parent = path.parent().ok_or("created file has no parent")?;
    let quarantine = parent.join(format!(".failed-{}", Uuid::new_v4()));
    fs::rename(path, &quarantine)
        .map_err(|error| format!("cannot quarantine incomplete destination: {error}"))?;
    let current = FileIdentity::from_path(&quarantine)
        .map_err(|error| format!("cannot identify quarantined destination: {error}"))?;
    if owned_identity == &current {
        return fs::remove_file(&quarantine)
            .map_err(|error| format!("cannot remove incomplete destination: {error}"));
    }
    if !path.exists() {
        let _ = fs::rename(&quarantine, path);
    }
    Err("the incomplete destination pathname now belongs to another file".to_owned())
}

fn atomic_rename_no_replace(from: &Path, to: &Path) -> Result<(), String> {
    let from_parent = from.parent().ok_or("temporary file has no parent")?;
    let to_parent = to.parent().ok_or("destination has no parent")?;
    if from_parent != to_parent {
        return Err("temporary file and destination must be siblings".to_owned());
    }
    let destination_name = to
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("destination name is invalid UTF-8")?;
    if !destination_name.ends_with(".tesina") {
        return Err("destination must use the .tesina extension".to_owned());
    }
    let temporary_name = from
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("temporary name is invalid UTF-8")?;
    if !temporary_name.starts_with(&format!("{destination_name}."))
        || !temporary_name.ends_with(".tmp")
    {
        return Err("temporary file does not belong to the destination".to_owned());
    }
    let metadata = fs::symlink_metadata(from)
        .map_err(|error| format!("temporary file is not accessible: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("temporary path is not a regular file".to_owned());
    }

    // A hard link creates the destination atomically and fails if it already
    // exists. Because the prepared file is a sibling, both names are on the
    // same filesystem. Removing the temporary name completes the move.
    match fs::hard_link(from, to) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            return Err(format!("destination already exists: {error}"));
        }
        Err(_) => copy_no_replace(from, to)?,
    }
    let _ = fs::remove_file(from);
    Ok(())
}

#[tauri::command]
pub async fn external_rename_no_replace(from: String, to: String) -> Result<(), String> {
    let from = PathBuf::from(from);
    let to = PathBuf::from(to);
    tauri::async_runtime::spawn_blocking(move || atomic_rename_no_replace(&from, &to))
        .await
        .map_err(|error| format!("external file worker failed: {error}"))?
}

fn remove_if_hash_matches_with_hook<F>(
    path: &Path,
    expected_sha256: &str,
    after_quarantine: F,
) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let parent = path.parent().ok_or("preserved file has no parent")?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("preserved file name is invalid UTF-8")?;
    if !name.contains(".tesina.") || !name.ends_with(".prev") {
        return Err("only a journaled .tesina preserved file may be removed".to_owned());
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("preserved file is not accessible: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("preserved path is not a regular file".to_owned());
    }
    let quarantine = parent.join(format!(".{name}.{}.delete", Uuid::new_v4()));
    fs::rename(path, &quarantine)
        .map_err(|error| format!("cannot quarantine preserved file: {error}"))?;
    let outcome = (|| {
        after_quarantine(&quarantine)?;
        let mut file = fs::File::open(&quarantine)
            .map_err(|error| format!("cannot open quarantined file: {error}"))?;
        let mut hash = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        let mut total = 0_usize;
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("cannot hash quarantined file: {error}"))?;
            if read == 0 {
                break;
            }
            total = total.saturating_add(read);
            if total > MAX_ARCHIVE_BYTES {
                return Err("quarantined file exceeds the archive limit".to_owned());
            }
            hash.update(&buffer[..read]);
        }
        let actual = format!("{:x}", hash.finalize());
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            return Err("quarantined file hash does not match; nothing was deleted".to_owned());
        }
        fs::remove_file(&quarantine)
            .map_err(|error| format!("cannot remove quarantined file: {error}"))
    })();
    if outcome.is_err() && quarantine.exists() && !path.exists() {
        let _ = fs::rename(&quarantine, path);
    }
    outcome
}

#[tauri::command]
pub async fn external_remove_if_hash_matches(
    path: String,
    expected_sha256: String,
) -> Result<(), String> {
    let path = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || {
        remove_if_hash_matches_with_hook(&path, &expected_sha256, |_| Ok(()))
    })
    .await
    .map_err(|error| format!("external file worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn installs_a_sibling_without_replacing_an_existing_destination() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let temporary = root.path().join("Library.tesina.123.tmp");
        fs::write(&temporary, b"new").unwrap();
        atomic_rename_no_replace(&temporary, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        assert!(!temporary.exists());

        let second = root.path().join("Library.tesina.456.tmp");
        fs::write(&second, b"other").unwrap();
        atomic_rename_no_replace(&second, &destination)
            .expect_err("an existing destination must never be replaced");
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        assert_eq!(fs::read(&second).unwrap(), b"other");
    }

    #[test]
    fn rejects_non_sibling_or_non_temporary_sources() {
        let root = TempDir::new().unwrap();
        let other = TempDir::new().unwrap();
        let destination = root.path().join("Library.tesina");
        let outside = other.path().join("Library.tesina.123.tmp");
        fs::write(&outside, b"new").unwrap();
        assert!(atomic_rename_no_replace(&outside, &destination).is_err());

        let wrong_name = root.path().join("unrelated.tmp");
        fs::write(&wrong_name, b"new").unwrap();
        assert!(atomic_rename_no_replace(&wrong_name, &destination).is_err());
    }

    #[test]
    fn exclusive_copy_fallback_installs_without_replacing() {
        let root = TempDir::new().unwrap();
        let source = root.path().join("Library.tesina.123.tmp");
        let destination = root.path().join("Library.tesina");
        fs::write(&source, b"new").unwrap();

        copy_no_replace(&source, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        assert!(source.exists());
        assert!(copy_no_replace(&source, &destination).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"new");
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
        let path = root.path().join("Library.tesina.123.prev");
        fs::write(&path, b"previous").unwrap();
        let expected = format!("{:x}", Sha256::digest(b"previous"));

        remove_if_hash_matches_with_hook(&path, &expected, |_| {
            fs::write(&path, b"new synced bytes")
                .map_err(|error| format!("cannot write race fixture: {error}"))
        })
        .unwrap();

        assert_eq!(fs::read(path).unwrap(), b"new synced bytes");
    }
}
