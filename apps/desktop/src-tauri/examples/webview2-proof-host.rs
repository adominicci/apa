#[cfg(any(target_os = "windows", test))]
use url::Url;

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

#[cfg(test)]
mod loopback_tests {
    use super::loopback_url;

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
}

#[cfg(target_os = "windows")]
mod windows_host {
    use super::loopback_url;
    use serde_json::{json, Value};
    use std::{env, path::PathBuf, process, thread, time::Duration};
    use tao::{
        dpi::LogicalSize,
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoopBuilder},
        window::WindowBuilder,
    };
    use wry::{http::Request, WebContext, WebViewBuilder};

    const AUTOMATED_HOST_DEADLINE: Duration = Duration::from_secs(45);
    const MANUAL_HOST_DEADLINE: Duration = Duration::from_secs(300);

    enum HostEvent {
        Message(String),
        Deadline,
    }

    fn fail(message: impl Into<String>) -> ! {
        println!("{}", json!({ "passed": false, "error": message.into() }));
        process::exit(1);
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
        if arguments.next().is_some() || !loopback_url(&url) {
            fail("usage: webview2-proof-host <loopback-url> <profile-dir>");
        }
        let host_deadline = if url.contains("/nativeManualProof.html") {
            MANUAL_HOST_DEADLINE
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
        let _webview = WebViewBuilder::new_with_web_context(&mut web_context)
            .with_url(url)
            .with_visible(true)
            .with_initialization_script("window.__TESINA_NATIVE_HOST__ = 'webview2';")
            .with_ipc_handler(move |request: Request<String>| {
                let _ = ipc_proxy.send_event(HostEvent::Message(request.body().clone()));
            })
            .build(&window)
            .unwrap_or_else(|error| fail(format!("WebView2 creation failed: {error}")));

        let deadline_proxy = proxy.clone();
        thread::spawn(move || {
            thread::sleep(host_deadline);
            let _ = deadline_proxy.send_event(HostEvent::Deadline);
        });

        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::Wait;
            match event {
                Event::UserEvent(HostEvent::Message(message)) => {
                    let envelope = serde_json::from_str::<Value>(&message)
                        .unwrap_or_else(|error| fail(format!("invalid IPC JSON: {error}")));
                    match envelope.get("channel").and_then(Value::as_str) {
                        Some("diagnostic") => {
                            eprintln!("[native-proof] javascript {}", envelope["payload"]);
                        }
                        Some("result") => {
                            let mut result = envelope["payload"].clone();
                            let passed = result["passed"].as_bool() == Some(true);
                            if let Some(metrics) =
                                result.get_mut("metrics").and_then(Value::as_object_mut)
                            {
                                metrics.insert(
                                    "webView2Runtime".into(),
                                    Value::String(runtime.clone()),
                                );
                            }
                            println!("{result}");
                            *control_flow = ControlFlow::ExitWithCode(if passed { 0 } else { 1 });
                        }
                        _ => fail("unknown native proof IPC channel"),
                    }
                }
                Event::UserEvent(HostEvent::Deadline) => {
                    println!(
                        "{}",
                        json!({ "passed": false, "error": "WebView2 proof timed out" })
                    );
                    *control_flow = ControlFlow::ExitWithCode(124);
                }
                Event::WindowEvent {
                    event: WindowEvent::CloseRequested,
                    ..
                } => {
                    println!(
                        "{}",
                        json!({ "passed": false, "error": "WebView2 proof window closed" })
                    );
                    *control_flow = ControlFlow::ExitWithCode(1);
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
