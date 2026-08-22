use super::boundary::{AdapterError, NativeIssue, PlatformAdapter};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub(crate) struct WindowsAdapter;

impl Default for WindowsAdapter {
    fn default() -> Self {
        Self
    }
}

struct ComApartment;

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

impl Drop for ComApartment {
    fn drop(&mut self) {
        // SAFETY: this runs on the same operation thread that initialized COM.
        unsafe { windows::Win32::System::Com::CoUninitialize() };
    }
}

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
                suggestions: collect_enum_strings(&suggestions, Some(cancelled.as_ref()))?,
            });
        }
        Ok(result)
    }
}
