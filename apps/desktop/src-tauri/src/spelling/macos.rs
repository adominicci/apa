use super::boundary::{AdapterError, NativeIssue, PlatformAdapter};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub(crate) struct MacOsAdapter {
    app: Option<tauri::AppHandle>,
}

impl Default for MacOsAdapter {
    fn default() -> Self {
        Self { app: None }
    }
}

impl MacOsAdapter {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
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

impl PlatformAdapter for MacOsAdapter {
    fn installed_languages(&self) -> Result<Vec<String>, AdapterError> {
        self.on_main_thread(installed_languages)
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
        self.on_main_thread(move || check_text(&language_tag, &text, &cancelled))
    }
}

fn installed_languages() -> Result<Vec<String>, AdapterError> {
    use objc2_app_kit::NSSpellChecker;

    let checker = NSSpellChecker::sharedSpellChecker();
    let languages = checker.availableLanguages();
    Ok((0..languages.count())
        .map(|index| languages.objectAtIndex(index).to_string())
        .collect())
}

fn check_text(
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
        // SAFETY: the optional word-count pointer is null and the referenced
        // Objective-C arguments remain alive for the call.
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
