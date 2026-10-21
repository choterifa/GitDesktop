//! The macOS application menu. Windows and Linux ship none on purpose — the
//! in-window repo dropdown is the idiom there — so everything but the
//! `set_recent_repos_menu` IPC contract and language enum are shared with the
//! tray; the full application menu remains macOS-only.
//! Our items carry no keyboard shortcuts: the app's hotkeys are rebindable in
//! settings, while a menu shortcut is static and intercepts the chord before
//! the webview, so it would both lie about and steal a rebound binding.
// Off macOS only the command twin is live; the id table and its classifier stay
// compiled (and unit-tested) on every host so the wire strings can't drift.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Deserialize;

#[cfg(target_os = "macos")]
use crate::error::AppError;
use crate::error::AppResult;
#[cfg(target_os = "macos")]
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::menu::{
    AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Emitter, Manager, State, Wry};

/// One row of File → Open Recent. Plain shape, single-word fields: the frontend
/// sends `{ label, path }` verbatim.
#[derive(Clone, Deserialize)]
pub struct RecentMenuEntry {
    pub label: String,
    pub path: String,
}

const ID_NEW_REPO: &str = "gd-menu-new-repo";
const ID_OPEN_REPO: &str = "gd-menu-open-repo";
const ID_CLONE_REPO: &str = "gd-menu-clone-repo";
const ID_SETTINGS: &str = "gd-menu-settings";
/// Recents items encode their repo path in the id, so a click needs no lookup
/// table and can't read a stale row after a concurrent submenu rebuild.
const ID_RECENT_PREFIX: &str = "gd-menu-recent:";
const ID_RECENT_EMPTY: &str = "gd-menu-recent-empty";

/// The two UI locales supported by the app. Kept here so macOS menu and the
/// cross-platform tray share one parsing/defaulting rule without depending on
/// the frontend's catalog implementation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeLanguage {
    Spanish,
    English,
}

impl NativeLanguage {
    pub(crate) fn parse(code: &str) -> Option<Self> {
        match code {
            "es-MX" => Some(Self::Spanish),
            "en" => Some(Self::English),
            _ => None,
        }
    }

    pub(crate) fn from_code(code: &str) -> Self {
        Self::parse(code).unwrap_or(Self::Spanish)
    }

    pub(crate) fn tray_open(self, app_name: &str) -> String {
        match self {
            Self::Spanish => format!("Abrir {app_name}"),
            Self::English => format!("Open {app_name}"),
        }
    }

    pub(crate) fn tray_quit(self) -> &'static str {
        match self {
            Self::Spanish => "Salir",
            Self::English => "Quit",
        }
    }

    #[cfg(target_os = "macos")]
    fn labels(self) -> MenuLabels {
        match self {
            Self::Spanish => MenuLabels {
                about: "Acerca de GitDesktop",
                services: "Servicios",
                hide: "Ocultar GitDesktop",
                hide_others: "Ocultar otras",
                show_all: "Mostrar todo",
                quit: "Salir de GitDesktop",
                file: "Archivo",
                new_repository: "Nuevo repositorio…",
                open_repository: "Abrir repositorio…",
                clone_repository: "Clonar repositorio…",
                open_recent: "Repositorios recientes",
                no_recent: "No hay repositorios recientes",
                close_window: "Cerrar ventana",
                edit: "Editar",
                view: "Ver",
                fullscreen: "Pantalla completa",
                window: "Ventana",
                minimize: "Minimizar",
                maximize: "Maximizar",
                help: "Ayuda",
            },
            Self::English => MenuLabels {
                about: "About GitDesktop",
                services: "Services",
                hide: "Hide GitDesktop",
                hide_others: "Hide Others",
                show_all: "Show All",
                quit: "Quit GitDesktop",
                file: "File",
                new_repository: "New Repository…",
                open_repository: "Open Repository…",
                clone_repository: "Clone Repository…",
                open_recent: "Open Recent",
                no_recent: "No Recent Repositories",
                close_window: "Close Window",
                edit: "Edit",
                view: "View",
                fullscreen: "Enter Full Screen",
                window: "Window",
                minimize: "Minimize",
                maximize: "Zoom",
                help: "Help",
            },
        }
    }
}

#[cfg(target_os = "macos")]
struct MenuLabels {
    about: &'static str,
    services: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    file: &'static str,
    new_repository: &'static str,
    open_repository: &'static str,
    clone_repository: &'static str,
    open_recent: &'static str,
    no_recent: &'static str,
    close_window: &'static str,
    edit: &'static str,
    view: &'static str,
    fullscreen: &'static str,
    window: &'static str,
    minimize: &'static str,
    maximize: &'static str,
    help: &'static str,
}

