//! Silent PDF rendering for the export path.
//!
//! Receives a **static**, already-paginated document from the webview (Paged.js
//! runs in the main window; see `paginateForPrint.ts`), loads it into a hidden
//! webview, prints it to a temp file, and moves that file into place.
//!
//! Two rules here are not style preferences, they were paid for in
//! `examples/macos-pdf-proof-host.rs`:
//!
//! 1. **Never run the print operation synchronously from the event loop.** It
//!    paginates without terminating; the proof host wrote 3.65 GB before it was
//!    killed. `runOperationModalForWindow:` with `setCanSpawnSeparateThread`
//!    lets the run loop pump, which is what wry's own printing does.
//! 2. **Always cap the output.** A runaway print does not merely fail, it fills
//!    the user's disk.

use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

/// A correct student paper is well under this. Anything past it is a
/// pagination loop, not a document.
const PDF_SIZE_CAP_BYTES: u64 = 64 * 1024 * 1024;
/// Bounds the whole render. Exceeding it is a handled error, never a hang.
const RENDER_DEADLINE: Duration = Duration::from_secs(120);
/// How long the output must stop growing before it counts as finished.
const STABLE_POLLS: u32 = 4;
const POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Serialize)]
pub struct PdfExportError {
    message: String,
}

impl PdfExportError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl From<String> for PdfExportError {
    fn from(message: String) -> Self {
        Self::new(message)
    }
}

/// Temp file beside the destination, never in the system temp directory: a
/// rename is only an atomic replace within one filesystem, and a student's
/// folder can easily live on an external drive or a network share.
fn temp_path_beside(destination: &Path) -> Result<PathBuf, PdfExportError> {
    let directory = destination
        .parent()
        .ok_or_else(|| PdfExportError::new("destination has no parent directory"))?;
    let stem = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    Ok(directory.join(format!(".tesina-export-{stem}-{}.pdf", std::process::id())))
}

