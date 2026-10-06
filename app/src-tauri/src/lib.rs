// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// The running engine: a dev-time `uv run` child (live Python source) or a
/// packaged build's frozen engine -- see `spawn_sidecar` for why both exist.
struct SidecarState(Mutex<Option<Child>>);

/// Ties the sidecar's lifetime to this process at the OS level, whatever
/// way this process ends.
///
/// Killing the sidecar from an exit handler (see `run`) only works when an
/// exit handler actually runs -- not on a crash, a forced kill, or when the
/// in-app updater terminates the app to replace its files. A sidecar left
/// running keeps its own exe locked (an update installer can't replace it)
/// and its port taken.
/// A Job Object with KILL_ON_JOB_CLOSE fixes that at the source: the OS
/// closes this process's handle to the job however it exits, and closing the
/// last handle kills every process in the job. Processes the sidecar itself
/// spawns afterwards (its ffmpeg runs, `uv run`'s python.exe in dev) join
/// the job automatically.
///
/// Only the sidecar is put in the job, never this process itself: otherwise
/// everything *we* spawn would be in it too (an updater's installer would
/// be killed the moment this app exits to let it run).
#[cfg(windows)]
struct KillOnCloseJob(windows_sys::Win32::Foundation::HANDLE);

// A job handle is a plain kernel handle, valid from any thread.
#[cfg(windows)]
unsafe impl Send for KillOnCloseJob {}
#[cfg(windows)]
unsafe impl Sync for KillOnCloseJob {}

#[cfg(windows)]
impl KillOnCloseJob {
    fn new() -> Option<Self> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return None;
            }
            Some(Self(job))
        }
    }

    fn assign(&self, pid: u32) -> bool {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };
        unsafe {
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                return false;
            }
            let ok = AssignProcessToJobObject(self.0, process);
            CloseHandle(process);
            ok != 0
        }
    }
}

/// Kept in managed state for the app's whole lifetime and deliberately
/// never closed by hand: the handle closing *is* the kill signal, and it
/// must only happen when this process is gone.
#[cfg(windows)]
struct SidecarJob(#[allow(dead_code)] Option<KillOnCloseJob>);

/// Dev-time only: assumes the source tree layout (`../../engine` relative
/// to src-tauri's cwd).
fn engine_dir() -> PathBuf {
    std::env::current_dir()
        .expect("current dir")
        .join("..")
        .join("..")
        .join("engine")
}

/// Kill a process and its whole descendant tree.
///
/// A single `.kill()` on the handle we hold only terminates that one
/// process. In dev, `uv run` spawns the real `python.exe` as a child of
/// `uv.exe` (it doesn't `exec`-replace itself the way Unix does), so killing
/// just the handle we hold would leave the actual FastAPI server (still
/// bound to the port) orphaned; the packaged engine runs in one process but
/// may have ffmpeg children at work. `taskkill /T` kills the whole tree.
fn kill_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        // `taskkill` is a console-subsystem exe; this process (built
        // windowed, see tauri.conf.json) has no console of its own, so
        // without CREATE_NO_WINDOW, Windows pops one up just to run it --
        // flashing open and closed at exactly the moment the app closes.
        // Same root cause as the engine's ffmpeg calls (see
        // ffmpeg_backend._run), just on the Rust side.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
    }
}

/// Launch the FastAPI sidecar. Two different paths on purpose, not just at
/// packaging time:
///
/// - In dev (`cfg!(debug_assertions)`, true for `tauri dev`), shell out to
///   `uv run syncsubtitles serve` against the live source tree: the
///   engine's Python is edited constantly, re-freezing it on every change
///   would make that loop unusably slow.
/// - In a real build, run the bundled engine instead (a PyInstaller folder
///   shipped as the `engine/` resource, packaging to come): an installed
///   copy of the app has no Python/`uv` to shell out to.
///
/// A failure here (e.g. `uv` missing in dev, or the binary wasn't built for
/// a release) is logged, not fatal: the GUI window still opens, it just
/// can't reach the engine until fixed and restarted.
fn spawn_sidecar(app: &tauri::AppHandle) -> Option<Child> {
    // Second, independent safety net next to the Job Object (see
    // KillOnCloseJob): the engine watches this PID itself and exits once
    // it's gone. Covers dev mode's `uv run` hop and any gap between spawning
    // and assigning to the job.
    let parent_pid = std::process::id().to_string();
    if cfg!(debug_assertions) {
        let dir = engine_dir();
        match Command::new("uv")
            .args(["run", "syncsubtitles", "serve", "--port", "8757", "--parent-pid", &parent_pid])
            .current_dir(&dir)
            .spawn()
        {
            Ok(child) => {
                println!("[sidecar] démarré (uv run syncsubtitles serve) dans {:?}", dir);
                Some(child)
            }
            Err(err) => {
                eprintln!("[sidecar] échec du démarrage dans {:?} : {}", dir, err);
                None
            }
        }
    } else {
        // ".exe" on Windows, no extension on Linux.
        let name = format!("engine/syncsubtitles-engine{}", std::env::consts::EXE_SUFFIX);
        let exe = match app.path().resolve(name, BaseDirectory::Resource) {
            Ok(path) => path,
            Err(err) => {
                eprintln!("[sidecar] moteur introuvable : {}", err);
                return None;
            }
        };
        match Command::new(&exe)
            .args(["serve", "--port", "8757", "--parent-pid", &parent_pid])
            .spawn()
        {
            Ok(child) => {
                println!("[sidecar] démarré (pid {})", child.id());
                Some(child)
            }
            Err(err) => {
                eprintln!("[sidecar] échec du démarrage de {:?} : {}", exe, err);
                None
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Restores the main window's size, position and maximized state as
        // it's created. It's created hidden (tauri.conf.json) and only shown
        // here, once restored, so it doesn't flash at the default size first.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            let handle = app.handle().clone();
            #[cfg(windows)]
            let job = KillOnCloseJob::new();
            let child = spawn_sidecar(&handle);
            #[cfg(windows)]
            {
                // Right after spawning, before the engine has had time to
                // start any child of its own (`uv run`'s python.exe in dev),
                // so those are born inside the job and inherit it. The
                // engine's own --parent-pid watchdog covers the case where
                // one isn't.
                if let (Some(job), Some(child)) = (&job, &child) {
                    if !job.assign(child.id()) {
                        eprintln!("[sidecar] impossible de rattacher le moteur au job de l'UI");
                    }
                }
                app.manage(SidecarJob(job));
            }
            app.manage(SidecarState(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                        let _ = app_handle.save_window_state(StateFlags::all());
                let state = app_handle.state::<SidecarState>();
                let mut guard = state.0.lock().unwrap();
                if let Some(child) = guard.take() {
                    kill_process_tree(child.id());
                }
            }
        });
}
