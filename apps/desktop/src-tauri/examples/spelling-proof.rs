fn main() {
    let report = tesina_lib::spelling::run_host_proof();
    let fixture_failed = report.has_native_fixture_failure();
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("spelling proof must serialize")
    );
    if fixture_failed {
        std::process::exit(1);
    }
}
