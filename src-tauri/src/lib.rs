mod files;
mod model;
mod panel;
mod provider;
mod subtitles;
#[cfg(test)]
mod tests;

use model::*;
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;
use tokio_util::sync::CancellationToken;

struct AppState {
    data: Mutex<AppData>,
    active: Mutex<Option<CancellationToken>>,
    pinned: AtomicBool,
    interacting: AtomicBool,
    panel: panel::PanelState,
}
fn save(app: &tauri::AppHandle, data: &AppData) -> Result<(), String> {
    let store = app
        .store("workspace.json")
        .map_err(|_| "无法读取本地资料库。")?;
    store.set(
        "workspace",
        serde_json::to_value(data).map_err(|_| "配置序列化失败。")?,
    );
    store
        .save()
        .map_err(|_| "无法保存资料库，请检查磁盘权限。".into())
}
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.harry6400.voicedock", "fish-api-key")
        .map_err(|_| "无法访问系统安全存储。".into())
}
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn api_key() -> Result<String, String> {
    key_entry()?
        .get_password()
        .map_err(|_| "尚未配置 API Key，或系统安全存储访问被拒绝，请打开设置。".into())
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn api_key() -> Result<String, String> {
    Err("当前平台尚未配置安全凭据存储。".into())
}
#[tauri::command]
fn key_status() -> bool {
    api_key().is_ok_and(|v| !v.is_empty())
}
#[tauri::command]
fn set_api_key(key: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        if key.trim().is_empty() {
            match key_entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err("无法删除安全凭据。".into()),
            }
        } else {
            key_entry()?
                .set_password(key.trim())
                .map_err(|_| "无法保存到系统安全存储。".into())
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = key;
        Err("该平台的安全存储尚未实现。".into())
    }
}
#[derive(serde::Serialize)]
struct ImportResult {
    voices: Vec<Voice>,
    warning: Option<String>,
}
#[tauri::command]
async fn import_voices(state: State<'_, AppState>) -> Result<ImportResult, String> {
    let proxy = state.data.lock().unwrap().proxy.clone();
    let key = api_key()?;
    let client = provider::client(&proxy)?;
    let mut voices = Vec::new();
    let mut warning = None;
    for page in 1..=20 {
        let response = client
            .get("https://api.fish.audio/model")
            .bearer_auth(&key)
            .query(&[
                ("self", "true"),
                ("page_size", "100"),
                ("page_number", &page.to_string()),
            ])
            .send()
            .await
            .map_err(|_| "读取账号音色失败，请检查网络或代理。")?;
        if !response.status().is_success() {
            return Err(provider::status_error(response.status()));
        }
        let body: serde_json::Value = response.json().await.map_err(|_| "音色列表格式无效。")?;
        let items = body["items"].as_array().ok_or("音色列表缺少 items。")?;
        for item in items {
            let Some(id) = item["_id"].as_str() else {
                continue;
            };
            let voice = Voice {
                id: id.into(),
                name: item["title"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("未命名音色")
                    .chars()
                    .take(80)
                    .collect(),
                provider: "fish".into(),
                description: item["description"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(200)
                    .collect(),
                favorite: false,
                tags: item["tags"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                last_used: None,
                preview_text: item["default_text"]
                    .as_str()
                    .unwrap_or("你好，欢迎来到我的声音工作台。")
                    .into(),
            };
            if validate_voice(&voice).is_ok() {
                voices.push(voice);
            }
        }
        if body["window_limited"].as_bool() == Some(true) {
            warning = Some("Fish 返回的音色列表有窗口限制，已导入可访问部分。".into());
            break;
        }
        let has_more = body["has_more"].as_bool().unwrap_or(items.len() == 100);
        if !has_more {
            break;
        }
        if page == 20 {
            warning = Some("单次最多导入 2,000 个音色；账号仍有更多音色，当前结果不完整。".into());
        }
    }
    Ok(ImportResult { voices, warning })
}
#[tauri::command]
fn load_data(state: State<AppState>) -> AppData {
    state.data.lock().unwrap().clone()
}
#[tauri::command]
fn shortcut_status(app: tauri::AppHandle, state: State<AppState>) -> bool {
    state
        .data
        .lock()
        .unwrap()
        .shortcut
        .parse::<Shortcut>()
        .is_ok_and(|s| app.global_shortcut().is_registered(s))
}
fn register_shortcut(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
    let shortcut: Shortcut = value
        .parse()
        .map_err(|_| "快捷键格式无效，例如 Alt+Super+KeyG。")?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                toggle_panel(app);
            }
        })
        .map_err(|_| "快捷键被占用或无法注册，请选择其他组合。".to_string())
}
#[tauri::command]
fn save_data(
    app: tauri::AppHandle,
    state: State<AppState>,
    mut data: AppData,
) -> Result<(), String> {
    for v in &data.voices {
        validate_voice(v)?;
    }
    let mut ids = std::collections::HashSet::new();
    if data.voices.iter().any(|v| !ids.insert(&v.id)) {
        return Err("音色 ID 重复。".into());
    }
    let mut current = state.data.lock().unwrap();
    if data.proxy != current.proxy {
        provider::client(&data.proxy)?;
    }
    for v in &mut data.voices {
        if let Some(old) = current.voices.iter().find(|w| w.id == v.id) {
            v.last_used = old.last_used.clone();
        }
    }
    let shortcut_changed = data.shortcut != current.shortcut;
    if shortcut_changed {
        register_shortcut(&app, &data.shortcut)?;
    }
    data.history = current.history.clone(); // A draft save cannot overwrite a newly finished generation.
    if let Err(error) = save(&app, &data) {
        if shortcut_changed {
            if let Ok(new) = data.shortcut.parse::<Shortcut>() {
                let _ = app.global_shortcut().unregister(new);
            }
        }
        return Err(error);
    }
    if shortcut_changed {
        if let Ok(old) = current.shortcut.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(old);
        }
    }
    *current = data;
    Ok(())
}
#[tauri::command]
fn set_interacting(state: State<AppState>, value: bool) {
    state.interacting.store(value, Ordering::SeqCst);
}
#[tauri::command]
fn hide_panel(app: tauri::AppHandle) {
    conceal_panel(&app);
}
fn conceal_panel(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.panel.invalidate();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}
#[tauri::command]
fn pin_panel(app: tauri::AppHandle, state: State<AppState>, value: bool) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("窗口不存在。")?;
    w.set_always_on_top(value)
        .map_err(|_| "无法调整置顶状态。")?;
    w.set_resizable(value).map_err(|_| "无法调整窗口大小。")?;
    state.pinned.store(value, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
fn cancel_generation(state: State<AppState>) {
    if let Some(c) = state.active.lock().unwrap().as_ref() {
        c.cancel();
    }
}
struct ActiveGuard<'a>(&'a Mutex<Option<CancellationToken>>);
impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        *self.0.lock().unwrap() = None;
    }
}
#[tauri::command]
async fn generate(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: String,
    options: Options,
    filename: String,
    preview: bool,
    paid_confirmed: bool,
) -> Result<Record, String> {
    let cancel = CancellationToken::new();
    {
        let mut active = state.active.lock().unwrap();
        if active.is_some() {
            return Err("已有合成正在进行，请等待或取消。".into());
        }
        *active = Some(cancel.clone());
    }
    let _guard = ActiveGuard(&state.active);
    let snapshot = state.data.lock().unwrap().clone();
    let mut options = options;
    if preview {
        options.subtitles = false;
        options.format = "mp3".into();
    }
    let body = request_body(&text, &options, &snapshot.voices)?;
    if !preview {
        if !Path::new(&options.output_dir).is_dir() {
            return Err("保存目录不存在，请先选择有效目录。".into());
        }
        let _probe = tempfile::NamedTempFile::new_in(&options.output_dir)
            .map_err(|_| "保存目录不可写，请先更改目录；尚未调用 API。")?;
    }
    if options.model != "s2.1-pro-free" && !paid_confirmed {
        return Err("该模型会计费，请先确认本次调用。".into());
    }
    let voice = snapshot
        .voices
        .iter()
        .find(|v| v.id == options.voice_id)
        .unwrap();
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "无法获取缓存目录。")?;
    std::fs::create_dir_all(&cache_dir).map_err(|_| "缓存目录不可写。")?;
    let digest = format!(
        "{:x}",
        Sha256::digest(format!("{}:{}", options.model, body).as_bytes())
    );
    let cache_path = cache_dir.join(format!("{digest}.mp3"));
    let (audio, duration, srt, warning) = if preview && cache_path.exists() {
        let audio = std::fs::read(&cache_path).map_err(|_| "试听缓存读取失败。")?;
        let duration = files::validate_audio(&audio, "mp3")?;
        (audio, duration, None, None)
    } else {
        let key = api_key()?;
        let client = provider::client(&snapshot.proxy)?;
        let endpoint = if options.subtitles {
            "https://api.fish.audio/v1/tts/stream/with-timestamp"
        } else {
            "https://api.fish.audio/v1/tts"
        };
        let collector = provider::synthesize(
            &client,
            endpoint,
            &key,
            &options.model,
            &body,
            options.subtitles,
            cancel.clone(),
            |s| {
                let _ = app.emit("generation-status", s);
            },
        )
        .await?;
        let _ = app.emit("generation-status", "正在校验音频并保存…");
        let duration = files::validate_audio(&collector.audio, &options.format)?;
        let (srt, warning) = if options.subtitles {
            match collector.srt(&text, duration) {
                Ok(s) => (Some(s), None),
                Err(e) => (None, Some(e)),
            }
        } else {
            (None, None)
        };
        (collector.audio, duration, srt, warning)
    };
    if cancel.is_cancelled() {
        return Err("已取消。".into());
    }
    let date = chrono::Local::now();
    let mut record = if preview {
        if !cache_path.exists() {
            files::write_atomic(&cache_path, &audio)?;
        }
        Record {
            id: digest,
            text,
            voice_name: voice.name.clone(),
            voice_id: voice.id.clone(),
            model: options.model,
            created_at: date.to_rfc3339(),
            audio_path: cache_path.to_string_lossy().into(),
            srt_path: None,
            txt_path: String::new(),
            format: "mp3".into(),
            duration,
            warning,
        }
    } else {
        let title: String = subtitles::clean_text(&text).chars().take(12).collect();
        let base = if filename.trim().is_empty() {
            options
                .name_template
                .replace("{date}", &date.format("%Y%m%d_%H%M%S").to_string())
                .replace("{voice}", &voice.name)
                .replace("{title}", &title)
        } else {
            filename
        };
        let output = files::export(
            Path::new(&options.output_dir),
            &base,
            &options.format,
            &audio,
            srt.as_deref(),
            &subtitles::clean_text(&text),
        )?;
        Record {
            id: date.timestamp_micros().to_string(),
            text,
            voice_name: voice.name.clone(),
            voice_id: voice.id.clone(),
            model: options.model,
            created_at: date.to_rfc3339(),
            audio_path: output.audio.to_string_lossy().into(),
            srt_path: output.srt.map(|p| p.to_string_lossy().into()),
            txt_path: output.txt.to_string_lossy().into(),
            format: options.format,
            duration,
            warning,
        }
    };
    let mut data = state.data.lock().unwrap();
    if !preview {
        data.history.insert(0, record.clone());
        data.history.truncate(200);
    }
    if let Some(v) = data.voices.iter_mut().find(|v| v.id == record.voice_id) {
        v.last_used = Some(date.to_rfc3339());
    }
    if save(&app, &data).is_err() {
        record.warning = Some(format!(
            "{}音频已保存到 {}，但本地历史写入失败，请检查磁盘权限。",
            record.warning.as_deref().unwrap_or(""),
            record.audio_path
        ));
    }
    Ok(record)
}
fn authorized_path(app: &tauri::AppHandle, data: &AppData, path: &str) -> bool {
    if data.history.iter().any(|r| r.audio_path == path) {
        return true;
    }
    let Ok(cache) = app.path().app_cache_dir() else {
        return false;
    };
    Path::new(path).parent() == Some(cache.as_path())
        && Path::new(path).extension().is_some_and(|e| e == "mp3")
        && Path::new(path).file_stem().is_some_and(|s| {
            s.to_string_lossy().len() == 64
                && s.to_string_lossy().chars().all(|c| c.is_ascii_hexdigit())
        })
}
#[tauri::command]
fn read_audio(
    app: tauri::AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if !authorized_path(&app, &state.data.lock().unwrap(), &path) {
        return Err("只能读取本应用生成的音频。".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "音频文件不存在或不可读。")?;
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
fn reveal_audio(app: tauri::AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    if !authorized_path(&app, &state.data.lock().unwrap(), &path) {
        return Err("无效文件路径。".into());
    }
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|_| "无法在文件管理器中定位。".into())
}
#[tauri::command]
fn reexport(
    state: State<AppState>,
    id: String,
    directory: String,
    filename: String,
) -> Result<String, String> {
    let data = state.data.lock().unwrap();
    let r = data
        .history
        .iter()
        .find(|r| r.id == id)
        .ok_or("历史记录不存在。")?;
    let audio = std::fs::read(&r.audio_path).map_err(|_| "原音频不存在。")?;
    files::validate_audio(&audio, &r.format)?;
    let srt = match &r.srt_path {
        Some(p) => Some(std::fs::read_to_string(p).map_err(|_| "原字幕不存在，无法完整导出。")?),
        None => None,
    };
    let output = files::export(
        Path::new(&directory),
        &filename,
        &r.format,
        &audio,
        srt.as_deref(),
        &subtitles::clean_text(&r.text),
    )?;
    Ok(output.audio.to_string_lossy().into())
}
fn toggle_panel(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        conceal_panel(app);
    } else {
        show_panel(app, None);
    }
}
fn show_panel(app: &tauri::AppHandle, anchor: Option<tauri::PhysicalPosition<f64>>) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    if let Some(state) = app.try_state::<AppState>() {
        state.panel.invalidate();
    }
    // macOS cursor positions use the primary display's physical scale. Work
    // areas use each display's scale; normalize both to logical screen points.
    // Avoid monitor_from_point here: its macOS backend compares with CGDisplay
    // bounds in logical points despite the physical-position API surface.
    let primary = w.primary_monitor().ok().flatten();
    let primary_scale = primary.as_ref().map_or(1., |m| m.scale_factor());
    let pointer = w
        .cursor_position()
        .ok()
        .map(|p| p.to_logical::<f64>(primary_scale));
    let monitor = w
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let Some(p) = pointer else { return false };
                let origin = m.position().to_logical::<f64>(m.scale_factor());
                let size = m.size().to_logical::<f64>(m.scale_factor());
                p.x >= origin.x
                    && p.x < origin.x + size.width
                    && p.y >= origin.y
                    && p.y < origin.y + size.height
            })
        })
        .or_else(|| w.current_monitor().ok().flatten())
        .or(primary);
    if let Some(m) = monitor {
        let area_position = m.work_area().position.to_logical::<f64>(m.scale_factor());
        let area_size = m.work_area().size.to_logical::<f64>(m.scale_factor());
        let window_scale = w.scale_factor().unwrap_or(m.scale_factor());
        let mut size = w
            .outer_size()
            .map(|s| s.to_logical::<f64>(window_scale))
            .unwrap_or(tauri::LogicalSize::new(500., 690.));
        if size.width > area_size.width || size.height > area_size.height {
            size = tauri::LogicalSize::new(
                size.width.min(area_size.width),
                size.height.min(area_size.height),
            );
            let _ = w.set_size(size);
        }
        let wanted_x = pointer
            .map(|p| p.x - size.width / 2.)
            .unwrap_or(area_position.x + (area_size.width - size.width) / 2.);
        let wanted_y = if anchor.is_some() {
            pointer.map_or(area_position.y + 12., |p| p.y + 12.)
        } else {
            area_position.y + 12.
        };
        let (x, y) = panel::clamped_origin(
            (
                area_position.x,
                area_position.y,
                area_size.width,
                area_size.height,
            ),
            (size.width, size.height),
            (wanted_x, wanted_y),
        );
        let _ = w.set_position(tauri::LogicalPosition::new(x, y));
    }
    // Showing a window does not unhide its accessory application on macOS.
    #[cfg(target_os = "macos")]
    let _ = app.show();
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
}

