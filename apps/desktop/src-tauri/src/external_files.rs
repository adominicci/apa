use std::fs;
use std::path::{Path, PathBuf};

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
    fs::hard_link(from, to)
        .map_err(|error| format!("cannot install destination exclusively: {error}"))?;
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
}
