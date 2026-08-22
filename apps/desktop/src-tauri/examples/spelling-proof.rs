fn main() {
    let report = tesina_lib::spelling::run_host_proof();
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("spelling proof must serialize")
    );
}
