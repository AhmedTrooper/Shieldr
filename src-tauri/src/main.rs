// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Install a panic hook so any uncaught panic is logged with a clear
    // banner to stderr before the process aborts. Without this, panics
    // print a long backtrace but no human-readable summary, which makes
    // diagnosing WebKit/Gdk-induced crashes harder.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("\n=== SHIELDR PANIC ===");
        eprintln!("Location: {info}");
        eprintln!("=====================\n");
    }));

    shieldr_lib::run()
}
