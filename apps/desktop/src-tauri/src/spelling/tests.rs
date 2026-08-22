use super::boundary::{
    resolve_language_tag, AdapterError, Boundary, CheckRequest, CheckResult, DocumentLanguage,
    ErrorCode, NativeIssue, PlatformAdapter,
};
use super::commands::{cancel_command, capability_command, check_command};
#[cfg(target_os = "macos")]
use super::macos::MacOsAdapter;
use super::proof::run_host_proof;
#[cfg(windows)]
use super::windows::WindowsAdapter;
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
    language_gate: Option<Arc<(Mutex<bool>, Condvar)>>,
    gate: Option<Arc<(Mutex<bool>, Condvar)>>,
}

impl FakeAdapter {
    fn available() -> Self {
        Self {
            languages: vec!["es-ES".into(), "en-US".into()],
            issues: Vec::new(),
            checks: AtomicUsize::new(0),
            failure: None,
            language_gate: None,
            gate: None,
        }
    }
}

impl PlatformAdapter for FakeAdapter {
    fn installed_languages(&self) -> Result<Vec<String>, AdapterError> {
        if let Some(gate) = &self.language_gate {
            let (lock, ready) = &**gate;
            let mut released = lock.lock().unwrap();
            while !*released {
                released = ready.wait(released).unwrap();
            }
        }
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
fn empty_text_honors_cancellation_during_capability_work() {
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let mut adapter = FakeAdapter::available();
    adapter.language_gate = Some(gate.clone());
    let boundary = Arc::new(Boundary::new(adapter));
    let worker_boundary = boundary.clone();
    let worker = thread::spawn(move || worker_boundary.check(request("empty-cancel", "")));
    while boundary.active_count() != 1 {
        thread::yield_now();
    }

    assert!(boundary.cancel("empty-cancel"));
    let (lock, ready) = &*gate;
    *lock.lock().unwrap() = true;
    ready.notify_all();

    assert!(matches!(
        worker.join().unwrap(),
        CheckResult::Cancelled { .. }
    ));
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
    let CheckResult::Completed { issues, .. } = boundary.check(request("utf16", "😀 wrngg wrngg"))
    else {
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
    assert!(matches!(
        Boundary::new(adapter).check(request("range", "short")),
        CheckResult::Failed {
            code: ErrorCode::AdapterFailure,
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
            code: ErrorCode::ApiUnavailable,
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
            code: ErrorCode::InvalidRequest,
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
    let boundary = Boundary::new(MacOsAdapter::default());
    for (language, fixture) in [
        (DocumentLanguage::English, "wrngg"),
        (DocumentLanguage::Spanish, "palabraa"),
    ] {
        match boundary.capability(language) {
            super::boundary::CapabilityResult::Available {
                selected_language_tag,
                ..
            } => {
                let mut check = request(language.base(), fixture);
                check.language = language;
                check.document_start = 0;
                let result = boundary.check(check);
                assert!(
                    matches!(result, CheckResult::Completed { ref issues, .. } if
                        issues.iter().any(|issue| issue.word == fixture && !issue.suggestions.is_empty())),
                    "{language:?} fixture lacked a ranged issue with suggestions: {result:?}"
                );
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
    let cancelled = Arc::new(AtomicBool::new(true));
    assert_eq!(
        MacOsAdapter::default().check("en-US", "wrngg", &cancelled),
        Err(AdapterError::Cancelled)
    );
}

#[cfg(windows)]
#[test]
fn windows_adapter_reports_capability_and_checks_known_bilingual_fixtures() {
    let boundary = Boundary::new(WindowsAdapter);
    for (language, fixture) in [
        (DocumentLanguage::English, "wrngg"),
        (DocumentLanguage::Spanish, "palabraa"),
    ] {
        match boundary.capability(language) {
            super::boundary::CapabilityResult::Available {
                selected_language_tag,
                ..
            } => {
                let mut check = request(language.base(), fixture);
                check.language = language;
                check.document_start = 0;
                let result = boundary.check(check);
                assert!(
                    matches!(result, CheckResult::Completed { ref issues, .. } if
                        issues.iter().any(|issue| issue.word == fixture && !issue.suggestions.is_empty())),
                    "{language:?} fixture lacked a ranged issue with suggestions: {result:?}"
                );
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
    let cancelled = Arc::new(AtomicBool::new(true));
    assert_eq!(
        WindowsAdapter.check("en-US", "wrngg", &cancelled),
        Err(AdapterError::Cancelled)
    );
}

#[test]
fn command_boundary_serializes_stable_results_without_native_details() {
    let mut adapter = FakeAdapter::available();
    adapter.failure = Some(AdapterError::Failure);
    let boundary = Boundary::new(adapter);
    assert_eq!(
        serde_json::to_value(capability_command(&boundary, DocumentLanguage::English)).unwrap(),
        serde_json::json!({
            "status": "unavailable",
            "language": "en",
            "reason": "api-unavailable"
        })
    );
    assert_eq!(
        serde_json::to_value(check_command(&boundary, request("command", "text"))).unwrap(),
        serde_json::json!({
            "status": "failed",
            "requestId": "command",
            "documentRevision": 4,
            "code": "adapter-failure"
        })
    );
    assert!(!cancel_command(&boundary, "command"));
}

#[test]
fn proof_report_has_fixed_contract_and_target_metadata() {
    let value = serde_json::to_value(run_host_proof()).unwrap();
    assert_eq!(value["contractVersion"], 1);
    assert_eq!(value["target"]["os"], std::env::consts::OS);
    assert_eq!(value["target"]["architecture"], std::env::consts::ARCH);
    assert!(value["target"]["osVersion"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
    assert_eq!(value["languages"].as_array().unwrap().len(), 2);
    assert!(!value.to_string().contains("wrngg"));
    assert!(!value.to_string().contains("palabraa"));
}
