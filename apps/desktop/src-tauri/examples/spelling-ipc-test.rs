use std::io::{BufRead, Write};

fn main() {
    let harness =
        tesina_lib::spelling::IpcTestHarness::new().expect("IPC test harness must initialize");
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for input in stdin.lock().lines() {
        match harness.invoke(&input.expect("IPC test input must be readable")) {
            Ok(response) => {
                writeln!(stdout, "{response}").expect("IPC response must be writable");
                stdout.flush().expect("IPC response must flush");
            }
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
    }
}
