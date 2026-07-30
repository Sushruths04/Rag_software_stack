use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

mod sidecar;

// Menu item IDs double as the event name emitted to the frontend. The
// frontend listens for these via @tauri-apps/api/event and dispatches to
// the SAME handlers the toolbar buttons already call (see
// core-ui/src/state/useDesktopMenuCommands.ts) so there is one command
// path, not two.
const MENU_NEW_PROJECT: &str = "menu://new-project";
const MENU_NEW_SESSION: &str = "menu://new-session";
const MENU_OPEN_PROJECT: &str = "menu://open-project";
const MENU_SAVE: &str = "menu://save";
const MENU_RUN: &str = "menu://run";
const MENU_CANCEL_RUN: &str = "menu://cancel-run";
const MENU_TOGGLE_CONSOLE: &str = "menu://toggle-console";
const MENU_TOGGLE_MINIMAP: &str = "menu://toggle-minimap";
const MENU_FIT_VIEW: &str = "menu://fit-view";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(sidecar::SidecarState(Mutex::new(None)))
    .manage(sidecar::SidecarStatusState(Mutex::new(serde_json::json!({ "status": "starting" }))));
  // B-M7: the Windows Job Object that ties the sidecar's lifetime to this
  // process (see sidecar::assign_to_job) -- only meaningful on Windows,
  // the only platform this app actually packages for.
  #[cfg(windows)]
  let builder = builder.manage(sidecar::SidecarJobState(Mutex::new(None)));

  builder
    .invoke_handler(tauri::generate_handler![sidecar::get_sidecar_status])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // B-M2: spawn the Python backend automatically instead of requiring
      // a second terminal running `uvicorn` by hand.
      sidecar::spawn(&app.handle().clone());

      let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
          &MenuItem::with_id(app, MENU_NEW_PROJECT, "New Project...", true, Some("CmdOrCtrl+Shift+N"))?,
          &MenuItem::with_id(app, MENU_OPEN_PROJECT, "Open Project...", true, Some("CmdOrCtrl+O"))?,
          &PredefinedMenuItem::separator(app)?,
          &MenuItem::with_id(app, MENU_NEW_SESSION, "New Session", true, Some("CmdOrCtrl+N"))?,
          &MenuItem::with_id(app, MENU_SAVE, "Save", true, Some("CmdOrCtrl+S"))?,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::quit(app, None)?,
        ],
      )?;

      let run_menu = Submenu::with_items(
        app,
        "Run",
        true,
        &[
          &MenuItem::with_id(app, MENU_RUN, "Run Graph", true, Some("CmdOrCtrl+Enter"))?,
          &MenuItem::with_id(app, MENU_CANCEL_RUN, "Cancel", true, None::<&str>)?,
        ],
      )?;

      let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
          &MenuItem::with_id(app, MENU_TOGGLE_CONSOLE, "Toggle Console", true, None::<&str>)?,
          &MenuItem::with_id(app, MENU_TOGGLE_MINIMAP, "Toggle Minimap", true, None::<&str>)?,
          &MenuItem::with_id(app, MENU_FIT_VIEW, "Fit View", true, Some("F"))?,
        ],
      )?;

      let menu = Menu::with_items(app, &[&file_menu, &run_menu, &view_menu])?;
      app.set_menu(menu)?;

      app.on_menu_event(move |app_handle, event| {
        let id = event.id().0.as_str();
        if matches!(
          id,
          MENU_NEW_PROJECT
            | MENU_NEW_SESSION
            | MENU_OPEN_PROJECT
            | MENU_SAVE
            | MENU_RUN
            | MENU_CANCEL_RUN
            | MENU_TOGGLE_CONSOLE
            | MENU_TOGGLE_MINIMAP
            | MENU_FIT_VIEW
        ) {
          let _ = app_handle.emit(id, ());
        }
      });

      Ok(())
    })
    .on_window_event(|window, event| {
      // B-M2: kill the spawned engine process on close so quitting never
      // leaves an orphan uvicorn behind.
      if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
        sidecar::shutdown(window.app_handle());
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
