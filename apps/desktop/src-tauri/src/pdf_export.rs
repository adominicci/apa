//! Silent PDF rendering for the export path.
//!
//! Receives a **static**, already-paginated document from the webview (Paged.js
//! runs in the main window; see `paginateForPrint.ts`), loads it into a hidden
//! webview, prints it to a temp file, and moves that file into place.
//!
//! Three rules here are not style preferences, they were paid for in
//! `examples/macos-pdf-proof-host.rs` and `examples/pdf-export-live-proof.rs`:
//!
//! 1. **Never run the print operation synchronously from the event loop.** It
//!    paginates without terminating; the proof host wrote 3.65 GB before it was
//!    killed. `runOperationModalForWindow:` with `setCanSpawnSeparateThread`
//!    lets the run loop pump, which is what wry's own printing does.
//! 2. **Always cap the output.** A runaway print does not merely fail, it fills
//!    the user's disk.
//! 3. **Never load `about:blank` and inject with `eval`.** A Tauri window
//!    pointed at `about:blank` never commits a document on macOS — no page, no
//!    JS context, so eval'd scripts silently do nothing and every readiness
//!    deadline expires (`on_navigation` records zero events, not even the
//!    initial load). The document is served through the `tesina-print` custom
//!    protocol instead, with the readiness probe baked into the served HTML.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Runtime, WebviewUrl, WebviewWindowBuilder};

/// A correct student paper is well under this. Anything past it is a
/// pagination loop, not a document.
const PDF_SIZE_CAP_BYTES: u64 = 64 * 1024 * 1024;
/// Bounds the whole render. Exceeding it is a handled error, never a hang.
const RENDER_DEADLINE: Duration = Duration::from_secs(120);
/// Bounds the wait for the readiness handshake; generous enough to parse and
/// decode a long document with inlined figures on a slow machine.
const READY_DEADLINE: Duration = Duration::from_secs(30);
/// How long the output must stop growing before it counts as finished.
const STABLE_POLLS: u32 = 4;
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Shown wherever PDF export is asked for off macOS; the print pipeline this
/// module drives is Cocoa-only.
const UNSUPPORTED_PLATFORM: &str = "PDF export is available only on macOS";

/// The private scheme the readiness probe navigates to. The hidden window has
/// no IPC capability, so readiness arrives as a cancelled navigation instead.
const READY_SCHEME: &str = "tesina-print-ready";

/// Signals readiness once fonts and images have settled. rAF and
/// `document.fonts.ready` are each raced against a timer because both can
/// stall in a hidden window — the proof host measured exactly that stall.
const READY_PROBE: &str = r#"(function () {
  var signalled = false;
  function signal() {
    if (signalled) return;
    signalled = true;
    location.href = "tesina-print-ready://done";
  }
  function settle() {
    requestAnimationFrame(function () { requestAnimationFrame(signal); });
    setTimeout(signal, 400);
  }
  var assets = [];
  if (document.fonts && document.fonts.ready) assets.push(document.fonts.ready);
  if (document.images.length) {
    assets.push(Promise.all(Array.prototype.map.call(document.images, function (image) {
      return image.decode().catch(function () {});
    })));
  }
  Promise.all(assets).then(settle, settle);
  setTimeout(settle, 1500);
})();"#;

/// Distinguishes back-to-back exports: window destruction is asynchronous, so
/// reusing one label or temp name would make the next export trip over the
/// previous one.
static EXPORT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Documents awaiting pickup by the `tesina-print` protocol, keyed by export
/// sequence. An entry lives exactly as long as its export: registered before
/// the hidden window is built, removed by `DocumentLease::drop` on every path.
static PENDING_DOCUMENTS: OnceLock<Mutex<HashMap<u64, String>>> = OnceLock::new();

fn pending_documents() -> &'static Mutex<HashMap<u64, String>> {
    PENDING_DOCUMENTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Removes the served document when the export ends, however it ends.
struct DocumentLease(u64);

impl Drop for DocumentLease {
    fn drop(&mut self) {
        pending_documents().lock().unwrap().remove(&self.0);
    }
}

/// Serves `tesina-print://export/<sequence>` from the pending-document map.
///
/// Registered on the app builder in `lib.rs` (and by the live proof example);
/// custom protocols can only be attached at build time, not per window.
pub fn attach_print_protocol<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_uri_scheme_protocol("tesina-print", |_context, request| {
        let sequence = request
            .uri()
            .path()
            .trim_start_matches('/')
            .parse::<u64>()
            .ok();
        let document =
            sequence.and_then(|key| pending_documents().lock().unwrap().get(&key).cloned());
        match document {
            Some(html) => tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .body(html.into_bytes())
                .unwrap(),
            None => tauri::http::Response::builder()
                .status(404)
                .body(Vec::new())
                .unwrap(),
        }
    })
}

