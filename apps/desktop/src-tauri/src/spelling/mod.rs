mod boundary;
pub(crate) mod commands;
#[cfg(feature = "spelling-ipc-test")]
mod ipc_test;
#[cfg(target_os = "macos")]
mod macos;
mod proof;
#[cfg(windows)]
mod windows;

pub(crate) use commands::SpellingState;
#[cfg(feature = "spelling-ipc-test")]
pub use ipc_test::run_ipc_test;
pub use proof::run_host_proof;

#[cfg(test)]
mod tests;
