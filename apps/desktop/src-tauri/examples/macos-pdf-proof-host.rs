//! Dev-only proof host for the macOS PDF export path.
//!
//! Answers step 1 of `docs/superpowers/specs/2026-08-15-pdf-export-design.md`:
//! can a WKWebView that the user never sees render a stacked page-box document
//! to a correctly paginated PDF, silently, with no print panel?
//!
//! Follows the `webview2-proof-host` precedent — a dev-only example behind a
//! feature flag that prints one JSON envelope to stdout and exits non-zero on
//! failure — so the answer is machine-checkable instead of eyeballed.
//!
//! Deliberately uses `NSPrintOperation` rather than `WKWebView.createPDF`.
//! `createPDF` snapshots the scroll rect, which collapses stacked page boxes
//! into a single enormous page; only the print pipeline honours `@page`.
//!
//! # Measured result, 2026-08-15 — the gate did NOT clear
//!
//! The handshake works: with a timer racing `requestAnimationFrame` (which is
//! suspended off-screen) a hidden webview reports ready in well under a second.
//!
//! `runOperation` then **paginates without terminating**. The first run wrote a
//! 3.65 GB PDF and was still growing when killed, which is why this host now
//! carries a size watchdog. Four candidate causes were each eliminated by
//! measurement rather than argument:
//!
//! | Hypothesis | Flag | Result |
//! | --- | --- | --- |
//! | zeroed `NSPrintInfo` margins | `--default-margins` | still runs away |
//! | stacked page-box CSS | `--simple` | still runs away |
//! | resizing the view to the paper box | `--keep-frame` | still runs away |
//! | mutating the shared `NSPrintInfo` | `--shared-info` | still runs away |
//!
//! Trivial HTML with no page CSS and an unmodified print info runs away too, so
//! the fault is in how the operation is driven, not in the document.
//!
//! The strongest remaining hypothesis is that `runOperation` is being called
//! synchronously from inside the `tao` event-loop callback, so the main run
//! loop never pumps and the operation cannot finish. Note that wry's own
//! `print_with_options` avoids exactly this: it calls
//! `runOperationModalForWindow:...` with `setCanSpawnSeparateThread(true)`
//! instead. The next attempt should defer the print onto the main queue and
//! settle through a completion delegate rather than blocking the handler.

#[cfg(target_os = "macos")]
mod host {
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPaperOrientation, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSURL};
    use serde_json::{json, Value};
    use std::{env, fs, path::PathBuf, process, thread, time::Duration};
    use tao::{
        dpi::LogicalSize,
        event::Event,
        event_loop::{ControlFlow, EventLoopBuilder},
        window::WindowBuilder,
    };
    use wry::{http::Request, WebViewBuilder, WebViewExtMacOS};

    /// Generous: the real export must survive a 50-page document on a slow
    /// machine, and this host exists partly to measure that.
    const HOST_DEADLINE: Duration = Duration::from_secs(60);

    /// US Letter at 72 dpi, the unit `NSPrintInfo` and PDF `/MediaBox` share.
    const LETTER_POINTS: NSSize = NSSize {
        width: 612.0,
        height: 792.0,
    };
    const EXPECTED_PAGES: usize = 3;

    /// A correct three-page PDF is a few kilobytes. Anything past this is a
    /// pagination loop, not a document.
    const PDF_SIZE_CAP_BYTES: u64 = 64 * 1024 * 1024;

    /// Three stacked page boxes, mimicking what Paged.js emits. Each is exactly
    /// one page tall and forced onto its own sheet, so a PDF with any page
    /// count other than three proves the print pipeline ignored the CSS.
    ///
    /// The handshake waits for fonts AND two animation frames: printing while
    /// the font is still loading lays the document out in the fallback face,
    /// which is silent and would not be caught by a page count.
    const PROOF_HTML: &str = r##"<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: 8.5in 11in; margin: 0; }
  html, body { margin: 0; padding: 0; }
  .page {
    width: 8.5in;
    height: 11in;
    box-sizing: border-box;
    padding: 1in;
    font: 12pt "Times New Roman", Times, serif;
    break-after: page;
    page-break-after: always;
    overflow: hidden;
  }
  .page:last-child { break-after: auto; page-break-after: auto; }
</style></head>
<body>
  <div class="page"><h1>Proof page one</h1><p>Stacked page box 1 of 3.</p></div>
  <div class="page"><h1>Proof page two</h1><p>Stacked page box 2 of 3.</p></div>
  <div class="page"><h1>Proof page three</h1><p>Stacked page box 3 of 3.</p></div>