/// The served document: the paginated HTML with the readiness probe appended.
/// Appended rather than spliced into `</body>` — the parser hoists a trailing
/// script into the body, and not depending on the exact closing tags keeps
/// this robust against whatever `paginateForPrint` emits.
fn printable_document(html: &str) -> String {
    format!("{html}<script>{READY_PROBE}</script>")
}

#[derive(Debug, Serialize)]
// Serialized as the bare message so the frontend's `String(err)` reads it,
// matching the `Result<_, String>` convention of the other commands.
#[serde(transparent)]
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

/// Destroys the hidden window when dropped, so no path — error, timeout, or
/// panic — leaks an invisible webview for the rest of the session.
struct HiddenWindow(tauri::WebviewWindow);

impl Drop for HiddenWindow {
    fn drop(&mut self) {
        let _ = self.0.destroy();
    }
}

/// Temp file beside the destination, never in the system temp directory: a
/// rename is only an atomic replace within one filesystem, and a student's
/// folder can easily live on an external drive or a network share.
fn temp_path_beside(destination: &Path, sequence: u64) -> Result<PathBuf, PdfExportError> {
    let directory = destination
        .parent()
        .ok_or_else(|| PdfExportError::new("destination has no parent directory"))?;
    let stem = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    Ok(directory.join(format!(
        ".tesina-export-{stem}-{}-{sequence}.pdf",
        std::process::id()
    )))
}

/// Counts occurrences of `token` that are not merely a prefix of a longer
/// name, so `/Type /Page` matches neither `/Type /Pages` nor
/// `/Type /PageLabels`.
fn count_token(text: &str, token: &str) -> usize {
    let mut count = 0;
    let mut rest = text;
    while let Some(position) = rest.find(token) {
        rest = &rest[position + token.len()..];
        let next_is_letter = rest
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic());
        if !next_is_letter {
            count += 1;
        }
    }
    count
}

/// Counts `/Type /Page` objects, ignoring the `/Pages` tree node.
fn pdf_page_count(bytes: &[u8]) -> usize {
    let text = String::from_utf8_lossy(bytes);
    count_token(&text, "/Type /Page") + count_token(&text, "/Type/Page")
}

/// A PDF is written front-to-back and the `%%EOF` trailer is the last thing
/// the writer emits, so a file without it is still mid-write no matter how
/// long its size has held steady.
fn looks_complete(bytes: &[u8]) -> bool {
    let tail = &bytes[bytes.len().saturating_sub(64)..];
    bytes.starts_with(b"%PDF") && tail.windows(5).any(|window| window == b"%%EOF")
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPaperOrientation, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSURL};
    use objc2_web_kit::WKWebView;

    /// Configures the print job so the CSS page boxes own the layout. Every
    /// value exists to stop AppKit from quietly re-laying-out the page:
    /// non-zero margins inset the CSS margins a second time, centering shifts
    /// an already-positioned box, and any scale factor but 1.0 breaks 12 pt.
    fn print_info(destination: &Path, paper: NSSize) -> Retained<NSPrintInfo> {
        unsafe {
            // A fresh instance, not `sharedPrintInfo`: that singleton is
            // process-wide, and mutating it would leak this job's geometry into
            // every later print.
            let info = NSPrintInfo::new();
            // The paper must agree with the document's `@page` rule; the
            // default here follows the user's locale and can silently be A4.
            info.setPaperSize(paper);
            info.setOrientation(NSPaperOrientation::Portrait);
            info.setTopMargin(0.0);
            info.setBottomMargin(0.0);
            info.setLeftMargin(0.0);
            info.setRightMargin(0.0);
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
    pub fn start_print(
        webview_ptr: *mut std::ffi::c_void,
        destination: &Path,
        paper: (f64, f64),
    ) -> Result<(), String> {
        if webview_ptr.is_null() {
            return Err("the platform webview was unavailable".into());
        }
        let paper = NSSize {
            width: paper.0,
            height: paper.1,
        };
        unsafe {
            let webview: &WKWebView = &*(webview_ptr as *const WKWebView);
            // Pin the view to the paper box in points before printing.
            // WKWebView paginates against its own frame; leaving it at the
            // window's pixel size mixes 96 dpi CSS pixels with 72 dpi print
            // points and skews every page break (measured in the proof host).
            webview.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), paper));
            let info = print_info(destination, paper);
            let operation = webview.printOperationWithPrintInfo(&info);
            operation.setShowsPrintPanel(false);
            operation.setShowsProgressPanel(false);
            // The line the spike was written to find. A blocking `runOperation`
            // here never terminates.
            operation.setCanSpawnSeparateThread(true);
            let Some(window) = webview.window() else {
                return Err("the hidden window disappeared before printing".into());
            };
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                &window,
                None,
                None,
                std::ptr::null_mut(),
            );
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;
    pub fn start_print(
        _webview_ptr: *mut std::ffi::c_void,
        _destination: &Path,
        _paper: (f64, f64),
    ) -> Result<(), String> {
        Ok(())
    }
}

