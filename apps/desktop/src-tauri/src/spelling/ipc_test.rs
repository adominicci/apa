use super::commands::{self, SpellingState};
use serde::Deserialize;
use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::webview::InvokeRequest;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestRequest {
    command: String,
    #[serde(default)]
    args: Value,
}

pub struct IpcTestHarness {
    _app: tauri::App<MockRuntime>,
    webview: tauri::WebviewWindow<MockRuntime>,
}

impl IpcTestHarness {
    pub fn new() -> Result<Self, String> {
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
        Ok(Self { _app: app, webview })
    }

    pub fn invoke(&self, input: &str) -> Result<String, String> {
        let request: TestRequest =
            serde_json::from_str(input).map_err(|error| error.to_string())?;
        let origin = if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        let response = get_ipc_response(
            &self.webview,
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
}

#[cfg(test)]
mod tests {
    use super::IpcTestHarness;

    #[test]
    fn persistent_mock_runtime_serializes_completed_and_failed_results() {
        let harness = IpcTestHarness::new().unwrap();
        let completed = harness
            .invoke(r#"{"command":"spelling_check","args":{"request":{"requestId":"ipc:1","documentRevision":23,"language":"en","documentStart":7,"text":"wrngg"}}}"#)
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&completed).unwrap(),
            serde_json::json!({
                "status": "completed",
                "requestId": "ipc:1",
                "documentRevision": 23,
                "selectedLanguageTag": "en-US",
                "issues": [{"from": 7, "to": 12, "word": "wrngg", "suggestions": ["wrong"]}]
            })
        );

        let failed = harness
            .invoke(r#"{"command":"spelling_check","args":{"request":{"requestId":"ipc:2","documentRevision":24,"language":"es","documentStart":0,"text":"adapter-failure"}}}"#)
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&failed).unwrap(),
            serde_json::json!({
                "status": "failed",
                "requestId": "ipc:2",
                "documentRevision": 24,
                "code": "adapter-failure"
            })
        );
    }
}