/// Where a menu-bar click routes.
#[derive(Debug, PartialEq, Eq)]
enum MenuTarget<'a> {
    /// Open the repo at this path, carried in the item's own id.
    OpenRecent(&'a str),
    /// Dispatch this frontend action id.
    Action(&'static str),
    /// Not ours — leave it alone.
    Ignore,
}

/// Maps a menu item id to its destination. muda has ONE global menu-event
/// channel, so every listener sees every menu event, tray items included —
/// anything unrecognized must classify as `Ignore` and fall through.
fn classify_menu_id(id: &str) -> MenuTarget<'_> {
    if let Some(path) = id.strip_prefix(ID_RECENT_PREFIX) {
        // A bare prefix carries no path; treating it as a click would surface a
        // validate-"" error toast.
        if path.is_empty() {
            return MenuTarget::Ignore;
        }
        return MenuTarget::OpenRecent(path);
    }
    match id {
        ID_NEW_REPO => MenuTarget::Action("new-repository"),
        ID_OPEN_REPO => MenuTarget::Action("add-local-repository"),
        ID_CLONE_REPO => MenuTarget::Action("clone-repository"),
        ID_SETTINGS => MenuTarget::Action("open-settings"),
        _ => MenuTarget::Ignore,
    }
}

/// Handle to the live Open Recent submenu so the frontend can push a fresh
/// recents list into it. Tauri's menu types are `Send + Sync` and every menu
/// operation hops to the main thread internally, so a command may mutate this
/// handle directly.
#[cfg(target_os = "macos")]
pub struct AppMenuState {
    inner: Mutex<AppMenuInner>,
}

#[cfg(target_os = "macos")]
struct AppMenuInner {
    recent: Submenu<Wry>,
    entries: Vec<RecentMenuEntry>,
    language: NativeLanguage,
}

/// Installs the application menu and routes its clicks into the frontend.
#[cfg(target_os = "macos")]
pub fn setup_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let language = crate::app_store::read_ui_language();
    let recent = build_recent_submenu(app, language, &[])?;
    let menu = build_menu(app, &recent, language)?;
    app.set_menu(menu)?;
    app.manage(AppMenuState {
        inner: Mutex::new(AppMenuInner {
            recent,
            entries: Vec::new(),
            language,
        }),
    });
    app.on_menu_event(handle_menu_event);
    Ok(())
}

/// The macOS composition of `Menu::default` plus our additions — Settings… in
/// the app submenu, Show All beside Hide Others, and the repo actions in File.
/// Constructing it outright (rather than mutating the default) keeps the layout
/// explicit; re-check it against `tauri::menu::Menu::default` on a Tauri major.
#[cfg(target_os = "macos")]
fn build_menu(
    app: &AppHandle,
    recent: &Submenu<Wry>,
    language: NativeLanguage,
) -> tauri::Result<Menu<Wry>> {
    let labels = language.labels();
    let pkg_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let app_submenu = Submenu::with_items(
        app,
        pkg_info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, Some(labels.about), Some(about_metadata))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                ID_SETTINGS,
                if language == NativeLanguage::Spanish {
                    "Ajustes…"
                } else {
                    "Settings…"
                },
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(labels.services))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(labels.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(labels.hide_others))?,
            &PredefinedMenuItem::show_all(app, Some(labels.show_all))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(labels.quit))?,
        ],
    )?;

    let file_submenu = Submenu::with_items(
        app,
        labels.file,
        true,
        &[
            &MenuItem::with_id(app, ID_NEW_REPO, labels.new_repository, true, None::<&str>)?,
            &MenuItem::with_id(app, ID_OPEN_REPO, labels.open_repository, true, None::<&str>)?,
            &MenuItem::with_id(app, ID_CLONE_REPO, labels.clone_repository, true, None::<&str>)?,
            recent,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(labels.close_window))?,
        ],
    )?;

    // Load-bearing: macOS routes undo/redo/cut/copy/paste/select-all in text
    // inputs through these predefined items — dropping any of them breaks
    // typing in every field in the app.
    let edit_submenu = Submenu::with_items(
        app,
        labels.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_submenu = Submenu::with_items(
        app,
        labels.view,
        true,
        &[&PredefinedMenuItem::fullscreen(app, Some(labels.fullscreen))?],
    )?;

    let window_submenu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        labels.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(labels.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(labels.maximize))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(labels.close_window))?,
        ],
    )?;

    // Empty, as in the default menu: macOS puts its own Search item here.
    let help_submenu =
        Submenu::with_id_and_items(app, HELP_SUBMENU_ID, labels.help, true, &[])?;

    Menu::with_items(
        app,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
            &help_submenu,
        ],
    )
}

/// The macOS convention for an empty recents list: one disabled row, never an
/// empty submenu.
#[cfg(target_os = "macos")]
fn empty_recent_item(
    app: &AppHandle,
    language: NativeLanguage,
) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(
        app,
        ID_RECENT_EMPTY,
        language.labels().no_recent,
        false,
        None::<&str>,
    )
}