/// Renders `html` to a PDF at `destination`.
///
/// `expected_pages` is what Paged.js laid out in the visible webview. A
/// mismatch means the print pipeline disagreed with the preview, which is
/// exactly the divergence a student would not catch on their own.
/// `paper_*_pt` carry the document's paper size in points; the command stays
/// ignorant of what a paper size means to APA.
#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    html: String,
    destination: String,
    expected_pages: usize,
    paper_width_pt: f64,
    paper_height_pt: f64,
) -> Result<usize, PdfExportError> {
    if cfg!(not(target_os = "macos")) {
        return Err(PdfExportError::new(UNSUPPORTED_PLATFORM));
    }
    // A degenerate paper box would hand the print pipeline an impossible
    // geometry — the exact family of input the runaway spike came from.
    if !(paper_width_pt.is_finite() && paper_height_pt.is_finite())
        || paper_width_pt <= 0.0
        || paper_height_pt <= 0.0
    {
        return Err(PdfExportError::new("invalid paper size"));
    }

    let sequence = EXPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let destination = PathBuf::from(destination);
    let temp = temp_path_beside(&destination, sequence)?;
    let _ = fs::remove_file(&temp);

    // Registered before the window exists so the protocol can answer the
    // window's very first request; the lease removes it on every exit path.
    pending_documents()
        .lock()
        .unwrap()
        .insert(sequence, printable_document(&html));
    let _lease = DocumentLease(sequence);

    let label = format!("pdf-render-{sequence}");
    let document_url = format!("tesina-print://export/{sequence}")
        .parse()
        .map_err(|error| PdfExportError::new(format!("print url did not parse: {error}")))?;
    let (ready_tx, mut ready_rx) = tokio::sync::mpsc::channel::<()>(1);
    // Hidden, exactly as the proof host ran: it showed a hidden window does
    // lay out and print. The document arrives as a real page load through the
    // custom protocol — rule 3 in the module header is why nothing here goes
    // near about:blank or eval.
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(document_url))
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .inner_size(paper_width_pt * 96.0 / 72.0, paper_height_pt * 96.0 / 72.0)
        .on_navigation(move |url| {
            if url.scheme() == READY_SCHEME {
                let _ = ready_tx.try_send(());
                return false;
            }
            true
        })
        .build()
        .map_err(|error| PdfExportError::new(format!("hidden webview failed: {error}")))?;
    let window = HiddenWindow(window);

    let result = render(
        &window.0,
        &temp,
        expected_pages,
        (paper_width_pt, paper_height_pt),
        &mut ready_rx,
    )
    .await;

    drop(window);
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
    temp: &Path,
    expected_pages: usize,
    paper: (f64, f64),
    ready: &mut tokio::sync::mpsc::Receiver<()>,
) -> Result<usize, PdfExportError> {
    // The document and its probe arrived with the page load; readiness is
    // fonts plus decoded images, reported through the navigation handshake.
    // Waiting a fixed interval instead would race a slow parse of a long
    // document with inlined figures.
    if tokio::time::timeout(READY_DEADLINE, ready.recv())
        .await
        .is_err()
    {
        return Err(PdfExportError::new(
            "the document never became ready to print",
        ));
    }

    // A failure inside the main-thread print closure lands in this slot;
    // `settle` reads it so a print that never started errors immediately
    // instead of waiting out the whole deadline.
    let print_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let slot = Arc::clone(&print_error);
    let target = temp.to_path_buf();
    window
        .with_webview(move |platform_webview| {
            // `PlatformWebview::inner` exists on macOS and Linux only; Windows
            // exposes `controller()` instead, so this call cannot be written
            // once for every target. Gating it here rather than inside
            // `platform` keeps the non-macOS build honest.
            #[cfg(target_os = "macos")]
            if let Err(message) = platform::start_print(platform_webview.inner(), &target, paper) {
                *slot.lock().unwrap() = Some(message);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (&platform_webview, &target, paper);
                *slot.lock().unwrap() = Some(UNSUPPORTED_PLATFORM.to_string());
            }
        })
        .map_err(|error| PdfExportError::new(format!("could not reach the webview: {error}")))?;

    settle(temp, expected_pages, &print_error).await
}

