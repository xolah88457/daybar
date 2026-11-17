mod contracts;
mod features;
mod focus;
mod runtime;
mod sleep;
mod store;
mod validation;

use contracts::*;
use runtime::Backend;
use tauri::{Manager, State};

type CommandResult<T> = std::result::Result<T, String>;
#[tauri::command]
async fn get_snapshot(backend: State<'_, Backend>) -> CommandResult<Snapshot> {
    let store = backend.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.snapshot())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn mutate(
    backend: State<'_, Backend>,
    operation: Operation,
) -> CommandResult<MutationResult> {
    let store = backend.store.clone();
    let result = tauri::async_runtime::spawn_blocking(move || store.mutate(operation))
        .await
        .map_err(|e| e.to_string())?;
    backend.changed();
    result
}
#[tauri::command]
async fn set_preferences(
    app: tauri::AppHandle,
    backend: State<'_, Backend>,
    preferences: Preferences,
) -> CommandResult<Snapshot> {
    runtime::validate_shortcut(&preferences.global_shortcut)?;
    backend.store.check_preferences(&preferences)?;
    let old = backend.store.preferences()?;
    let requested = preferences.clone();
    runtime::apply_os_preferences(&app, &old, &preferences)?;
    let store = backend.store.clone();
    let result = tauri::async_runtime::spawn_blocking(move || store.set_preferences(preferences))
        .await
        .map_err(|e| e.to_string())?;
    if result.is_err() {
        let _ = runtime::apply_os_preferences(&app, &requested, &old);
    }
    backend.changed();
    result
}
#[tauri::command]
async fn resolve_conflict(
    backend: State<'_, Backend>,
    file: String,
    action: String,
) -> CommandResult<Snapshot> {
    let store = backend.store.clone();
    let result = tauri::async_runtime::spawn_blocking(move || store.resolve_conflict(file, action))
        .await
        .map_err(|e| e.to_string())?;
    backend.changed();
    result
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        runtime::toggle_focus(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            mutate,
            set_preferences,
            resolve_conflict,
            // Feature commands: each feature agent uncomments (or adds) ONLY its own line below.
            // Lines are kept apart by comments so parallel edits merge cleanly. A command is a
            // `#[tauri::command] pub async fn` in the feature's module under `features/`.
            //
            // features::export::export_history,
            //
            features::shortcuts::run_focus_shortcut,
            //
            features::radar::radar_status,
            features::radar::radar_request_access,
            features::radar::radar_calendars,
            features::radar::radar_items,
            //
            features::away::away_status,
            features::away::away_dismiss,
        ])
        .setup(|app| {
            let sandbox = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../..")
                    .canonicalize()?
                    .join(".dev-data")
            } else {
                app.path().app_local_data_dir()?.join(".dev-data")
            };
            let preferences = app.path().app_local_data_dir()?.join("preferences.json");
            let backend = runtime::start(
                app.handle().clone(),
                store::Store::open(sandbox, Some(preferences))?,
            )?;
            app.manage(backend);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error running Daybar");
}
