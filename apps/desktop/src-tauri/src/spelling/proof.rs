use super::boundary::{
    Boundary, CapabilityResult, CheckRequest, CheckResult, DocumentLanguage, PlatformAdapter,
};
use super::commands::host_boundary;
use serde::Serialize;

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
    run_proof(host_boundary())
}

pub(crate) fn run_proof<A: PlatformAdapter>(boundary: Boundary<A>) -> ProofReport {
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

impl ProofReport {
    pub fn has_native_fixture_failure(&self) -> bool {
        self.languages.iter().any(|entry| {
            matches!(entry.capability, CapabilityResult::Available { .. })
                && entry.known_issue.is_none()
        })
    }
}

fn proof_language<A: PlatformAdapter>(
    boundary: &Boundary<A>,
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
