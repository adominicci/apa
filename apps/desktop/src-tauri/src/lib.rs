mod backup_directory;
mod external_files;
#[cfg(feature = "packaged-backup-smoke")]
mod packaged_backup_smoke;
pub mod spelling;
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
                let _ = window.show();
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
            let app_cache_dir = app.path().app_cache_dir()?;
            app.manage(backup_directory::BackupDirectoryCore::new(
                app_data_dir,
                app_cache_dir,
            )?);
            app.manage(external_files::ExternalSaveAuthorizations::default());
            app.manage(spelling::SpellingState::new(app.handle().clone()));
            #[cfg(feature = "packaged-backup-smoke")]
            app.manage(packaged_backup_smoke::PackagedBackupSmokeState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backup_directory::backup_pick_and_begin_configuration,
            backup_directory::backup_write_test_archive,
            backup_directory::backup_activate_configuration,
            backup_directory::backup_cancel_configuration,
            backup_directory::backup_write_archive,
            backup_directory::backup_confirm_archive,
            backup_directory::backup_discard_pending_archive,
            backup_directory::backup_read_archive,
            backup_directory::backup_read_test_archive,
            backup_directory::backup_list_archives,
            backup_directory::backup_list_archive_names,
            backup_directory::backup_remove_archive,
            backup_directory::backup_ledger_entries,
            backup_directory::backup_status,
            backup_directory::backup_cancel_current_operations,
            backup_directory::backup_disable,
            external_files::external_pick_save_destination,
            external_files::external_finish_save_authorization,
            external_files::external_destination_exists,
            external_files::external_read_destination,
            external_files::external_hash_destination,
            external_files::external_write_temp,
            external_files::external_read_temp,
            external_files::external_related_exists,
            external_files::external_hash_previous,
            external_files::external_preserve_destination,
            external_files::external_rename_no_replace,
            external_files::external_remove_temp,
            external_files::external_remove_if_hash_matches,
            #[cfg(feature = "packaged-backup-smoke")]
            packaged_backup_smoke::packaged_backup_smoke_context,
            #[cfg(feature = "packaged-backup-smoke")]
            packaged_backup_smoke::packaged_backup_smoke_seed_transient_scope,
            #[cfg(feature = "packaged-backup-smoke")]
            packaged_backup_smoke::packaged_backup_smoke_picker_call_count,
            pdf_export::export_pdf,
            spelling::spelling_capability,
            spelling::spelling_check,
            spelling::spelling_cancel,
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

#[cfg(all(test, not(feature = "packaged-backup-smoke")))]
mod tests {
    #[test]
    fn packaged_backup_smoke_symbols_are_feature_gated_out_of_default_builds() {
        let source = include_str!("lib.rs");
        let production = source.split("#[cfg(all(test").next().unwrap();
        for symbol in [
            "mod packaged_backup_smoke;",
            "app.manage(packaged_backup_smoke::PackagedBackupSmokeState::default());",
            "packaged_backup_smoke::packaged_backup_smoke_context,",
            "packaged_backup_smoke::packaged_backup_smoke_seed_transient_scope,",
            "packaged_backup_smoke::packaged_backup_smoke_picker_call_count,",
        ] {
            let offset = production
                .find(symbol)
                .unwrap_or_else(|| panic!("missing feature-only integration for {symbol}"));
            let preceding_line = production[..offset]
                .lines()
                .rev()
                .find(|line| !line.trim().is_empty())
                .unwrap();
            assert_eq!(
                preceding_line.trim(),
                "#[cfg(feature = \"packaged-backup-smoke\")]",
                "{symbol} must be immediately feature-gated"
            );
        }
    }
}