/// Counts `/Type /Page` objects, ignoring the `/Pages` tree node.
fn pdf_page_count(bytes: &[u8]) -> usize {
    let text = String::from_utf8_lossy(bytes);
    let pages = text.matches("/Type /Page").count() + text.matches("/Type/Page").count();
    let trees = text.matches("/Type /Pages").count() + text.matches("/Type/Pages").count();
    pages.saturating_sub(trees)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::{NSString, NSURL};
    use objc2_web_kit::WKWebView;

    fn print_info(destination: &Path) -> Retained<NSPrintInfo> {
        unsafe {
            // A fresh instance, not `sharedPrintInfo`: that singleton is
            // process-wide, and mutating it would leak this job's geometry into
            // every later print.
            let info = NSPrintInfo::new();
            info.setHorizontallyCentered(false);
            info.setVerticallyCentered(false);
            info.setScalingFactor(1.0);
            info.setJobDisposition(NSPrintSaveJob);
            let url = NSURL::fileURLWithPath(&NSString::from_str(&destination.to_string_lossy()));
            info.dictionary()
                .setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));
            info
        }
    }

    /// Starts the print and returns immediately. The operation completes on the
    /// main run loop; the caller settles by watching the output file.
    pub fn start_print(webview_ptr: *mut std::ffi::c_void, destination: &Path) {
        if webview_ptr.is_null() {
            return;
        }
        unsafe {
            let webview: &WKWebView = &*(webview_ptr as *const WKWebView);
            let info = print_info(destination);
            let operation = webview.printOperationWithPrintInfo(&info);
            operation.setShowsPrintPanel(false);
            operation.setShowsProgressPanel(false);
            // The line the spike was written to find. A blocking `runOperation`
            // here never terminates.
            operation.setCanSpawnSeparateThread(true);
            if let Some(window) = webview.window() {
                operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                    &window,
                    None,
                    None,
                    std::ptr::null_mut(),
                );
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;
    pub fn start_print(_webview_ptr: *mut std::ffi::c_void, _destination: &Path) {}
}

/// Renders `html` to a PDF at `destination`.
///
/// `expected_pages` is what Paged.js laid out in the visible webview. A
/// mismatch means the print pipeline disagreed with the preview, which is
/// exactly the divergence a student would not catch on their own.
#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    html: String,
    destination: String,
    expected_pages: usize,
) -> Result<usize, PdfExportError> {
    if cfg!(not(target_os = "macos")) {
        return Err(PdfExportError::new("PDF export is available only on macOS"));
    }

    let destination = PathBuf::from(destination);
    let temp = temp_path_beside(&destination)?;
    let _ = fs::remove_file(&temp);

    let label = format!("pdf-render-{}", std::process::id());
    // Off-screen rather than merely hidden: a window that is never shown may not
    // lay out at all, and the proof host showed that off-screen rendering does.
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .inner_size(816.0, 1056.0)
        .build()
        .map_err(|error| PdfExportError::new(format!("hidden webview failed: {error}")))?;

    let result = render(&window, &html, &temp, expected_pages).await;

    let _ = window.close();
    match result {
        Ok(pages) => {
            fs::rename(&temp, &destination).map_err(|error| {
                let _ = fs::remove_file(&temp);
                PdfExportError::new(format!("could not save the PDF: {error}"))
            })?;
            Ok(pages)
        }
        Err(error) => {
            // Every failure path removes the temp file and leaves any existing
            // file at the destination untouched.
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}

async fn render(
    window: &tauri::WebviewWindow,
    html: &str,
    temp: &Path,
    expected_pages: usize,
) -> Result<usize, PdfExportError> {
    let document = serde_json::to_string(html)
        .map_err(|error| PdfExportError::new(format!("could not encode the document: {error}")))?;
    // `document.write` rather than a data URL: a whole paper with inlined
    // figures overruns practical URL limits.
    window
        .eval(&format!(
            "document.open();document.write({document});document.close();"
        ))
        .map_err(|error| PdfExportError::new(format!("could not load the document: {error}")))?;

    // Static markup, so readiness is just fonts plus a settled layout. The
    // spike measured this at well under a second even off-screen.
    tokio::time::sleep(Duration::from_millis(600)).await;

    let target = temp.to_path_buf();
    window
        .with_webview(move |platform_webview| {
            platform::start_print(platform_webview.inner(), &target);
        })
        .map_err(|error| PdfExportError::new(format!("could not reach the webview: {error}")))?;

    settle(temp, expected_pages).await
}

/// Waits for the output to stop growing, bounded by both a size cap and a
/// deadline so no failure mode can leave the UI waiting forever.
async fn settle(temp: &Path, expected_pages: usize) -> Result<usize, PdfExportError> {
    let mut last = 0u64;
    let mut stable = 0u32;
    let polls = (RENDER_DEADLINE.as_millis() / POLL_INTERVAL.as_millis()) as u32;

    for _ in 0..polls {
        tokio::time::sleep(POLL_INTERVAL).await;
        let size = fs::metadata(temp).map(|meta| meta.len()).unwrap_or(0);
        if size > PDF_SIZE_CAP_BYTES {
            return Err(PdfExportError::new(
                "the PDF grew past its size limit and was stopped",
            ));
        }
        if size > 0 && size == last {
            stable += 1;
            if stable >= STABLE_POLLS {
                let bytes = fs::read(temp).map_err(|error| {
                    PdfExportError::new(format!("could not read the PDF: {error}"))
                })?;
                let pages = pdf_page_count(&bytes);
                if pages == 0 {
                    return Err(PdfExportError::new("the PDF came out empty"));
                }
                if expected_pages > 0 && pages != expected_pages {
                    return Err(PdfExportError::new(format!(
                        "the PDF has {pages} pages but the preview laid out {expected_pages}"
                    )));
                }
                return Ok(pages);
            }
        } else {
            stable = 0;
        }
        last = size;
    }

    Err(PdfExportError::new("the PDF did not finish in time"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_pages_without_the_pages_tree_node() {
        let pdf = b"/Type /Pages /Count 2 /Type /Page x /Type /Page y";
        assert_eq!(pdf_page_count(pdf), 2);
    }

    #[test]
    fn counts_compact_page_dictionaries() {
        assert_eq!(pdf_page_count(b"/Type/Pages /Type/Page /Type/Page"), 2);
    }

    #[test]
    fn reports_no_pages_for_an_empty_file() {
        assert_eq!(pdf_page_count(b""), 0);
    }

    #[test]
    fn places_the_temp_file_beside_the_destination() {
        let temp = temp_path_beside(Path::new("/Volumes/Stick/Paper.pdf")).unwrap();
        assert_eq!(temp.parent().unwrap(), Path::new("/Volumes/Stick"));
        assert!(temp
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(".tesina-export-Paper-"));
    }

    #[test]
    fn rejects_a_destination_without_a_parent() {
        assert!(temp_path_beside(Path::new("/")).is_err());
    }
}
