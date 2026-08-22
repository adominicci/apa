use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

const MAX_TEXT_UTF16: usize = 65_536;
const MAX_SAFE_JS_INTEGER: u64 = 9_007_199_254_740_991;
const ACTIVE_REQUEST_LIMIT: usize = 2;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub enum DocumentLanguage {
    #[serde(rename = "en")]
    English,
    #[serde(rename = "es")]
    Spanish,
}

impl DocumentLanguage {
    fn base(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::Spanish => "es",
        }
    }

    fn preferred(self) -> &'static str {
        match self {
            Self::English => "en-US",
            Self::Spanish => "es-ES",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AdapterError {
    ApiUnavailable,
    MissingDictionary,
    Failure,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeIssue {
    pub start: u32,
    pub length: u32,
    pub suggestions: Vec<String>,
}

pub trait PlatformAdapter: Send + Sync {
    fn installed_languages(&self) -> Result<Vec<String>, AdapterError>;
    fn check(
        &self,
        language_tag: &str,
        text: &str,
        cancelled: &Arc<AtomicBool>,
    ) -> Result<Vec<NativeIssue>, AdapterError>;
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckRequest {
    pub request_id: String,
    pub document_revision: u64,
    pub language: DocumentLanguage,
    pub document_start: u64,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    ApiUnavailable,
    MissingDictionary,
    InvalidRequest,
    AdapterFailure,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellingIssue {
    pub from: u64,
    pub to: u64,
    pub word: String,
    pub suggestions: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CapabilityResult {
    Available {
        language: DocumentLanguage,
        selected_language_tag: String,
    },
    MissingDictionary {
        language: DocumentLanguage,
        help_code: &'static str,
    },
    Unavailable {
        language: DocumentLanguage,
        reason: ErrorCode,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CheckResult {
    Completed {
        request_id: String,
        document_revision: u64,
        selected_language_tag: String,
        issues: Vec<SpellingIssue>,
    },
    Cancelled {
        request_id: String,
        document_revision: u64,
    },
    Busy {
        request_id: String,
        document_revision: u64,
        code: &'static str,
    },
    Failed {
        request_id: String,
        document_revision: u64,
        code: ErrorCode,
    },
}

pub fn resolve_language_tag<T: AsRef<str>>(
    language: DocumentLanguage,
    installed: &[T],
) -> Option<String> {
    let base = language.base();
    let mut seen = HashSet::new();
    let mut candidates = installed
        .iter()
        .map(|tag| tag.as_ref().trim())
        .filter(|tag| {
            tag.split('-')
                .next()
                .is_some_and(|part| part.eq_ignore_ascii_case(base))
        })
        .filter(|tag| seen.insert(tag.to_ascii_lowercase()))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    candidates.sort_by_key(|tag| tag.to_ascii_lowercase());
    candidates
        .iter()
        .find(|tag| tag.eq_ignore_ascii_case(base))
        .or_else(|| {
            candidates
                .iter()
                .find(|tag| tag.eq_ignore_ascii_case(language.preferred()))
        })
        .or_else(|| candidates.first())
        .cloned()
}

struct ActiveGuard {
    request_id: String,
    registry: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.registry.lock().unwrap().remove(&self.request_id);
    }
}

pub struct Boundary<A> {
    adapter: A,
    registry: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl<A: PlatformAdapter> Boundary<A> {
    pub fn new(adapter: A) -> Self {
        Self {
            adapter,
            registry: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[cfg(test)]
    fn adapter(&self) -> &A {
        &self.adapter
    }

    pub fn active_count(&self) -> usize {
        self.registry.lock().unwrap().len()
    }

    pub fn capability(&self, language: DocumentLanguage) -> CapabilityResult {
        match self.adapter.installed_languages() {
            Ok(installed) => match resolve_language_tag(language, &installed) {
                Some(selected_language_tag) => CapabilityResult::Available {
                    language,
                    selected_language_tag,
                },
                None => CapabilityResult::MissingDictionary {
                    language,
                    help_code: "install-system-dictionary",
                },
            },
            Err(AdapterError::MissingDictionary) => CapabilityResult::MissingDictionary {
                language,
                help_code: "install-system-dictionary",
            },
            Err(_) => CapabilityResult::Unavailable {
                language,
                reason: ErrorCode::ApiUnavailable,
            },
        }
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        let registry = self.registry.lock().unwrap();
        let Some(cancelled) = registry.get(request_id) else {
            return false;
        };
        cancelled.store(true, Ordering::SeqCst);
        true
    }

    pub fn check(&self, request: CheckRequest) -> CheckResult {
        let correlation = (request.request_id.clone(), request.document_revision);
        if !valid_request(&request) {
            return failed(correlation, ErrorCode::InvalidRequest);
        }

        let cancelled = {
            let mut registry = self.registry.lock().unwrap();
            if registry.contains_key(&request.request_id) {
                return failed(correlation, ErrorCode::InvalidRequest);
            }
            if registry.len() >= ACTIVE_REQUEST_LIMIT {
                return CheckResult::Busy {
                    request_id: correlation.0,
                    document_revision: correlation.1,
                    code: "busy",
                };
            }
            let flag = Arc::new(AtomicBool::new(false));
            registry.insert(request.request_id.clone(), flag.clone());
            flag
        };
        let _guard = ActiveGuard {
            request_id: request.request_id.clone(),
            registry: self.registry.clone(),
        };

        if cancelled.load(Ordering::SeqCst) {
            return cancelled_result(correlation);
        }
        let installed = match self.adapter.installed_languages() {
            Ok(tags) => tags,
            Err(error) => return failed(correlation, translated_error(error)),
        };
        let Some(selected_language_tag) = resolve_language_tag(request.language, &installed) else {
            return failed(correlation, ErrorCode::MissingDictionary);
        };
        if request.text.is_empty() {
            return CheckResult::Completed {
                request_id: correlation.0,
                document_revision: correlation.1,
                selected_language_tag,
                issues: Vec::new(),
            };
        }

        let native = match self
            .adapter
            .check(&selected_language_tag, &request.text, &cancelled)
        {
            Ok(issues) => issues,
            Err(AdapterError::Cancelled) => return cancelled_result(correlation),
            Err(error) => return failed(correlation, translated_error(error)),
        };
        if cancelled.load(Ordering::SeqCst) {
            return cancelled_result(correlation);
        }
        let issues = match convert_issues(&request, native) {
            Some(issues) => issues,
            None => return failed(correlation, ErrorCode::AdapterFailure),
        };
        CheckResult::Completed {
            request_id: correlation.0,
            document_revision: correlation.1,
            selected_language_tag,
            issues,
        }
    }
}

fn valid_request(request: &CheckRequest) -> bool {
    let length = request.text.encode_utf16().count();
    !request.request_id.is_empty()
        && length <= MAX_TEXT_UTF16
        && request.document_start <= MAX_SAFE_JS_INTEGER
        && request
            .document_start
            .checked_add(length as u64)
            .is_some_and(|end| end <= MAX_SAFE_JS_INTEGER)
}

fn convert_issues(request: &CheckRequest, native: Vec<NativeIssue>) -> Option<Vec<SpellingIssue>> {
    let units = request.text.encode_utf16().collect::<Vec<_>>();
    let mut issues = Vec::with_capacity(native.len());
    for issue in native {
        let start = issue.start as usize;
        let end = start.checked_add(issue.length as usize)?;
        let word = String::from_utf16(units.get(start..end)?).ok()?;
        let from = request.document_start.checked_add(start as u64)?;
        let to = request.document_start.checked_add(end as u64)?;
        let mut seen = HashSet::new();
        let suggestions = issue
            .suggestions
            .into_iter()
            .filter(|value| !value.is_empty() && seen.insert(value.clone()))
            .take(8)
            .collect();
        issues.push(SpellingIssue {
            from,
            to,
            word,
            suggestions,
        });
    }
    issues.sort_by_key(|issue| (issue.from, issue.to));
    Some(issues)
}

fn translated_error(error: AdapterError) -> ErrorCode {
    match error {
        AdapterError::ApiUnavailable => ErrorCode::ApiUnavailable,
        AdapterError::MissingDictionary => ErrorCode::MissingDictionary,
        AdapterError::Failure | AdapterError::Cancelled => ErrorCode::AdapterFailure,
    }
}

fn failed(correlation: (String, u64), code: ErrorCode) -> CheckResult {
    CheckResult::Failed {
        request_id: correlation.0,
        document_revision: correlation.1,
        code,
    }
}

fn cancelled_result(correlation: (String, u64)) -> CheckResult {
    CheckResult::Cancelled {
        request_id: correlation.0,
        document_revision: correlation.1,
    }
}

#[cfg(target_os = "macos")]
pub struct MacOsAdapter {
    app: Option<tauri::AppHandle>,
}

#[cfg(target_os = "macos")]
impl Default for MacOsAdapter {
    fn default() -> Self {
        Self { app: None }
    }
}

#[cfg(target_os = "macos")]
impl MacOsAdapter {
    fn new(app: tauri::AppHandle) -> Self {
        Self { app: Some(app) }
    }

    fn on_main_thread<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> Result<T, AdapterError> + Send + 'static,
    ) -> Result<T, AdapterError> {
        let Some(app) = &self.app else {
            return work();
        };
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let _ = sender.send(work());
        })
        .map_err(|_| AdapterError::ApiUnavailable)?;
        receiver.recv().map_err(|_| AdapterError::ApiUnavailable)?
    }
}

#[cfg(target_os = "macos")]
impl PlatformAdapter for MacOsAdapter {
    fn installed_languages(&self) -> Result<Vec<String>, AdapterError> {
        self.on_main_thread(macos_installed_languages)
    }

    fn check(
        &self,
        language_tag: &str,
        text: &str,
        cancelled: &Arc<AtomicBool>,
    ) -> Result<Vec<NativeIssue>, AdapterError> {
        let language_tag = language_tag.to_owned();
        let text = text.to_owned();
        let cancelled = cancelled.clone();
        self.on_main_thread(move || macos_check(&language_tag, &text, &cancelled))
    }
}

#[cfg(target_os = "macos")]
fn macos_installed_languages() -> Result<Vec<String>, AdapterError> {
    use objc2_app_kit::NSSpellChecker;

    let checker = NSSpellChecker::sharedSpellChecker();
    let languages = checker.availableLanguages();
    Ok((0..languages.count())
        .map(|index| languages.objectAtIndex(index).to_string())
        .collect())
}

#[cfg(target_os = "macos")]
fn macos_check(
    language_tag: &str,
    text: &str,
    cancelled: &Arc<AtomicBool>,
) -> Result<Vec<NativeIssue>, AdapterError> {
    use objc2_app_kit::NSSpellChecker;
    use objc2_foundation::NSString;

    if cancelled.load(Ordering::SeqCst) {
        return Err(AdapterError::Cancelled);
    }
    let checker = NSSpellChecker::sharedSpellChecker();
    let string = NSString::from_str(text);
    let language = NSString::from_str(language_tag);
    let text_length = text.encode_utf16().count();
    let mut start = 0usize;
    let mut issues = Vec::new();

    while start < text_length {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AdapterError::Cancelled);
        }
        // SAFETY: the optional word-count pointer is null and every other
        // argument remains alive for the duration of the Objective-C call.
        let range = unsafe {
            checker.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount(
                &string,
                start as isize,
                Some(&language),
                false,
                0,
                std::ptr::null_mut(),
            )
        };
        if range.location == usize::MAX || range.length == 0 {
            break;
        }
        let end = range
            .location
            .checked_add(range.length)
            .ok_or(AdapterError::Failure)?;
        if end > text_length || end <= start {
            return Err(AdapterError::Failure);
        }
        if cancelled.load(Ordering::SeqCst) {
            return Err(AdapterError::Cancelled);
        }
        let guesses = checker
            .guessesForWordRange_inString_language_inSpellDocumentWithTag(
                range,
                &string,
                Some(&language),
                0,
            )
            .map(|values| {
                let mut result = Vec::with_capacity(values.count());
                for index in 0..values.count() {
                    if cancelled.load(Ordering::SeqCst) {
                        return Err(AdapterError::Cancelled);
                    }
                    result.push(values.objectAtIndex(index).to_string());
                }
                Ok(result)
            })
            .transpose()?
            .unwrap_or_default();
        issues.push(NativeIssue {
            start: u32::try_from(range.location).map_err(|_| AdapterError::Failure)?,
            length: u32::try_from(range.length).map_err(|_| AdapterError::Failure)?,
            suggestions: guesses,
        });
        start = end;
    }
    Ok(issues)
}

#[cfg(windows)]
pub struct WindowsAdapter;

#[cfg(windows)]
impl Default for WindowsAdapter {
    fn default() -> Self {
        Self
    }
}

#[cfg(windows)]
struct ComApartment;

#[cfg(windows)]
impl ComApartment {
    fn initialize() -> Result<Self, AdapterError> {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        // SAFETY: this operation owns the current thread's COM apartment and
        // balances every successful initialization in Drop.
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
            .ok()
            .map_err(|_| AdapterError::ApiUnavailable)?;
        Ok(Self)
    }
}

#[cfg(windows)]
impl Drop for ComApartment {
    fn drop(&mut self) {
        // SAFETY: this runs on the same operation thread that initialized COM.
        unsafe { windows::Win32::System::Com::CoUninitialize() };
    }
}

#[cfg(windows)]
fn spell_checker_factory(
) -> Result<windows::Win32::Globalization::ISpellCheckerFactory, AdapterError> {
    use windows::Win32::Globalization::{ISpellCheckerFactory, SpellCheckerFactory};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    // SAFETY: COM is initialized for this operation and the requested class
    // and interface are the documented Windows spell-check factory.
    unsafe {
        CoCreateInstance::<_, ISpellCheckerFactory>(
            &SpellCheckerFactory,
            None::<&windows::core::IUnknown>,
            CLSCTX_INPROC_SERVER,
        )
    }
    .map_err(|_| AdapterError::ApiUnavailable)
}

#[cfg(windows)]
fn collect_enum_strings(
    values: &windows::Win32::System::Com::IEnumString,
    cancelled: Option<&AtomicBool>,
) -> Result<Vec<String>, AdapterError> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::S_FALSE;
    use windows::Win32::System::Com::CoTaskMemFree;

    let mut result = Vec::new();
    loop {
        if cancelled.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
            return Err(AdapterError::Cancelled);
        }
        let mut raw = [PWSTR::null()];
        let mut fetched = 0u32;
        // SAFETY: the one-element output and fetched count remain valid for
        // the call. Windows allocates a returned string with CoTaskMemAlloc.
        let status = unsafe { values.Next(&mut raw, Some(&mut fetched)) };
        if status == S_FALSE {
            break;
        }
        status.ok().map_err(|_| AdapterError::Failure)?;
        if fetched == 0 {
            break;
        }
        let pointer = raw[0].as_ptr();
        // SAFETY: a successful IEnumString::Next returned a null-terminated
        // string that remains valid until CoTaskMemFree below.
        let value = unsafe { raw[0].to_string() }.map_err(|_| AdapterError::Failure);
        // SAFETY: IEnumString assigns this pointer with COM task allocation.
        unsafe { CoTaskMemFree(Some(pointer.cast())) };
        result.push(value?);
    }
    Ok(result)
}

#[cfg(windows)]
impl PlatformAdapter for WindowsAdapter {
    fn installed_languages(&self) -> Result<Vec<String>, AdapterError> {
        let _apartment = ComApartment::initialize()?;
        let factory = spell_checker_factory()?;
        // SAFETY: factory and enumeration stay in this operation's COM apartment.
        let languages =
            unsafe { factory.SupportedLanguages() }.map_err(|_| AdapterError::ApiUnavailable)?;
        collect_enum_strings(&languages, None)
    }

    fn check(
        &self,
        language_tag: &str,
        text: &str,
        cancelled: &Arc<AtomicBool>,
    ) -> Result<Vec<NativeIssue>, AdapterError> {
        use windows::core::HSTRING;
        use windows::Win32::Foundation::S_FALSE;

        if cancelled.load(Ordering::SeqCst) {
            return Err(AdapterError::Cancelled);
        }
        let _apartment = ComApartment::initialize()?;
        let factory = spell_checker_factory()?;
        let language = HSTRING::from(language_tag);
        // SAFETY: all COM objects remain in this initialized operation thread.
        let checker = unsafe { factory.CreateSpellChecker(&language) }
            .map_err(|_| AdapterError::MissingDictionary)?;
        let input = HSTRING::from(text);
        // SAFETY: the input string and checker remain alive during enumeration.
        let errors = unsafe { checker.Check(&input) }.map_err(|_| AdapterError::Failure)?;
        let units = text.encode_utf16().collect::<Vec<_>>();
        let mut result = Vec::new();
        loop {
            if cancelled.load(Ordering::SeqCst) {
                return Err(AdapterError::Cancelled);
            }
            let mut error = None;
            // SAFETY: the optional output remains valid for this call.
            let status = unsafe { errors.Next(&mut error) };
            if status == S_FALSE {
                break;
            }
            status.ok().map_err(|_| AdapterError::Failure)?;
            let error = error.ok_or(AdapterError::Failure)?;
            // SAFETY: the error object belongs to this apartment and is live.
            let start = unsafe { error.StartIndex() }.map_err(|_| AdapterError::Failure)?;
            let length = unsafe { error.Length() }.map_err(|_| AdapterError::Failure)?;
            let end = (start as usize)
                .checked_add(length as usize)
                .ok_or(AdapterError::Failure)?;
            let word = String::from_utf16(
                units
                    .get(start as usize..end)
                    .ok_or(AdapterError::Failure)?,
            )
            .map_err(|_| AdapterError::Failure)?;
            if cancelled.load(Ordering::SeqCst) {
                return Err(AdapterError::Cancelled);
            }
            // SAFETY: the checker and word remain in this operation's apartment.
            let suggestions = unsafe { checker.Suggest(&HSTRING::from(word.as_str())) }
                .map_err(|_| AdapterError::Failure)?;
            result.push(NativeIssue {
                start,
                length,
                suggestions: collect_enum_strings(&suggestions, Some(cancelled))?,
            });
        }
        Ok(result)
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
#[derive(Default)]
pub struct UnsupportedAdapter;

#[cfg(not(any(target_os = "macos", windows)))]
impl PlatformAdapter for UnsupportedAdapter {
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

#[cfg(target_os = "macos")]
type HostAdapter = MacOsAdapter;
#[cfg(windows)]
type HostAdapter = WindowsAdapter;
#[cfg(not(any(target_os = "macos", windows)))]
type HostAdapter = UnsupportedAdapter;

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
}

fn capability_command<A: PlatformAdapter>(
    boundary: &Boundary<A>,
    language: DocumentLanguage,
) -> CapabilityResult {
    boundary.capability(language)
}

fn check_command<A: PlatformAdapter>(boundary: &Boundary<A>, request: CheckRequest) -> CheckResult {
    boundary.check(request)
}

fn cancel_command<A: PlatformAdapter>(boundary: &Boundary<A>, request_id: &str) -> bool {
    boundary.cancel(request_id)
}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofTarget {
    os: &'static str,
    architecture: &'static str,
    os_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofIssue {
    from: u64,
    to: u64,
    suggestions: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofLanguage {
    language: DocumentLanguage,
    capability: CapabilityResult,
    selected_language_tag: Option<String>,
    known_issue: Option<ProofIssue>,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofReport {
    contract_version: u8,
    target: ProofTarget,
    languages: Vec<ProofLanguage>,
    status: &'static str,
}

pub fn run_host_proof() -> ProofReport {
    let boundary = Boundary::new(HostAdapter::default());
    let languages = [
        (DocumentLanguage::English, "wrngg"),
        (DocumentLanguage::Spanish, "palabraa"),
    ]
    .into_iter()
    .map(|(language, fixture)| proof_language(&boundary, language, fixture))
    .collect::<Vec<_>>();
    let status = if languages.iter().all(|entry| entry.status == "pass") {
        "pass"
    } else {
        "block"
    };
    ProofReport {
        contract_version: 1,
        target: ProofTarget {
            os: std::env::consts::OS,
            architecture: std::env::consts::ARCH,
            os_version: host_os_version(),
        },
        languages,
        status,
    }
}

fn proof_language(
    boundary: &Boundary<HostAdapter>,
    language: DocumentLanguage,
    fixture: &str,
) -> ProofLanguage {
    let capability = boundary.capability(language);
    let CapabilityResult::Available {
        selected_language_tag,
        ..
    } = &capability
    else {
        return ProofLanguage {
            language,
            capability,
            selected_language_tag: None,
            known_issue: None,
            status: "block",
        };
    };
    let selected_language_tag = selected_language_tag.clone();
    let result = boundary.check(CheckRequest {
        request_id: format!("proof:{}", language.base()),
        document_revision: 0,
        language,
        document_start: 0,
        text: fixture.to_owned(),
    });
    let known_issue = match result {
        CheckResult::Completed { issues, .. } => issues
            .into_iter()
            .find(|issue| issue.word == fixture && !issue.suggestions.is_empty())
            .map(|issue| ProofIssue {
                from: issue.from,
                to: issue.to,
                suggestions: issue.suggestions,
            }),
        _ => None,
    };
    let status = if known_issue.is_some() {
        "pass"
    } else {
        "block"
    };
    ProofLanguage {
        language,
        capability,
        selected_language_tag: Some(selected_language_tag),
        known_issue,
        status,
    }
}

fn host_os_version() -> String {
    #[cfg(target_os = "macos")]
    let output = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output();
    #[cfg(windows)]
    let output = std::process::Command::new("cmd")
        .args(["/C", "ver"])
        .output();
    #[cfg(not(any(target_os = "macos", windows)))]
    let output = std::process::Command::new("uname").arg("-r").output();
    output
        .ok()
        .filter(|value| value.status.success())
        .and_then(|value| String::from_utf8(value.stdout).ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_language_tag, AdapterError, Boundary, CheckRequest, CheckResult, DocumentLanguage,
        NativeIssue, PlatformAdapter,
    };
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    };
    use std::thread;

    struct FakeAdapter {
        languages: Vec<String>,
        issues: Vec<NativeIssue>,
        checks: AtomicUsize,
        failure: Option<AdapterError>,
        gate: Option<Arc<(Mutex<bool>, Condvar)>>,
    }

    impl FakeAdapter {
        fn available() -> Self {
            Self {
                languages: vec!["es-ES".into(), "en-US".into()],
                issues: Vec::new(),
                checks: AtomicUsize::new(0),
                failure: None,
                gate: None,
            }
        }
    }

    impl PlatformAdapter for FakeAdapter {
        fn installed_languages(&self) -> Result<Vec<String>, AdapterError> {
            self.failure
                .clone()
                .map_or_else(|| Ok(self.languages.clone()), Err)
        }

        fn check(
            &self,
            _language_tag: &str,
            _text: &str,
            cancelled: &Arc<AtomicBool>,
        ) -> Result<Vec<NativeIssue>, AdapterError> {
            self.checks.fetch_add(1, Ordering::SeqCst);
            if let Some(gate) = &self.gate {
                let (lock, ready) = &**gate;
                let mut released = lock.lock().unwrap();
                while !*released {
                    released = ready.wait(released).unwrap();
                }
            }
            if cancelled.load(Ordering::SeqCst) {
                return Err(AdapterError::Cancelled);
            }
            self.failure
                .clone()
                .map_or_else(|| Ok(self.issues.clone()), Err)
        }
    }

    fn request(id: &str, text: &str) -> CheckRequest {
        CheckRequest {
            request_id: id.into(),
            document_revision: 4,
            language: DocumentLanguage::English,
            document_start: 10,
            text: text.into(),
        }
    }

    #[test]
    fn resolves_shuffled_dialects_by_exact_base_priority() {
        let installed = ["EN-gb", "fr", "english", "en-US", "EN", "en-us"];
        assert_eq!(
            resolve_language_tag(DocumentLanguage::English, &installed),
            Some("EN".into())
        );
        assert_eq!(
            resolve_language_tag(DocumentLanguage::Spanish, &["es-MX", "ES-ar"]),
            Some("ES-ar".into())
        );
        assert_eq!(
            resolve_language_tag(DocumentLanguage::English, &["eng", "de"]),
            None
        );
    }

    #[test]
    fn empty_text_resolves_capability_without_checking() {
        let boundary = Boundary::new(FakeAdapter::available());
        let result = boundary.check(request("empty", ""));
        assert!(matches!(result, CheckResult::Completed { issues, .. } if issues.is_empty()));
        assert_eq!(boundary.adapter().checks.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn converts_and_orders_checked_utf16_ranges_and_filters_suggestions() {
        let mut adapter = FakeAdapter::available();
        adapter.issues = vec![
            NativeIssue {
                start: 9,
                length: 5,
                suggestions: vec!["wrong".into()],
            },
            NativeIssue {
                start: 3,
                length: 5,
                suggestions: vec![
                    "".into(),
                    "wrong".into(),
                    "wrong".into(),
                    "wring".into(),
                    "w1".into(),
                    "w2".into(),
                    "w3".into(),
                    "w4".into(),
                    "w5".into(),
                    "w6".into(),
                    "w7".into(),
                ],
            },
        ];
        let boundary = Boundary::new(adapter);
        let result = boundary.check(request("utf16", "😀 wrngg wrngg"));
        let CheckResult::Completed { issues, .. } = result else {
            panic!("expected completion")
        };
        assert_eq!(
            (issues[0].from, issues[0].to, issues[0].word.as_str()),
            (13, 18, "wrngg")
        );
        assert_eq!(
            issues[0].suggestions,
            ["wrong", "wring", "w1", "w2", "w3", "w4", "w5", "w6"]
        );
        assert_eq!((issues[1].from, issues[1].to), (19, 24));
    }

    #[test]
    fn rejects_invalid_native_ranges_without_partial_issues() {
        let mut adapter = FakeAdapter::available();
        adapter.issues = vec![NativeIssue {
            start: 99,
            length: 2,
            suggestions: vec![],
        }];
        let result = Boundary::new(adapter).check(request("range", "short"));
        assert!(matches!(
            result,
            CheckResult::Failed {
                code: super::ErrorCode::AdapterFailure,
                ..
            }
        ));
    }

    #[test]
    fn translates_stable_adapter_failures() {
        let mut adapter = FakeAdapter::available();
        adapter.failure = Some(AdapterError::ApiUnavailable);
        assert!(matches!(
            Boundary::new(adapter).check(request("failure", "text")),
            CheckResult::Failed {
                code: super::ErrorCode::ApiUnavailable,
                ..
            }
        ));
    }

    #[test]
    fn capacity_duplicate_cancellation_and_cleanup_follow_native_exit() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let mut adapter = FakeAdapter::available();
        adapter.gate = Some(gate.clone());
        let boundary = Arc::new(Boundary::new(adapter));
        let first_boundary = boundary.clone();
        let first = thread::spawn(move || first_boundary.check(request("one", "text")));
        let second_boundary = boundary.clone();
        let second = thread::spawn(move || second_boundary.check(request("two", "text")));
        while boundary.active_count() != 2 {
            thread::yield_now();
        }

        assert!(matches!(
            boundary.check(request("three", "text")),
            CheckResult::Busy { .. }
        ));
        assert!(matches!(
            boundary.check(request("one", "text")),
            CheckResult::Failed {
                code: super::ErrorCode::InvalidRequest,
                ..
            }
        ));
        assert!(boundary.cancel("one"));
        assert!(boundary.cancel("one"));
        assert_eq!(boundary.active_count(), 2);
        assert!(!boundary.cancel("later-never-reused"));

        let (lock, ready) = &*gate;
        *lock.lock().unwrap() = true;
        ready.notify_all();
        assert!(matches!(
            first.join().unwrap(),
            CheckResult::Cancelled { .. }
        ));
        assert!(matches!(
            second.join().unwrap(),
            CheckResult::Completed { .. }
        ));
        assert_eq!(boundary.active_count(), 0);
        assert!(!boundary.cancel("one"));
        assert!(matches!(
            boundary.check(request("three", "text")),
            CheckResult::Completed { .. }
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_adapter_reports_capability_and_checks_known_bilingual_fixtures() {
        let adapter = super::MacOsAdapter::default();
        let boundary = Boundary::new(adapter);
        for (language, fixture) in [
            (DocumentLanguage::English, "wrngg"),
            (DocumentLanguage::Spanish, "palabraa"),
        ] {
            match boundary.capability(language) {
                super::CapabilityResult::Available { selected_language_tag, .. } => {
                    let mut request = request(language.base(), fixture);
                    request.language = language;
                    request.document_start = 0;
                    let result = boundary.check(request);
                    assert!(matches!(result, CheckResult::Completed { ref issues, .. } if
                        issues.iter().any(|issue| issue.word == fixture && !issue.suggestions.is_empty())),
                        "{language:?} fixture did not return a ranged issue with suggestions: {result:?}");
                    assert!(!selected_language_tag.is_empty());
                }
                capability => eprintln!(
                    "LT-01 capability block: target=macOS architecture={} language={language:?} result={capability:?}",
                    std::env::consts::ARCH
                ),
            }
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_adapter_honors_cancellation_checkpoint() {
        let adapter = super::MacOsAdapter::default();
        let cancelled = Arc::new(AtomicBool::new(true));
        assert_eq!(
            adapter.check("en-US", "wrngg", &cancelled),
            Err(AdapterError::Cancelled)
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_adapter_reports_capability_and_checks_known_bilingual_fixtures() {
        let adapter = super::WindowsAdapter;
        let boundary = Boundary::new(adapter);
        for (language, fixture) in [
            (DocumentLanguage::English, "wrngg"),
            (DocumentLanguage::Spanish, "palabraa"),
        ] {
            match boundary.capability(language) {
                super::CapabilityResult::Available { selected_language_tag, .. } => {
                    let mut request = request(language.base(), fixture);
                    request.language = language;
                    request.document_start = 0;
                    let result = boundary.check(request);
                    assert!(matches!(result, CheckResult::Completed { ref issues, .. } if
                        issues.iter().any(|issue| issue.word == fixture && !issue.suggestions.is_empty())),
                        "{language:?} fixture did not return a ranged issue with suggestions: {result:?}");
                    assert!(!selected_language_tag.is_empty());
                }
                capability => eprintln!(
                    "LT-01 capability block: target=Windows architecture={} language={language:?} result={capability:?}",
                    std::env::consts::ARCH
                ),
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_adapter_honors_cancellation_checkpoint() {
        let adapter = super::WindowsAdapter;
        let cancelled = Arc::new(AtomicBool::new(true));
        assert_eq!(
            adapter.check("en-US", "wrngg", &cancelled),
            Err(AdapterError::Cancelled)
        );
    }

    #[test]
    fn command_boundary_serializes_stable_results_without_native_details() {
        let mut adapter = FakeAdapter::available();
        adapter.failure = Some(AdapterError::Failure);
        let boundary = Boundary::new(adapter);
        let capability = super::capability_command(&boundary, DocumentLanguage::English);
        assert_eq!(
            serde_json::to_value(capability).unwrap(),
            serde_json::json!({
                "status": "unavailable",
                "language": "en",
                "reason": "api-unavailable"
            })
        );

        let result = super::check_command(&boundary, request("command", "text"));
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "status": "failed",
                "requestId": "command",
                "documentRevision": 4,
                "code": "adapter-failure"
            })
        );
        assert!(!super::cancel_command(&boundary, "command"));
    }

    #[test]
    fn proof_report_has_fixed_contract_and_target_metadata() {
        let report = super::run_host_proof();
        let value = serde_json::to_value(report).unwrap();
        assert_eq!(value["contractVersion"], 1);
        assert_eq!(value["target"]["os"], std::env::consts::OS);
        assert_eq!(value["target"]["architecture"], std::env::consts::ARCH);
        assert!(value["target"]["osVersion"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
        assert_eq!(value["languages"].as_array().unwrap().len(), 2);
        assert!(value.to_string().find("wrngg").is_none());
        assert!(value.to_string().find("palabraa").is_none());
    }
}
