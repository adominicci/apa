#[cfg(any(target_os = "windows", test))]
use url::Url;

#[cfg(any(target_os = "windows", test))]
#[path = "support/windows-native-input.rs"]
mod windows_native_input;

#[cfg(any(target_os = "windows", test))]
fn loopback_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.scheme() != "http" {
        return false;
    }
    matches!(
        url.host_str().map(str::to_ascii_lowercase).as_deref(),
        Some("127.0.0.1" | "localhost" | "::1" | "[::1]")
    )
}

#[cfg(any(target_os = "windows", test))]
struct PendingNativeInput<T> {
    payload: Option<T>,
    held_result: Option<T>,
    result_received: bool,
}

#[cfg(any(target_os = "windows", test))]
impl<T> Default for PendingNativeInput<T> {
    fn default() -> Self {
        Self {
            payload: None,
            held_result: None,
            result_received: false,
        }
    }
}

#[cfg(any(target_os = "windows", test))]
impl<T> PendingNativeInput<T> {
    fn queue(&mut self, payload: T) -> Result<(), &'static str> {
        if self.result_received {
            return Err("native input IPC arrived after the final result");
        }
        if self.payload.is_some() {
            return Err("native input IPC arrived before the prior stage drained");
        }
        self.payload = Some(payload);
        Ok(())
    }

    fn take(&mut self) -> Option<T> {
        self.payload.take()
    }

    fn queue_result(&mut self, result: T) -> Result<Option<T>, &'static str> {
        if self.result_received {
            return Err("native input result arrived more than once");
        }
        self.result_received = true;
        if self.payload.is_some() {
            self.held_result = Some(result);
            Ok(None)
        } else {
            Ok(Some(result))
        }
    }

    fn take_result_if_drained(&mut self) -> Option<T> {
        if self.payload.is_some() {
            return None;
        }
        self.held_result.take()
    }
}

#[cfg(any(target_os = "windows", test))]
fn incomplete_driver_result_error(result: impl std::fmt::Display) -> String {
    format!("Windows native input result arrived before driver completion; page result: {result}")
}

#[cfg(test)]
mod loopback_tests {
    use super::{incomplete_driver_result_error, loopback_url, PendingNativeInput};

    #[test]
    fn accepts_http_loopback_hosts() {
        assert!(loopback_url("http://127.0.0.1:4312/proof"));
        assert!(loopback_url("http://localhost:4312/proof"));
        assert!(loopback_url("http://[::1]:4312/proof"));
    }

    #[test]
    fn rejects_remote_and_credential_form_hosts() {
        assert!(!loopback_url("https://127.0.0.1:4312/proof"));
        assert!(!loopback_url("http://example.com/proof"));
        assert!(!loopback_url("http://localhost:@example.com/proof"));
    }

    #[test]
    fn pending_native_input_holds_one_result_until_the_prior_input_drains() {
        let mut pending = PendingNativeInput::default();
        assert!(pending.queue("caret").is_ok());
        assert_eq!(
            pending.queue("dead-key"),
            Err("native input IPC arrived before the prior stage drained")
        );
        assert_eq!(pending.queue_result("complete"), Ok(None));
        assert_eq!(pending.take_result_if_drained(), None);
        assert_eq!(pending.take(), Some("caret"));
        assert_eq!(pending.take_result_if_drained(), Some("complete"));
    }

    #[test]
    fn pending_native_input_rejects_duplicate_results_and_input_after_a_result() {
        let mut pending = PendingNativeInput::default();
        assert!(pending.queue("caret").is_ok());
        assert_eq!(pending.queue_result("complete"), Ok(None));
        assert_eq!(
            pending.queue_result("duplicate"),
            Err("native input result arrived more than once")
        );
        assert_eq!(
            pending.queue("dead-key"),
            Err("native input IPC arrived after the final result")
        );
    }

    #[test]
    fn pending_native_input_returns_an_immediate_result_when_no_input_is_pending() {
        let mut pending = PendingNativeInput::default();
        assert_eq!(pending.queue_result("complete"), Ok(Some("complete")));
        assert_eq!(pending.take_result_if_drained(), None);
    }

    #[test]
    fn incomplete_driver_rejection_preserves_the_page_result_diagnostic() {
        assert_eq!(
            incomplete_driver_result_error("clipboard mismatch"),
            "Windows native input result arrived before driver completion; page result: clipboard mismatch"
        );
    }
}