/// Waits for the output to stop growing, bounded by both a size cap and a
/// deadline so no failure mode can leave the UI waiting forever.
async fn settle(
    temp: &Path,
    expected_pages: usize,
    print_error: &Mutex<Option<String>>,
) -> Result<usize, PdfExportError> {
    let mut last = 0u64;
    let mut stable = 0u32;
    let polls = (RENDER_DEADLINE.as_millis() / POLL_INTERVAL.as_millis()) as u32;

    for _ in 0..polls {
        tokio::time::sleep(POLL_INTERVAL).await;
        if let Some(message) = print_error.lock().unwrap().take() {
            return Err(PdfExportError::new(message));
        }
        let size = fs::metadata(temp).map(|meta| meta.len()).unwrap_or(0);
        if size > PDF_SIZE_CAP_BYTES {
            // Deliberately worded as abandonment, not cancellation. Cocoa
            // offers no way to abort a running NSPrintOperation, so the
            // operation may still be writing to the unlinked inode until it
            // finishes on its own. What this guarantees is bounded: the export
            // fails, the temp name is removed, the destination is untouched,
            // and the hidden window is destroyed, which takes the print source
            // away. Claiming the print itself was stopped would be a lie.
            return Err(PdfExportError::new(
                "the PDF grew past its size limit, so the export was abandoned",
            ));
        }
        if size > 0 && size == last {
            stable += 1;
            if stable >= STABLE_POLLS {
                let bytes = fs::read(temp).map_err(|error| {
                    PdfExportError::new(format!("could not read the PDF: {error}"))
                })?;
                if !looks_complete(&bytes) {
                    // A pause is not completion; without the trailer the
                    // writer is still going, so keep waiting.
                    stable = 0;
                } else {
                    // The count is a byte scan for `/Type /Page`, which only
                    // works while page dictionaries sit uncompressed in the
                    // file. Every macOS build measured so far emits them that
                    // way (the live proof asserts it), but a future one could
                    // pack them into an ObjStm and the scan would read zero.
                    //
                    // So zero is treated as "cannot tell", not as "empty": the
                    // file already passed the %PDF/%%EOF structural check
                    // above, and refusing to save a perfectly good paper over
                    // an unreadable counter would be the worse failure. Only a
                    // confident disagreement is an error.
                    let pages = pdf_page_count(&bytes);
                    if pages > 0 && expected_pages > 0 && pages != expected_pages {
                        return Err(PdfExportError::new(format!(
                            "the PDF has {pages} pages but the preview laid out {expected_pages}"
                        )));
                    }
                    return Ok(if pages > 0 { pages } else { expected_pages });
                }
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
    fn ignores_page_label_dictionaries() {
        assert_eq!(pdf_page_count(b"/Type /PageLabels /Type /Page"), 1);
    }

    #[test]
    fn reports_no_pages_for_an_empty_file() {
        assert_eq!(pdf_page_count(b""), 0);
    }

    #[test]
    fn accepts_only_a_pdf_with_its_trailer() {
        assert!(looks_complete(b"%PDF-1.4 body %%EOF\n"));
        assert!(!looks_complete(b"%PDF-1.4 still being written"));
        assert!(!looks_complete(b"not a pdf %%EOF"));
        assert!(!looks_complete(b""));
    }

    #[test]
    fn places_the_temp_file_beside_the_destination() {
        let temp = temp_path_beside(Path::new("/Volumes/Stick/Paper.pdf"), 7).unwrap();
        assert_eq!(temp.parent().unwrap(), Path::new("/Volumes/Stick"));
        assert!(temp
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(".tesina-export-Paper-"));
    }

    #[test]
    fn distinct_exports_get_distinct_temp_files() {
        let destination = Path::new("/Volumes/Stick/Paper.pdf");
        assert_ne!(
            temp_path_beside(destination, 1).unwrap(),
            temp_path_beside(destination, 2).unwrap(),
        );
    }

    #[test]
    fn rejects_a_destination_without_a_parent() {
        assert!(temp_path_beside(Path::new("/"), 0).is_err());
    }

    #[test]
    fn served_document_carries_the_readiness_probe() {
        let served = printable_document("<html><body>paper</body></html>");
        assert!(served.starts_with("<html><body>paper</body></html>"));
        assert!(served.contains(READY_SCHEME));
        assert!(served.contains("document.fonts"));
    }

    #[test]
    fn document_lease_removes_its_entry_on_drop() {
        pending_documents()
            .lock()
            .unwrap()
            .insert(u64::MAX, "doc".into());
        drop(DocumentLease(u64::MAX));
        assert!(!pending_documents().lock().unwrap().contains_key(&u64::MAX));
    }
}