fn defer_auto_hide(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let revision = state.panel.invalidate();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Let the native status-bar/menu focus handoff finish, then inspect the
        // actual current focus instead of acting on a possibly stale event.
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(state) = handle.try_state::<AppState>() else {
                return;
            };
            if !state.panel.is_current(revision)
                || state.pinned.load(Ordering::SeqCst)
                || state.interacting.load(Ordering::SeqCst)
            {
                return;
            }
            if let Some(w) = handle.get_webview_window("main") {
                if w.is_visible().unwrap_or(false) && !w.is_focused().unwrap_or(true) {
                    conceal_panel(&handle);
                }
            }
        });
    });
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_panel(app, None);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let default_dir = app
                .path()
                .audio_dir()
                .or_else(|_| app.path().document_dir())?
                .to_string_lossy()
                .into();
            let store = app.store("workspace.json")?;
            let data = match store.get("workspace") {
                Some(v) => serde_json::from_value(v)?,
                None => AppData::fresh(default_dir),
            };
            if register_shortcut(app.handle(), &data.shortcut).is_err() {
                let _ = app.emit("generation-status", "全局快捷键注册失败，请在设置中修改。");
            }
            app.manage(AppState {
                data: Mutex::new(data),
                active: Mutex::new(None),
                pinned: AtomicBool::new(false),
                interacting: AtomicBool::new(false),
                panel: panel::PanelState::default(),
            });
            let open = MenuItem::with_id(app, "open", "打开 VoiceDock", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 VoiceDock", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &settings, &quit])?;
            TrayIconBuilder::new()
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray.png"
                ))?)
                .icon_as_template(true)
                .tooltip("VoiceDock")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "open" => show_panel(app, None),
                    "settings" => {
                        show_panel(app, None);
                        let _ = app.emit("open-settings", ());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state,
                        position,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let state = app.state::<AppState>();
                        match button_state {
                            MouseButtonState::Down => {
                                let visible = app
                                    .get_webview_window("main")
                                    .is_some_and(|w| w.is_visible().unwrap_or(false));
                                state.panel.tray_pressed(visible);
                            }
                            MouseButtonState::Up => {
                                let visible = app
                                    .get_webview_window("main")
                                    .is_some_and(|w| w.is_visible().unwrap_or(false));
                                if state.panel.tray_released_should_hide(visible) {
                                    conceal_panel(app);
                                } else {
                                    show_panel(app, Some(position));
                                }
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|w, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                conceal_panel(w.app_handle());
            }
            tauri::WindowEvent::Focused(true) => {
                if let Some(s) = w.try_state::<AppState>() {
                    s.panel.invalidate();
                }
            }
            tauri::WindowEvent::Focused(false) => {
                defer_auto_hide(w.app_handle());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            key_status,
            set_api_key,
            import_voices,
            load_data,
            shortcut_status,
            save_data,
            hide_panel,
            pin_panel,
            set_interacting,
            cancel_generation,
            generate,
            read_audio,
            reveal_audio,
            reexport
        ])
        .build(tauri::generate_context!())
        .expect("VoiceDock could not start")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_panel(app, None);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
