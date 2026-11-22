//! Finds the Google Drive for desktop folder, so a Windows PC (or a Mac) can keep Daybar's data in
//! Google Drive and share it with other computers. It only looks for the folder when asked (the
//! Settings button), and creates nothing but an empty `Daybar` folder inside "My Drive".
//!
//! Google Drive for desktop puts "My Drive" on a virtual drive (`G:` unless taken) when it streams
//! files, or under the home folder when it mirrors them. On a Mac it lives in
//! `~/Library/CloudStorage/GoogleDrive-<account>/My Drive`.
use std::path::{Path, PathBuf};

/// The folder inside "My Drive" that Daybar suggests.
pub const FOLDER: &str = "Daybar";

/// Where "My Drive" may be, most likely first.
pub fn candidates(home: &Path, cloud_storage: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(windows) {
        // Streaming: a drive letter, G: by default, else the next free one Google picked.
        for letter in std::iter::once('G').chain(('D'..='Z').filter(|l| *l != 'G')) {
            out.push(PathBuf::from(format!("{letter}:\\My Drive")));
        }
        // Mirroring: inside the user folder.
        out.push(home.join("My Drive"));
        out.push(home.join("Google Drive").join("My Drive"));
        out.push(home.join("Google Drive"));
    } else {
        out.extend(cloud_storage.iter().map(|d| d.join("My Drive")));
        out.push(home.join("Google Drive").join("My Drive"));
        out.push(home.join("Google Drive"));
    }
    out
}

/// The first candidate that is a folder.
pub fn find(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_dir()).cloned()
}

fn home() -> Option<PathBuf> {
    ["HOME", "USERPROFILE"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .find(|h| !h.as_os_str().is_empty())
}

/// `~/Library/CloudStorage/GoogleDrive-*` folders (macOS), sorted for a stable choice.
fn cloud_storage(home: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(home.join("Library").join("CloudStorage"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("GoogleDrive-"))
        .map(|e| e.path())
        .collect();
    found.sort();
    found
}

/// Tauri command: the path of `My Drive/Daybar`, creating the `Daybar` folder if it is missing.
/// Fails with a readable message when Google Drive for desktop is not found.
#[tauri::command]
pub async fn google_drive_folder() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = home().ok_or("Could not find your home folder.")?;
        let my_drive = find(&candidates(&home, &cloud_storage(&home))).ok_or(
            "Google Drive for desktop was not found. Install it from google.com/drive/download, sign in, then try again, or type the folder path.",
        )?;
        let folder = my_drive.join(FOLDER);
        crate::store::no_symlinks(&folder)?;
        std::fs::create_dir_all(&folder)
            .map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
        Ok(folder.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_first_existing_my_drive() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let account = home.join("Library/CloudStorage/GoogleDrive-me@example.com");
        let list = candidates(home, &[account.clone()]);
        assert_eq!(find(&list), None);
        std::fs::create_dir_all(home.join("Google Drive")).unwrap();
        assert_eq!(find(&list), Some(home.join("Google Drive")));
        let mirrored = if cfg!(windows) {
            home.join("My Drive")
        } else {
            account.join("My Drive")
        };
        std::fs::create_dir_all(&mirrored).unwrap();
        assert_eq!(find(&list), Some(mirrored));
        if cfg!(windows) {
            assert_eq!(list[0], PathBuf::from("G:\\My Drive"));
        } else {
            assert_eq!(cloud_storage(home), vec![account]);
        }
    }
}
