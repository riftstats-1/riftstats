use tauri::Manager;

/// Paints the Windows title bar in the Rift colors so it blends with the app.
/// Works on Windows 11; Windows 10 ignores it and keeps the dark theme from tauri.conf.json.
#[cfg(windows)]
fn style_title_bar(window: &tauri::WebviewWindow) {
    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(hwnd: isize, attr: u32, value: *const u32, size: u32) -> i32;
    }

    // Colors are 0x00BBGGRR
    const BORDER: (u32, u32) = (34, 0x0047_361F); // --rift-line #1f3647
    const CAPTION: (u32, u32) = (35, 0x001A_1107); // --rift-deep #07111a
    const TEXT: (u32, u32) = (36, 0x00F1_ECE3); // --foam    #e3ecf1

    if let Ok(hwnd) = window.hwnd() {
        for (attr, color) in [BORDER, CAPTION, TEXT] {
            unsafe {
                DwmSetWindowAttribute(hwnd.0 as isize, attr, &color, 4);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                style_title_bar(&window);
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}