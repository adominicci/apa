//! Drives the real `export_pdf` command end to end — Tauri window creation,
//! the `tesina-print://` protocol load, the `tesina-print-ready://` navigation
//! handshake, the silent print, the settle loop, and the temp-then-rename
//! write — with no UI interaction.
//!
//! This is the step-6 native proof the design document calls for, and the
//! harness that reproduced the first live failure. The spike host proved the
//! print pipeline in raw tao/wry; everything Tauri adds on top is exactly what
//! it could not cover.

#[cfg(target_os = "macos")]
fn main() {
    let destination = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/tesina-live-proof.pdf".into());
    let _ = std::fs::remove_file(&destination);

    // Three explicit page boxes, as paginateForPrint emits: already laid out,
    // no scripts of their own, one box per sheet.
    let html = r##"<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: 8.5in 11in; margin: 0; }
  html, body { margin: 0; padding: 0; }
  .page { width: 8.5in; height: 11in; box-sizing: border-box; padding: 1in;
          font: 12pt "Times New Roman", serif; break-after: page; overflow: hidden; }
  .page:last-child { break-after: auto; }
</style></head><body>
  <div class="page"><h1>Live proof one</h1></div>
  <div class="page"><h1>Live proof two</h1></div>
  <div class="page"><h1>Live proof three</h1></div>
</body></html>"##;

    tesina_lib::pdf_export::attach_print_protocol(tauri::Builder::default())
        .setup(move |app| {
            let handle = app.handle().clone();
            let destination = destination.clone();
            tauri::async_runtime::spawn(async move {
                let result = tesina_lib::pdf_export::export_pdf(
                    handle.clone(),
                    html.to_string(),
                    destination.clone(),
                    3,
                    612.0,
                    792.0,
                )
                .await;
                let size = std::fs::metadata(&destination)
                    .map(|meta| meta.len())
                    .unwrap_or(0);
                println!(
                    "{}",
                    serde_json::json!({
                        "result": match &result {
                            Ok(pages) => serde_json::json!({ "ok": true, "pages": pages }),
                            Err(error) => serde_json::json!({ "ok": false, "error": format!("{error:?}") }),
                        },
                        "bytes": size,
                        "path": destination,
                    })
                );
                handle.exit(if result.is_ok() { 0 } else { 1 });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("live proof app failed to start");
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("pdf-export-live-proof is available only on macOS");
    std::process::exit(1);
}
