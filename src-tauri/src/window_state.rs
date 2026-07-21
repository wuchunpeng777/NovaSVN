use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent};

const MIN_VISIBLE_EDGE: i64 = 64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
struct WindowGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

#[derive(Debug, Clone, Copy)]
struct ScreenRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

pub fn surface_name(action: Option<&str>) -> &'static str {
    match action {
        Some("blame") => "blame",
        Some("commit") => "commit",
        Some("log") => "log",
        Some("update") => "update",
        _ => "main",
    }
}

pub fn restore_and_track<R: Runtime>(
    window: &WebviewWindow<R>,
    app_data_dir: &Path,
    surface: &'static str,
) -> bool {
    let state_path = state_path(app_data_dir, surface);
    let restored = read_geometry(&state_path)
        .filter(|geometry| geometry.width > 0 && geometry.height > 0)
        .filter(|geometry| geometry_is_visible_on_current_monitors(window, geometry))
        .inspect(|geometry| {
            let _ = window.set_size(PhysicalSize::new(geometry.width, geometry.height));
            let _ = window.set_position(PhysicalPosition::new(geometry.x, geometry.y));
            if geometry.maximized {
                let _ = window.maximize();
            }
        });

    let initial = restored
        .or_else(|| capture_geometry(window))
        .unwrap_or(WindowGeometry {
            x: 0,
            y: 0,
            width: 1120,
            height: 760,
            maximized: false,
        });
    track_window(window, state_path, initial);
    restored.is_some()
}

fn track_window<R: Runtime>(
    window: &WebviewWindow<R>,
    state_path: PathBuf,
    initial: WindowGeometry,
) {
    let geometry = Arc::new(Mutex::new(initial));
    let tracked_window = window.clone();
    window.on_window_event(move |event| {
        let maximized = tracked_window.is_maximized().unwrap_or(false);
        if let Ok(mut current) = geometry.lock() {
            current.maximized = maximized;
            if !maximized {
                match event {
                    WindowEvent::Moved(position) => {
                        current.x = position.x;
                        current.y = position.y;
                    }
                    WindowEvent::Resized(size) => {
                        current.width = size.width;
                        current.height = size.height;
                    }
                    WindowEvent::ScaleFactorChanged { new_inner_size, .. } => {
                        current.width = new_inner_size.width;
                        current.height = new_inner_size.height;
                    }
                    _ => {}
                }
            }

            if matches!(
                event,
                WindowEvent::Focused(false) | WindowEvent::CloseRequested { .. }
            ) {
                if let Err(error) = write_geometry(&state_path, *current) {
                    eprintln!("[NovaSVN] 保存窗口状态失败：{error}");
                }
            }
        }
    });
}

fn capture_geometry<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowGeometry> {
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(WindowGeometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: window.is_maximized().unwrap_or(false),
    })
}

fn geometry_is_visible_on_current_monitors<R: Runtime>(
    window: &WebviewWindow<R>,
    geometry: &WindowGeometry,
) -> bool {
    window
        .available_monitors()
        .map(|monitors| {
            monitors.iter().any(|monitor| {
                geometry_overlaps_screen(
                    geometry,
                    ScreenRect {
                        x: monitor.position().x,
                        y: monitor.position().y,
                        width: monitor.size().width,
                        height: monitor.size().height,
                    },
                )
            })
        })
        .unwrap_or(false)
}

fn geometry_overlaps_screen(geometry: &WindowGeometry, screen: ScreenRect) -> bool {
    let left = i64::from(geometry.x).max(i64::from(screen.x));
    let top = i64::from(geometry.y).max(i64::from(screen.y));
    let right = (i64::from(geometry.x) + i64::from(geometry.width))
        .min(i64::from(screen.x) + i64::from(screen.width));
    let bottom = (i64::from(geometry.y) + i64::from(geometry.height))
        .min(i64::from(screen.y) + i64::from(screen.height));

    right - left >= MIN_VISIBLE_EDGE && bottom - top >= MIN_VISIBLE_EDGE
}

fn state_path(app_data_dir: &Path, surface: &str) -> PathBuf {
    app_data_dir
        .join("window-state")
        .join(format!("{surface}.json"))
}

fn read_geometry(path: &Path) -> Option<WindowGeometry> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_geometry(path: &Path, geometry: WindowGeometry) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "窗口状态路径缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(&geometry).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{geometry_overlaps_screen, surface_name, ScreenRect, WindowGeometry};

    #[test]
    fn keeps_each_startup_surface_in_a_separate_state_slot() {
        assert_eq!(surface_name(None), "main");
        assert_eq!(surface_name(Some("commit")), "commit");
        assert_eq!(surface_name(Some("log")), "log");
        assert_eq!(surface_name(Some("unknown")), "main");
    }

    #[test]
    fn rejects_positions_that_are_no_longer_visible() {
        let screen = ScreenRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let visible = WindowGeometry {
            x: 1880,
            y: 100,
            width: 200,
            height: 200,
            maximized: false,
        };
        let hidden = WindowGeometry {
            x: 2000,
            y: 100,
            width: 800,
            height: 600,
            maximized: false,
        };

        assert!(!geometry_overlaps_screen(&visible, screen));
        assert!(!geometry_overlaps_screen(&hidden, screen));

        let visible = WindowGeometry { x: 1850, ..visible };
        assert!(geometry_overlaps_screen(&visible, screen));
    }
}