<script>
  (function () {
    function post(payload) {
      try { window.ipc.postMessage(JSON.stringify(payload)); } catch (e) {}
    }
    // Any script failure must report rather than stall the host until the
    // deadline; a silent hang is the failure mode this handshake exists to
    // prevent.
    window.onerror = function (message) {
      post({ ok: false, error: "javascript error: " + message });
    };
    var sent = false;
    function ready() {
      if (sent) return;
      sent = true;
      post({ ok: true, pages: document.querySelectorAll(".page").length });
    }
    // rAF is suspended in an off-screen window, so it cannot be the only path
    // to the handshake — that is precisely why the first hidden run stalled
    // until the deadline. Race it against a timer and take whichever lands.
    function settle() {
      requestAnimationFrame(function () {
        requestAnimationFrame(ready);
      });
      setTimeout(ready, 400);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(settle).catch(function (e) {
        post({ ok: false, error: "fonts.ready rejected: " + e });
      });
      // fonts.ready itself can stall off-screen; never let it be the only path.
      setTimeout(settle, 1500);
    } else {
      settle();
    }
  })();
</script>
</body></html>"##;

    /// Deliberately plain: no `@page`, no explicit heights, no forced breaks.
    /// If this also runs away, the fault is in the print configuration rather
    /// than in the stacked page-box CSS.
    const SIMPLE_HTML: &str = r##"<!doctype html>
<html><head><meta charset="utf-8"></head>
<body><h1>Plain flow</h1><p>One short paragraph, no page CSS at all.</p>
<script>
  setTimeout(function () {
    window.ipc.postMessage(JSON.stringify({ ok: true, pages: 1 }));
  }, 300);
