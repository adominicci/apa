use super::boundary::{
    failed, Boundary, CapabilityResult, CheckRequest, CheckResult, DocumentLanguage, ErrorCode,
    PlatformAdapter,
};
use std::sync::Arc;

#[cfg(not(any(target_os = "macos", windows)))]
use super::boundary::{AdapterError, NativeIssue};
#[cfg(not(any(target_os = "macos", windows)))]
use std::sync::atomic::AtomicBool;

#[cfg(target_os = "macos")]
use super::macos::MacOsAdapter as HostAdapter;
#[cfg(windows)]
use super::windows::WindowsAdapter as HostAdapter;

#[cfg(not(any(target_os = "macos", windows)))]
#[derive(Default)]
struct HostAdapter;

#[cfg(not(any(target_os = "macos", windows)))]
impl PlatformAdapter for HostAdapter {
    fn installed_languages(&self) -> Result<Vec<String>, AdapterError> {
        Err(AdapterError::ApiUnavailable)
    }

    fn check(
        &self,
        _language_tag: &str,
        _text: &str,
        _cancelled: &Arc<AtomicBool>,
    ) -> Result<Vec<NativeIssue>, AdapterError> {
        Err(AdapterError::ApiUnavailable)
    }
}

pub struct SpellingState {
    boundary: Arc<Boundary<HostAdapter>>,
}

impl SpellingState {
    pub fn new(app: tauri::AppHandle) -> Self {
        #[cfg(target_os = "macos")]
        let adapter = HostAdapter::new(app);
        #[cfg(not(target_os = "macos"))]
        let adapter = {
            let _ = app;
            HostAdapter::default()
        };
        Self {
            boundary: Arc::new(Boundary::new(adapter)),
        }
    }

    #[cfg(feature = "spelling-ipc-test")]
    pub(super) fn for_ipc_test() -> Self {
        Self {
            boundary: Arc::new(host_boundary()),
        }
    }
}

pub(crate) fn host_boundary() -> Boundary<HostAdapter> {
    Boundary::new(HostAdapter::default())
}

pub(crate) fn capability_command<A: PlatformAdapter>(
    boundary: &Boundary<A>,
    language: DocumentLanguage,
) -> CapabilityResult {
    boundary.capability(language)
}

pub(crate) fn check_command<A: PlatformAdapter>(
    boundary: &Boundary<A>,
    request: CheckRequest,
) -> CheckResult {
    boundary.check(request)
}

pub(crate) fn cancel_command<A: PlatformAdapter>(boundary: &Boundary<A>, request_id: &str) -> bool {
    boundary.cancel(request_id)
}

// These wrappers stay thin because Tauri's command macro and State injection
// must sit at the application boundary while native work runs off the async runtime.
#[tauri::command]
pub async fn spelling_capability(
    state: tauri::State<'_, SpellingState>,
    language: DocumentLanguage,
) -> Result<CapabilityResult, ()> {
    let boundary = state.boundary.clone();
    Ok(
        tauri::async_runtime::spawn_blocking(move || capability_command(&boundary, language))
            .await
            .unwrap_or(CapabilityResult::Unavailable {
                language,
                reason: ErrorCode::ApiUnavailable,
            }),
    )
}

#[tauri::command]
pub async fn spelling_check(
    state: tauri::State<'_, SpellingState>,
    request: CheckRequest,
) -> Result<CheckResult, ()> {
    let boundary = state.boundary.clone();
    let correlation = (request.request_id.clone(), request.document_revision);
    Ok(
        tauri::async_runtime::spawn_blocking(move || check_command(&boundary, request))
            .await
            .unwrap_or_else(|_| failed(correlation, ErrorCode::AdapterFailure)),
    )
}

#[tauri::command]
pub async fn spelling_cancel(
    state: tauri::State<'_, SpellingState>,
    request_id: String,
) -> Result<(), ()> {
    cancel_command(&state.boundary, &request_id);
    Ok(())
}
