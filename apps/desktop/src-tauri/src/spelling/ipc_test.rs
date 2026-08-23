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
        Self::with_state(SpellingState::for_ipc_test())
    }

    fn with_state(state: SpellingState) -> Result<Self, String> {
        let app = mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![
                commands::spelling_capability,
                commands::spelling_check,
                commands::spelling_cancel,
                #[cfg(feature = "packaged-spelling-proof")]
                super::proof::spelling_packaged_proof,
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
    use super::{commands, IpcTestHarness, SpellingState};
    use crate::spelling::boundary::{CheckRequest, CheckResult, DocumentLanguage};
    use tauri::Manager;

    #[cfg(feature = "packaged-spelling-proof")]
    const PACKAGED_PROOF_OUTPUT_ENV: &str = "TESINA_PACKAGED_SPELLING_PROOF_OUTPUT";

    #[cfg(feature = "packaged-spelling-proof")]
    fn packaged_proof_env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .unwrap()
    }

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

    #[test]
    fn mock_runtime_serializes_adapter_failure_capability_reason() {
        let harness =
            IpcTestHarness::with_state(SpellingState::for_ipc_test_capability_failure()).unwrap();
        let unavailable = harness
            .invoke(r#"{"command":"spelling_capability","args":{"language":"es"}}"#)
            .unwrap();

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&unavailable).unwrap(),
            serde_json::json!({
                "status": "unavailable",
                "language": "es",
                "reason": "adapter-failure"
            })
        );
    }

    #[test]
    fn cancel_before_check_future_polling_is_preserved_until_admission() {
        let harness = IpcTestHarness::new().unwrap();
        let request_id = "ipc:cancel-before-poll".to_owned();
        let check = commands::spelling_check(
            harness._app.state::<SpellingState>(),
            CheckRequest {
                request_id: request_id.clone(),
                document_revision: 25,
                language: DocumentLanguage::English,
                document_start: 0,
                text: "wrngg".into(),
            },
        );

        tauri::async_runtime::block_on(commands::spelling_cancel(
            harness._app.state::<SpellingState>(),
            request_id,
        ))
        .unwrap();
        let result = tauri::async_runtime::block_on(check).unwrap();

        assert!(matches!(result, CheckResult::Cancelled { .. }));
    }

    #[cfg(feature = "packaged-spelling-proof")]
    #[test]
    fn packaged_command_writes_the_redacted_report_from_managed_state() {
        let _env_lock = packaged_proof_env_lock();
        let output_dir = tempfile::tempdir().unwrap();
        let output_path = output_dir.path().join("spelling-report.json");
        std::env::set_var(PACKAGED_PROOF_OUTPUT_ENV, &output_path);

        let harness = IpcTestHarness::new().unwrap();
        let response = harness
            .invoke(r#"{"command":"spelling_packaged_proof","args":{}}"#)
            .unwrap();
        std::env::remove_var(PACKAGED_PROOF_OUTPUT_ENV);

        let response: serde_json::Value = serde_json::from_str(&response).unwrap();
        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(output_path).unwrap()).unwrap();
        assert_eq!(written, response);
        assert_eq!(response["contractVersion"], 1);
        assert_eq!(response["status"], "pass");
        assert_eq!(response["languages"][0]["language"], "en");
        assert_eq!(response["languages"][0]["knownIssue"]["from"], 0);
        assert_eq!(response["languages"][0]["knownIssue"]["to"], 5);
        assert_eq!(response["languages"][1]["language"], "es");
        assert_eq!(response["languages"][1]["knownIssue"]["from"], 0);
        assert_eq!(response["languages"][1]["knownIssue"]["to"], 8);
        assert!(!response.to_string().contains("adapter-failure"));
    }

    #[cfg(feature = "packaged-spelling-proof")]
    #[test]
    fn packaged_command_refuses_to_replace_an_existing_report() {
        let _env_lock = packaged_proof_env_lock();
        let output_dir = tempfile::tempdir().unwrap();
        let output_path = output_dir.path().join("existing-report.json");
        std::fs::write(&output_path, b"keep this evidence").unwrap();
        std::env::set_var(PACKAGED_PROOF_OUTPUT_ENV, &output_path);

        let harness = IpcTestHarness::new().unwrap();
        let result = tauri::async_runtime::block_on(super::super::proof::spelling_packaged_proof(
            harness._app.state::<SpellingState>(),
        ));
        std::env::remove_var(PACKAGED_PROOF_OUTPUT_ENV);

        assert_eq!(
            result.err().as_deref(),
            Some("packaged spelling proof output could not be written")
        );
        assert_eq!(std::fs::read(output_path).unwrap(), b"keep this evidence");
    }
}