#[cfg(target_os = "macos")]
fn recent_items(
    app: &AppHandle,
    language: NativeLanguage,
    entries: &[RecentMenuEntry],
) -> tauri::Result<Vec<MenuItem<Wry>>> {
    if entries.is_empty() {
        return Ok(vec![empty_recent_item(app, language)?]);
    }
    entries
        .iter()
        .map(|entry| {
            MenuItem::with_id(
                app,
                format!("{ID_RECENT_PREFIX}{}", entry.path),
                &entry.label,
                true,
                None::<&str>,
            )
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn build_recent_submenu(
    app: &AppHandle,
    language: NativeLanguage,
    entries: &[RecentMenuEntry],
) -> tauri::Result<Submenu<Wry>> {
    let submenu = Submenu::new(app, language.labels().open_recent, true)?;
    let items = recent_items(app, language, entries)?;
    for item in &items {
        submenu.append(item)?;
    }
    Ok(submenu)
}

/// Turns a menubar click into the same frontend action the command palette and
/// hotkeys dispatch.
#[cfg(target_os = "macos")]
fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let (name, payload) = match classify_menu_id(event.id.as_ref()) {
        MenuTarget::OpenRecent(path) => ("app-menu-open-recent", path),
        MenuTarget::Action(action) => ("app-menu-action", action),
        MenuTarget::Ignore => return,
    };
    // Close-to-tray can leave the window hidden while the menu bar stays
    // clickable, and a dialog raised in a hidden window is invisible.
    crate::tray::show_main_window(app);
    let _ = app.emit(name, payload);
}

/// Rebuilds File → Open Recent from the frontend's recents list, newest first.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn set_recent_repos_menu(
    app: AppHandle,
    state: State<AppMenuState>,
    entries: Vec<RecentMenuEntry>,
) -> AppResult<()> {
    fn menu_err(e: tauri::Error) -> AppError {
        AppError::Command(e.to_string())
    }
    // Build every row BEFORE draining: a failure part-way through construction
    // must not leave the live submenu empty, which is the state the disabled
    // placeholder row exists to prevent.
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let items = recent_items(&app, inner.language, &entries).map_err(menu_err)?;
    // A poisoned lock only means a previous rebuild panicked mid-way; the
    // submenu handle itself stays valid, so recover rather than propagate.
    let recent = &inner.recent;
    // In place: this handle is the one installed in the live menu, so the rows
    // are drained and re-appended rather than the submenu being replaced.
    while recent.remove_at(0).map_err(menu_err)?.is_some() {}
    for item in &items {
        recent.append(item).map_err(menu_err)?;
    }
    inner.entries = entries;
    Ok(())
}

/// Rebuilds the macOS menu and recent submenu in the selected language.
#[cfg(target_os = "macos")]
pub(crate) fn set_native_language(app: &AppHandle, language: NativeLanguage) -> AppResult<()> {
    fn menu_err(e: tauri::Error) -> AppError {
        AppError::Command(e.to_string())
    }

    let state = app.state::<AppMenuState>();
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let recent = build_recent_submenu(app, language, &inner.entries).map_err(menu_err)?;
    let menu = build_menu(app, &recent, language).map_err(menu_err)?;
    app.set_menu(menu).map_err(menu_err)?;
    inner.recent = recent;
    inner.language = language;
    Ok(())
}

/// No-op twin so the command is registered on every platform: only macOS has an
/// app menu, but a stray call from the frontend must not error.
// The command macro camel-cases parameter names through `heck`, which drops the
// leading underscore — the IPC key is `entries` here exactly as on macOS.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn set_recent_repos_menu(_entries: Vec<RecentMenuEntry>) -> AppResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{classify_menu_id, MenuTarget};

    // Ids are spelled out rather than referenced through the consts: these tests
    // pin the wire, so renaming a const must fail here instead of silently
    // moving the contract the frontend listens on.

    #[test]
    fn recent_id_carries_its_path() {
        assert_eq!(
            classify_menu_id("gd-menu-recent:/Users/x/repo"),
            MenuTarget::OpenRecent("/Users/x/repo")
        );
    }

    #[test]
    fn recent_id_keeps_windows_separators_and_colons() {
        assert_eq!(
            classify_menu_id(r"gd-menu-recent:C:\repos\gd"),
            MenuTarget::OpenRecent(r"C:\repos\gd")
        );
    }

    #[test]
    fn fixed_ids_map_to_their_action_strings() {
        for (id, action) in [
            ("gd-menu-new-repo", "new-repository"),
            ("gd-menu-open-repo", "add-local-repository"),
            ("gd-menu-clone-repo", "clone-repository"),
            ("gd-menu-settings", "open-settings"),
        ] {
            assert_eq!(classify_menu_id(id), MenuTarget::Action(action), "id: {id}");
        }
    }

    #[test]
    fn placeholder_tray_and_unknown_ids_are_ignored() {
        // "open"/"quit" are the tray's ids: they reach this classifier because
        // muda's menu-event channel is process-wide.
        for id in [
            "gd-menu-recent-empty",
            "gd-menu-recent:",
            "open",
            "quit",
            "",
            "gd-menu-",
            "gd-menu-unknown",
        ] {
            assert_eq!(classify_menu_id(id), MenuTarget::Ignore, "id: {id}");
        }
    }
}
