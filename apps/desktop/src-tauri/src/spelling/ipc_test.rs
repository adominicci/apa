use super::commands::{self, SpellingState};
use serde::Deserialize;
use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestRequest {
    command: String,
    #[serde(default)]
    args: Value,
}

pub fn run_ipc_test(input: &str) -> Result<String, String> {
    let request: TestRequest = serde_json::from_str(input).map_err(|error| error.to_string())?;
    let origin = if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    let app = mock_builder()
        .manage(SpellingState::for_ipc_test())
        .invoke_handler(tauri::generate_handler![
            commands::spelling_capability,
            commands::spelling_check,
            commands::spelling_cancel,
        ])
        .build(mock_context(noop_assets()))
        .map_err(|error| error.to_string())?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .map_err(|error| error.to_string())?;
    let response = get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: request.command,
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: tauri::Url::parse(origin).map_err(|error| error.to_string())?,
            body: InvokeBody::Json(request.args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_owned(),
        },
    )
    .map_err(|error| error.to_string())?;
    let value = response
        .deserialize::<Value>()
        .map_err(|error| error.to_string())?;
    serde_json::to_string(&value).map_err(|error| error.to_string())
}