</script>
</body></html>"##;

    enum HostEvent {
        Message(String),
        Deadline,
    }

    fn emit_failure(message: impl Into<String>) -> ! {
        println!("{}", json!({ "passed": false, "error": message.into() }));
        process::exit(1);
    }

    /// Minimal structural read of the produced PDF. Byte-level fidelity is out
    /// of scope; page count and page size are the two properties that decide
    /// whether a student's paper is submittable.
    fn inspect_pdf(bytes: &[u8]) -> (usize, Option<(f64, f64)>) {
        let text = String::from_utf8_lossy(bytes);
        let pages = text.matches("/Type /Page").count() + text.matches("/Type/Page").count()
            - text.matches("/Type /Pages").count()
            - text.matches("/Type/Pages").count();
        let media_box = text.find("/MediaBox").and_then(|start| {
            let rest = &text[start..];
            let open = rest.find('[')?;
            let close = rest.find(']')?;
            let numbers: Vec<f64> = rest[open + 1..close]
                .split_whitespace()
                .filter_map(|value| value.parse::<f64>().ok())
                .collect();
            match numbers.as_slice() {
                [x0, y0, x1, y1] => Some(((x1 - x0).abs(), (y1 - y0).abs())),
                _ => None,
            }
        });
        (pages, media_box)
    }

    /// Configures the print job so the CSS page box owns the layout. Every
    /// value here exists to stop AppKit from quietly re-laying-out the page:
    /// non-zero margins inset the CSS margins a second time, centering shifts
    /// an already-positioned box, and any scale factor but 1.0 breaks 12 pt.
    fn build_print_info(
        destination: &str,
        zero_margins: bool,
        shared_info: bool,
    ) -> Retained<NSPrintInfo> {
        unsafe {
            // `sharedPrintInfo` is a process-wide singleton; mutating it leaks
            // this job's geometry into every later print and is a suspect for
            // the runaway. A fresh instance is both safer and side-effect free.
            let info = if shared_info {
                NSPrintInfo::sharedPrintInfo()
            } else {
                NSPrintInfo::new()
            };
            info.setPaperSize(LETTER_POINTS);
            info.setOrientation(NSPaperOrientation::Portrait);
            // Zeroing all four margins is what the design document currently
            // prescribes, and it is the prime suspect for the runaway
            // pagination observed on the first visible run. Kept behind a flag
            // so the two geometries can be compared rather than argued about.
            if zero_margins {
                info.setTopMargin(0.0);
                info.setBottomMargin(0.0);
                info.setLeftMargin(0.0);
                info.setRightMargin(0.0);
            }
            info.setHorizontallyCentered(false);
            info.setVerticallyCentered(false);
            info.setScalingFactor(1.0);
            info.setJobDisposition(NSPrintSaveJob);

            let url = NSURL::fileURLWithPath(&NSString::from_str(destination));
            info.dictionary()
                .setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));
            info
        }
    }

    pub fn run() {
        let destination = env::args()
            .nth(1)
            .map(PathBuf::from)
            .unwrap_or_else(|| env::temp_dir().join("tesina-pdf-proof.pdf"));
        // Default hidden: the shipping export must never flash a window at the
        // student. `--visible` exists to isolate "hidden webviews do not lay
        // out" from a genuine print-pipeline failure.
        let visible = env::args().any(|argument| argument == "--visible");
        let zero_margins = !env::args().any(|argument| argument == "--default-margins");
        let simple = env::args().any(|argument| argument == "--simple");
        let keep_frame = env::args().any(|argument| argument == "--keep-frame");
        let shared_info = env::args().any(|argument| argument == "--shared-info");
        let expected_pages = if simple { 1 } else { EXPECTED_PAGES };
        let _ = fs::remove_file(&destination);

        // `runOperation` blocks the main thread, so a runaway pagination loop
        // cannot be stopped from the event loop. The first visible run wrote a
        // 3.65 GB PDF and was still growing. This watchdog is the only thing
        // standing between a bad geometry and a full disk.
        let watched = destination.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(250));
            if let Ok(metadata) = fs::metadata(&watched) {
                if metadata.len() > PDF_SIZE_CAP_BYTES {
                    println!(
                        "{}",
                        json!({
                            "passed": false,
                            "error": "runaway pagination: output exceeded the size cap",
                            "pdfBytes": metadata.len(),
                            "capBytes": PDF_SIZE_CAP_BYTES,
                        })
                    );
                    let _ = fs::remove_file(&watched);
                    process::exit(2);
                }
            }
        });

        let event_loop = EventLoopBuilder::<HostEvent>::with_user_event().build();
        let window = WindowBuilder::new()
            .with_title("Tesina macOS PDF proof")
            .with_visible(visible)
            .with_inner_size(LogicalSize::new(816.0, 1056.0))
            .build(&event_loop)
            .unwrap_or_else(|error| emit_failure(format!("window creation failed: {error}")));

        let proxy = event_loop.create_proxy();
        let ipc_proxy = proxy.clone();
        let webview = WebViewBuilder::new()
            .with_html(if simple { SIMPLE_HTML } else { PROOF_HTML })
            .with_visible(true)
            .with_ipc_handler(move |request: Request<String>| {
                let _ = ipc_proxy.send_event(HostEvent::Message(request.body().clone()));
            })
            .build(&window)
            .unwrap_or_else(|error| emit_failure(format!("webview creation failed: {error}")));

        let deadline_proxy = proxy.clone();
        thread::spawn(move || {
            thread::sleep(HOST_DEADLINE);
            let _ = deadline_proxy.send_event(HostEvent::Deadline);
        });

        let mut settled = false;
        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::Wait;
            match event {
                Event::UserEvent(HostEvent::Deadline) if !settled => {
                    settled = true;
                    println!(
                        "{}",
                        json!({
                            "passed": false,
                            "error": "handshake never arrived before the deadline",
                            "visible": visible,
                        })
                    );
                    *control_flow = ControlFlow::ExitWithCode(1);
                }
                Event::UserEvent(HostEvent::Message(message)) if !settled => {
                    settled = true;
                    let envelope: Value = match serde_json::from_str(&message) {
                        Ok(value) => value,
                        Err(error) => {
                            println!(
                                "{}",
                                json!({ "passed": false, "error": format!("bad handshake: {error}") })
                            );
                            *control_flow = ControlFlow::ExitWithCode(1);
                            return;
                        }
                    };
                    if envelope["ok"] != json!(true) {
                        println!(
                            "{}",
                            json!({ "passed": false, "error": envelope["error"].clone() })
                        );
                        *control_flow = ControlFlow::ExitWithCode(1);
                        return;
                    }

                    let path = destination.to_string_lossy().to_string();
                    let info = build_print_info(&path, zero_margins, shared_info);
                    // Pin the view to the paper box in points before printing.
                    // WKWebView paginates against its own frame; leaving it at
                    // the window's pixel size mixes 96 dpi CSS pixels with 72
                    // dpi print points and skews every page break.
                    let native = webview.webview();
                    if !keep_frame {
                        native.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), LETTER_POINTS));
                    }
                    let operation = unsafe { native.printOperationWithPrintInfo(&info) };
                    operation.setShowsPrintPanel(false);
                    operation.setShowsProgressPanel(false);
                    let ran = operation.runOperation();

                    let bytes = fs::read(&destination).unwrap_or_default();
                    let (pages, media_box) = inspect_pdf(&bytes);
                    let size_ok = media_box
                        .map(|(w, h)| (w - 612.0).abs() < 2.0 && (h - 792.0).abs() < 2.0)
                        .unwrap_or(false);
                    let passed = ran && !bytes.is_empty() && pages == expected_pages && size_ok;

                    println!(
                        "{}",
                        json!({
                            "passed": passed,
                            "ranOperation": ran,
                            "visible": visible,
                            "handshakePages": envelope["pages"].clone(),
                            "pdfBytes": bytes.len(),
                            "pdfPages": pages,
                            "expectedPages": expected_pages,
                            "simple": simple,
                            "mediaBox": media_box.map(|(w, h)| json!([w, h])),
                            "mediaBoxOk": size_ok,
                            "zeroMargins": zero_margins,
                            "path": path,
                        })
                    );
                    *control_flow = ControlFlow::ExitWithCode(if passed { 0 } else { 1 });
                }
                _ => {}
            }
        });
    }
}

#[cfg(target_os = "macos")]
fn main() {
    host::run();
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("macos-pdf-proof-host is available only on macOS");
    std::process::exit(1);
}
