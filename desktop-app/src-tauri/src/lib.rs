// The native side of the desktop app. Printers, the cash drawer, scanners and the offline store are added here in later steps.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the desktop app");
}
