mod error;
mod staging;
mod svn;
mod task;
mod workspace;

#[tauri::command]
fn ping() -> &'static str {
    "Rust 后端已连接"
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("启动 NovaSVN 失败");
}
