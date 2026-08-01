use std::fs;
use std::path::Path;

fn main() {
    // tauri.conf.json declares "python-runtime" as a bundle resource, but that
    // directory is gitignored: it holds an embedded CPython produced by
    // studio/desktop/build-python-runtime.ps1, far too large to commit.
    // tauri_build::build() hard-fails when a declared resource path is missing,
    // so on a fresh clone even `cargo check` / `cargo test` -- which never
    // bundle anything -- died with "resource path `python-runtime` doesn't
    // exist". CI worked around it with its own mkdir; this makes the crate
    // build correctly on its own. A real packaged build runs the script first
    // and fills this directory with the actual runtime.
    let runtime = Path::new("python-runtime");
    if !runtime.exists() {
        if let Err(e) = fs::create_dir_all(runtime) {
            println!("cargo:warning=could not create python-runtime placeholder: {e}");
        }
    }

    tauri_build::build()
}
