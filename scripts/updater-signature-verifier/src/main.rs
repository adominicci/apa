use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;
use std::{error::Error, fs, io, path::Path};

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn decode_tauri_text(value: &str, label: &str) -> Result<String, Box<dyn Error>> {
    let decoded = STANDARD
        .decode(value.trim())
        .map_err(|error| invalid_data(format!("invalid {label} base64: {error}")))?;
    String::from_utf8(decoded)
        .map_err(|error| invalid_data(format!("invalid {label} UTF-8: {error}")).into())
}

fn verify(
    archive_path: &Path,
    signature_path: &Path,
    config_path: &Path,
) -> Result<(), Box<dyn Error>> {
    let archive = fs::read(archive_path)?;
    if archive.is_empty() {
        return Err(invalid_data("updater archive is empty").into());
    }

    let signature_encoded = fs::read_to_string(signature_path)?;
    let config: Value = serde_json::from_str(&fs::read_to_string(config_path)?)?;
    let public_key_encoded = config
        .pointer("/plugins/updater/pubkey")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid_data("Tauri updater public key is missing"))?;

    let public_key = PublicKey::decode(&decode_tauri_text(public_key_encoded, "public key")?)?;
    let signature = Signature::decode(&decode_tauri_text(&signature_encoded, "signature")?)?;
    public_key.verify(&archive, &signature, true)?;
    Ok(())
}

fn main() {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() != 3 {
        eprintln!(
            "Updater signature verification failed: usage: tesina-updater-signature-verifier <archive> <signature> <tauri-config>"
        );
        std::process::exit(1);
    }

    if let Err(error) = verify(
        Path::new(&args[0]),
        Path::new(&args[1]),
        Path::new(&args[2]),
    ) {
        eprintln!("Updater signature verification failed: {error}");
        std::process::exit(1);
    }

    println!("Updater signature verified.");
}
