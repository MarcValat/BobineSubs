fn main() {
    // Explicit rather than tauri.conf.json's build.windows.staticVCRuntime:
    // the CLI actually shipped with this project (2.11.5) rejects that
    // field with a hard schema error ("Additional properties are not
    // allowed ('windows' was unexpected)") even though tauri-build 2.7.0's
    // own deprecation message recommends it -- a real version skew between
    // tauri's sub-crates, confirmed by hitting the error on a real CI run.
    // This Rust-side API isn't subject to that JSON schema check at all.
    //
    // This doesn't silence tauri-build's "STATIC_VCRUNTIME is deprecated"
    // warning, though -- confirmed that's unrelated to this file or to
    // tauri.conf.json: it appears when building via `tauri build`/`tauri
    // dev` (the CLI) but not via a plain `cargo check`, so the CLI itself
    // must be setting that env var internally (likely its own
    // backward-compat bridge, since its schema doesn't support the new
    // field yet either). Nothing left to fix from this side; harmless.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new().static_vc_runtime(true)),
    )
    .expect("failed to run tauri-build");
}
