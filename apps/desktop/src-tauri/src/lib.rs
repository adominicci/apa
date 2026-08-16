mod backup_directory;
mod external_files;
// Public so the live proof example can drive the real command end to end.
pub mod pdf_export;

use tauri::Manager;

/// The frontend needs the host operating system to follow its close
/// convention: on macOS the close button hides the window and leaves the app
/// in the Dock, everywhere else it quits. Returned from here rather than
/// sniffed from the user agent, and without pulling in another plugin.
#[tauri::command]
fn host_os() -> &'static str {
    std::env::consts::OS
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The print protocol serves each PDF export's paginated document to its
    // hidden render window; protocols can only be registered at build time.
    pdf_export::attach_print_protocol(tauri::Builder::default())
        // Cross-process exclusion (design §12): every safety mechanism —
        // snapshot lease, import journal, single-flight backup, ledger,
        // startup recovery — is process-local, so a second instance must
        // never run. It must register before every other plugin so a second
        // launch exits before touching any state; the first instance's main
        // window is focused instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            app.manage(backup_directory::BackupDirectoryCore::new(app_data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backup_directory::backup_begin_configuration,
            backup_directory::backup_write_test_archive,
            backup_directory::backup_activate_configuration,
            backup_directory::backup_cancel_configuration,
            backup_directory::backup_write_archive,
            backup_directory::backup_confirm_archive,
            backup_directory::backup_read_archive,
            backup_directory::backup_read_test_archive,
            backup_directory::backup_list_archives,
            backup_directory::backup_remove_archive,
            backup_directory::backup_ledger_entries,
            backup_directory::backup_status,
            backup_directory::backup_disable,
            external_files::external_rename_no_replace,
            external_files::external_remove_if_hash_matches,
            pdf_export::export_pdf,
            host_os,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // The macOS close button hides the main window instead of
            // destroying it, so the app stays in the Dock with no window on
            // screen. Clicking the Dock icon has to bring it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = _event
            {
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
