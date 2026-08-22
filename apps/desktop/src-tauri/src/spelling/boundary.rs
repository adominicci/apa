use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

const MAX_TEXT_UTF16: usize = 65_536;
const MAX_SAFE_JS_INTEGER: u64 = 9_007_199_254_740_991;
const ACTIVE_REQUEST_LIMIT: usize = 2;
// Bridges command-future reordering without retaining arbitrary unknown IDs.
// Facade request IDs are session-unique, so an evicted or consumed ID is never reused.
const PENDING_CANCEL_LIMIT: usize = 64;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub(crate) enum DocumentLanguage {
    #[serde(rename = "en")]
    English,
    #[serde(rename = "es")]
    Spanish,
}

impl DocumentLanguage {
    pub(crate) fn base(self) -> &'static str {
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
pub(crate) enum AdapterError {
    ApiUnavailable,
    #[cfg_attr(not(windows), allow(dead_code))]
    MissingDictionary,
    Failure,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NativeIssue {
    pub(crate) start: u32,
    pub(crate) length: u32,
    pub(crate) suggestions: Vec<String>,
}

pub(crate) trait PlatformAdapter: Send + Sync {
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
pub(crate) struct CheckRequest {
    pub(crate) request_id: String,
    pub(crate) document_revision: u64,
    pub(crate) language: DocumentLanguage,
    pub(crate) document_start: u64,
    pub(crate) text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ErrorCode {
    ApiUnavailable,
    MissingDictionary,
    InvalidRequest,
    AdapterFailure,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpellingIssue {
    pub(crate) from: u64,
    pub(crate) to: u64,
    pub(crate) word: String,
    pub(crate) suggestions: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum CapabilityResult {
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
pub(crate) enum CheckResult {
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

pub(crate) fn resolve_language_tag<T: AsRef<str>>(
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
    registry: Arc<Mutex<RequestRegistry>>,
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.registry
            .lock()
            .unwrap()
            .active
            .remove(&self.request_id);
    }
}

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, Arc<AtomicBool>>,
    pending_cancellations: VecDeque<String>,
}

pub(crate) struct AdmittedCheck {
    request: CheckRequest,
    cancelled: Arc<AtomicBool>,
    _guard: ActiveGuard,
}

pub(crate) struct Boundary<A> {
    adapter: A,
    registry: Arc<Mutex<RequestRegistry>>,
}

impl<A: PlatformAdapter> Boundary<A> {
    pub(crate) fn new(adapter: A) -> Self {
        Self {
            adapter,
            registry: Arc::new(Mutex::new(RequestRegistry::default())),
        }
    }

    #[cfg(test)]
    pub(crate) fn adapter(&self) -> &A {
        &self.adapter
    }

    #[cfg(test)]
    pub(crate) fn active_count(&self) -> usize {
        self.registry.lock().unwrap().active.len()
    }

    pub(crate) fn capability(&self, language: DocumentLanguage) -> CapabilityResult {
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
            Err(AdapterError::Failure) => CapabilityResult::Unavailable {
                language,
                reason: ErrorCode::AdapterFailure,
            },
            Err(AdapterError::ApiUnavailable | AdapterError::Cancelled) => {
                CapabilityResult::Unavailable {
                    language,
                    reason: ErrorCode::ApiUnavailable,
                }
            }
        }
    }

    pub(crate) fn cancel(&self, request_id: &str) -> bool {
        let mut registry = self.registry.lock().unwrap();
        if let Some(cancelled) = registry.active.get(request_id) {
            cancelled.store(true, Ordering::SeqCst);
            return true;
        }
        if request_id.is_empty()
            || registry
                .pending_cancellations
                .iter()
                .any(|pending| pending == request_id)
        {
            return false;
        }
        if registry.pending_cancellations.len() == PENDING_CANCEL_LIMIT {
            registry.pending_cancellations.pop_front();
        }
        registry
            .pending_cancellations
            .push_back(request_id.to_owned());
        false
    }

    pub(crate) fn check(&self, request: CheckRequest) -> CheckResult {
        match self.admit(request) {
            Ok(admitted) => self.check_admitted(admitted),
            Err(result) => result,
        }
    }

    pub(crate) fn admit(&self, request: CheckRequest) -> Result<AdmittedCheck, CheckResult> {
        let correlation = (request.request_id.clone(), request.document_revision);
        if !valid_request(&request) {
            return Err(failed(correlation, ErrorCode::InvalidRequest));
        }

        let cancelled = {
            let mut registry = self.registry.lock().unwrap();
            let cancelled_before_admission = registry
                .pending_cancellations
                .iter()
                .position(|pending| pending == &request.request_id)
                .is_some_and(|index| registry.pending_cancellations.remove(index).is_some());
            if registry.active.contains_key(&request.request_id) {
                return Err(failed(correlation, ErrorCode::InvalidRequest));
            }
            if registry.active.len() >= ACTIVE_REQUEST_LIMIT {
                return Err(CheckResult::Busy {
                    request_id: correlation.0,
                    document_revision: correlation.1,
                    code: "busy",
                });
            }
            let flag = Arc::new(AtomicBool::new(cancelled_before_admission));
            registry
                .active
                .insert(request.request_id.clone(), flag.clone());
            flag
        };
        Ok(AdmittedCheck {
            _guard: ActiveGuard {
                request_id: request.request_id.clone(),
                registry: self.registry.clone(),
            },
            request,
            cancelled,
        })
    }

    pub(crate) fn check_admitted(&self, admitted: AdmittedCheck) -> CheckResult {
        let AdmittedCheck {
            request,
            cancelled,
            _guard,
        } = admitted;
        let correlation = (request.request_id.clone(), request.document_revision);

        if cancelled.load(Ordering::SeqCst) {
            return cancelled_result(correlation);
        }
        let installed_result = self.adapter.installed_languages();
        if cancelled.load(Ordering::SeqCst) {
            return cancelled_result(correlation);
        }
        let installed = match installed_result {
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
        let Some(issues) = convert_issues(&request, native) else {
            return failed(correlation, ErrorCode::AdapterFailure);
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

pub(crate) fn failed(correlation: (String, u64), code: ErrorCode) -> CheckResult {
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
