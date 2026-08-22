mod boundary;
pub(crate) mod commands;
#[cfg(target_os = "macos")]
mod macos;
mod proof;
#[cfg(windows)]
mod windows;

pub(crate) use commands::SpellingState;
pub use proof::run_host_proof;

#[cfg(test)]
mod tests;
