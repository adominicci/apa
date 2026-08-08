mod backup_directory;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            backup_directory::backup_read_archive,
            backup_directory::backup_list_archives,
            backup_directory::backup_remove_archive,
            backup_directory::backup_ledger_entries,
            backup_directory::backup_status,
            backup_directory::backup_disable,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