#[cfg(target_os = "windows")]
mod windows_host {
    use super::incomplete_driver_result_error;
    use super::loopback_url;
    use super::windows_native_input::WindowsNativeInputDriver;
    use super::PendingNativeInput;
    use serde_json::{json, Value};
    use std::{env, path::PathBuf, process, thread, time::Duration};
    use tao::{
        dpi::LogicalSize,
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoopBuilder},
        window::WindowBuilder,
    };
    use url::Url;
    use wry::{
        http::Request,
        raw_window_handle::{HasWindowHandle, RawWindowHandle},
        WebContext, WebViewBuilder,
    };

    const AUTOMATED_HOST_DEADLINE: Duration = Duration::from_secs(45);
    const EXPANDED_PAGINATION_HOST_DEADLINE: Duration = Duration::from_secs(135);
    const MANUAL_HOST_DEADLINE: Duration = Duration::from_secs(300);

    enum HostEvent {
        Message(String),
        Deadline,
    }

    fn fail(message: impl Into<String>) -> ! {
        println!("{}", json!({ "passed": false, "error": message.into() }));
        process::exit(1);
    }

    fn settle_failure(
        control_flow: &mut ControlFlow,
        driver: &mut Option<WindowsNativeInputDriver>,
        exit_code: i32,
        message: impl Into<String>,
    ) {
        let mut message = message.into();
        if let Some(driver) = driver.as_mut() {
            if let Err(cleanup_error) = driver.cleanup() {
                message = format!("{message}; {cleanup_error}");
            }
        }
        println!("{}", json!({ "passed": false, "error": message }));
        *control_flow = ControlFlow::ExitWithCode(exit_code);
    }

    fn settle_result(
        control_flow: &mut ControlFlow,
        input_driver: &mut Option<WindowsNativeInputDriver>,
        runtime: &str,
        drive_native_input: bool,
        mut result: Value,
    ) {
        if let Some(driver) = input_driver.as_mut() {
            if !driver.is_complete() {
                settle_failure(
                    control_flow,
                    input_driver,
                    1,
                    incomplete_driver_result_error(&result),
                );
                return;
            }
            if let Err(error) = driver.cleanup() {
                settle_failure(control_flow, input_driver, 1, error);
                return;
            }
        }
        if let Some(metrics) = result.get_mut("metrics").and_then(Value::as_object_mut) {
            metrics.insert("webView2Runtime".into(), Value::String(runtime.to_owned()));
            if drive_native_input {
                metrics.insert(
                    "windowsNativeInputDriver".into(),
                    Value::String("win32-sendinput-v1".into()),
                );
                metrics.insert(
                    "windowsNativeInputComplete".into(),
                    Value::Bool(
                        input_driver
                            .as_ref()
                            .is_some_and(WindowsNativeInputDriver::is_complete),
                    ),
                );
            }
        }
        let passed = result["passed"].as_bool() == Some(true);
        println!("{result}");
        *control_flow = ControlFlow::ExitWithCode(if passed { 0 } else { 1 });
    }

    pub fn run() -> ! {
        let mut arguments = env::args().skip(1);
        let url = arguments
            .next()
            .unwrap_or_else(|| fail("missing proof URL"));
        let profile_dir = arguments
            .next()
            .map(PathBuf::from)
            .unwrap_or_else(|| fail("missing WebView2 profile directory"));
        let drive_native_input = match arguments.next().as_deref() {
            None => false,
            Some("--drive-native-input") => true,
            Some(_) => fail(
                "usage: webview2-proof-host <loopback-url> <profile-dir> [--drive-native-input]",
            ),
        };
        if arguments.next().is_some() || !loopback_url(&url) {
            fail("usage: webview2-proof-host <loopback-url> <profile-dir> [--drive-native-input]");
        }
        let parsed_url = Url::parse(&url).unwrap_or_else(|_| fail("invalid proof URL"));
        if drive_native_input && parsed_url.path() != "/nativeManualProof.html" {
            fail("--drive-native-input requires /nativeManualProof.html");
        }
        let host_deadline = if drive_native_input {
            AUTOMATED_HOST_DEADLINE
        } else if url.contains("/nativeManualProof.html") {
            MANUAL_HOST_DEADLINE
        } else if parsed_url.path() == "/nativeProof.html" {
            EXPANDED_PAGINATION_HOST_DEADLINE
        } else {
            AUTOMATED_HOST_DEADLINE
        };

        let runtime = wry::webview_version()
            .unwrap_or_else(|error| fail(format!("WebView2 runtime unavailable: {error}")));
        if runtime.trim().is_empty() {
            fail("WebView2 runtime returned an empty identity");
        }
        eprintln!("[native-proof] WebView2 runtime={runtime}");

        let event_loop = EventLoopBuilder::<HostEvent>::with_user_event().build();
        let window = WindowBuilder::new()
            .with_title("Tesina WebView2 pagination proof")
            .with_visible(true)
            .with_inner_size(LogicalSize::new(1200.0, 900.0))
            .build(&event_loop)
            .unwrap_or_else(|error| fail(format!("window creation failed: {error}")));

        let proxy = event_loop.create_proxy();
        let ipc_proxy = proxy.clone();
        let mut web_context = WebContext::new(Some(profile_dir));
        let initialization_script = if drive_native_input {
            "window.__TESINA_NATIVE_HOST__ = 'webview2'; window.__TESINA_NATIVE_INPUT_DRIVER__ = 'win32-sendinput-v1';"
        } else {
            "window.__TESINA_NATIVE_HOST__ = 'webview2';"
        };
        let _webview = WebViewBuilder::new_with_web_context(&mut web_context)
            .with_url(url)
            .with_visible(true)
            .with_initialization_script(initialization_script)
            .with_ipc_handler(move |request: Request<String>| {
                let _ = ipc_proxy.send_event(HostEvent::Message(request.body().clone()));
            })
            .build(&window)
            .unwrap_or_else(|error| fail(format!("WebView2 creation failed: {error}")));

        let mut input_driver = if drive_native_input {
            let handle = window
                .window_handle()
                .unwrap_or_else(|error| fail(format!("window handle unavailable: {error}")));
            let hwnd = match handle.as_raw() {
                RawWindowHandle::Win32(handle) => handle.hwnd.get() as *mut core::ffi::c_void,
                _ => fail("WebView2 host did not expose a Win32 window handle"),
            };
            Some(
                WindowsNativeInputDriver::new(hwnd, window.scale_factor())
                    .unwrap_or_else(|error| fail(error)),
            )
        } else {
            None
        };
        let mut pending_native_input = PendingNativeInput::<Value>::default();

        let deadline_proxy = proxy.clone();
        thread::spawn(move || {
            thread::sleep(host_deadline);
            let _ = deadline_proxy.send_event(HostEvent::Deadline);
        });

        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::Wait;
            match event {
                Event::UserEvent(HostEvent::Message(message)) => {
                    let envelope = match serde_json::from_str::<Value>(&message) {
                        Ok(envelope) => envelope,
                        Err(error) => {
                            settle_failure(
                                control_flow,
                                &mut input_driver,
                                1,
                                format!("invalid IPC JSON: {error}"),
                            );
                            return;
                        }
                    };
                    match envelope.get("channel").and_then(Value::as_str) {
                        Some("diagnostic") => {
                            eprintln!("[native-proof] javascript {}", envelope["payload"]);
                        }
                        Some("native-input") => {
                            if input_driver.is_none() {
                                settle_failure(
                                    control_flow,
                                    &mut input_driver,
                                    1,
                                    "native input IPC requires --drive-native-input",
                                );
                                return;
                            }
                            if let Err(error) =
                                pending_native_input.queue(envelope["payload"].clone())
                            {
                                settle_failure(control_flow, &mut input_driver, 1, error);
                            }
                        }
                        Some("result") => {
                            match pending_native_input.queue_result(envelope["payload"].clone()) {
                                Ok(Some(result)) => settle_result(
                                    control_flow,
                                    &mut input_driver,
                                    &runtime,
                                    drive_native_input,
                                    result,
                                ),
                                Ok(None) => {}
                                Err(error) => {
                                    settle_failure(control_flow, &mut input_driver, 1, error)
                                }
                            }
                        }
                        _ => settle_failure(
                            control_flow,
                            &mut input_driver,
                            1,
                            "unknown native proof IPC channel",
                        ),
                    }
                }
                Event::MainEventsCleared => {
                    if let Some(payload) = pending_native_input.take() {
                        let Some(driver) = input_driver.as_mut() else {
                            settle_failure(
                                control_flow,
                                &mut input_driver,
                                1,
                                "pending native input requires --drive-native-input",
                            );
                            return;
                        };
                        if let Err(error) = driver.advance(&payload) {
                            settle_failure(control_flow, &mut input_driver, 1, error);
                            return;
                        }
                    }
                    if let Some(result) = pending_native_input.take_result_if_drained() {
                        settle_result(
                            control_flow,
                            &mut input_driver,
                            &runtime,
                            drive_native_input,
                            result,
                        );
                    }
                }
                Event::UserEvent(HostEvent::Deadline) => {
                    settle_failure(
                        control_flow,
                        &mut input_driver,
                        124,
                        "WebView2 proof timed out",
                    );
                }
                Event::WindowEvent {
                    event: WindowEvent::CloseRequested,
                    ..
                } => {
                    settle_failure(
                        control_flow,
                        &mut input_driver,
                        1,
                        "WebView2 proof window closed",
                    );
                }
                _ => {}
            }
        });
    }
}

#[cfg(target_os = "windows")]
fn main() {
    windows_host::run();
}

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("webview2-proof-host is available only on Windows");
    std::process::exit(64);
}
