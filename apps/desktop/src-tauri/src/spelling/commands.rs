use super::boundary::{
    failed, AdmittedCheck, Boundary, CapabilityResult, CheckRequest, CheckResult, DocumentLanguage,
    ErrorCode,
};
use std::sync::Arc;

#[cfg(any(
    test,
    not(any(target_os = "macos", windows)),
    feature = "spelling-ipc-test"
))]
use super::boundary::PlatformAdapter;
#[cfg(any(not(any(target_os = "macos", windows)), feature = "spelling-ipc-test"))]
use super::boundary::{AdapterError, NativeIssue};
#[cfg(any(not(any(target_os = "macos", windows)), feature = "spelling-ipc-test"))]
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

#[cfg(feature = "spelling-ipc-test")]
#[derive(Default)]
struct IpcTestAdapter;

#[cfg(feature = "spelling-ipc-test")]
impl PlatformAdapter for IpcTestAdapter {
    fn installed_languages(&self) -> Result<Vec<String>, AdapterError> {
        Ok(vec!["en-US".into(), "es-ES".into()])
    }

    fn check(
        &self,
        _language_tag: &str,
        text: &str,
        _cancelled: &Arc<AtomicBool>,
    ) -> Result<Vec<NativeIssue>, AdapterError> {
        if text == "adapter-failure" {
            return Err(AdapterError::Failure);
        }
        Ok(vec![NativeIssue {
            start: 0,
            length: text.encode_utf16().count() as u32,
            suggestions: vec!["wrong".into()],
        }])
    }
}

enum ManagedBoundary {
    Native(Boundary<HostAdapter>),
    #[cfg(feature = "spelling-ipc-test")]
    Test(Boundary<IpcTestAdapter>),
}

impl ManagedBoundary {
    fn capability(&self, language: DocumentLanguage) -> CapabilityResult {
        match self {
            Self::Native(boundary) => boundary.capability(language),
            #[cfg(feature = "spelling-ipc-test")]
            Self::Test(boundary) => boundary.capability(language),
        }
    }

    fn admit(&self, request: CheckRequest) -> Result<AdmittedCheck, CheckResult> {
        match self {
            Self::Native(boundary) => boundary.admit(request),
            #[cfg(feature = "spelling-ipc-test")]
            Self::Test(boundary) => boundary.admit(request),
        }
    }

    fn check_admitted(&self, admitted: AdmittedCheck) -> CheckResult {
        match self {
            Self::Native(boundary) => boundary.check_admitted(admitted),
            #[cfg(feature = "spelling-ipc-test")]
            Self::Test(boundary) => boundary.check_admitted(admitted),
        }
    }

    fn cancel(&self, request_id: &str) -> bool {
        match self {
            Self::Native(boundary) => boundary.cancel(request_id),
            #[cfg(feature = "spelling-ipc-test")]
            Self::Test(boundary) => boundary.cancel(request_id),
        }
    }
}

pub struct SpellingState {
    boundary: Arc<ManagedBoundary>,
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
            boundary: Arc::new(ManagedBoundary::Native(Boundary::new(adapter))),
        }
    }

    #[cfg(feature = "spelling-ipc-test")]
    pub(super) fn for_ipc_test() -> Self {
        Self {
            boundary: Arc::new(ManagedBoundary::Test(Boundary::new(IpcTestAdapter))),
        }
    }
}

pub(crate) fn host_boundary() -> Boundary<HostAdapter> {
    Boundary::new(HostAdapter::default())
}

#[cfg(test)]
pub(crate) fn capability_command<A: PlatformAdapter>(
    boundary: &Boundary<A>,
    language: DocumentLanguage,
) -> CapabilityResult {
    boundary.capability(language)
}

#[cfg(test)]
pub(crate) fn check_command<A: PlatformAdapter>(
    boundary: &Boundary<A>,
    request: CheckRequest,
) -> CheckResult {
    boundary.check(request)
}

#[cfg(test)]
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
        tauri::async_runtime::spawn_blocking(move || boundary.capability(language))
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
    let admitted = match boundary.admit(request) {
        Ok(admitted) => admitted,
        Err(result) => return Ok(result),
    };
    Ok(
        tauri::async_runtime::spawn_blocking(move || boundary.check_admitted(admitted))
            .await
            .unwrap_or_else(|_| failed(correlation, ErrorCode::AdapterFailure)),
    )
}

#[tauri::command]
pub async fn spelling_cancel(
    state: tauri::State<'_, SpellingState>,
    request_id: String,
) -> Result<(), ()> {
    state.boundary.cancel(&request_id);
    Ok(())
}
