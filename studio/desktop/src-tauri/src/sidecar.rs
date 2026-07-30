//! B-M2: engine sidecar lifecycle — spawn the Python FastAPI backend
//! automatically (no more "run uvicorn in a second terminal"), health-check
//! it, and kill it on window close so no orphan process survives quitting.
//!
//! Scope note: this spawns the backend directly from the developer's Python
//! environment (venv), not a PyInstaller-packaged binary — full packaging
//! for distribution is still a deliberately deferred follow-up (see
//! 09_BM3_BM7_TODO.md's B-M6 section for why: bundling a full Python
//! runtime plus every rag_gt dependency is a multi-hour+ effort with real
//! dependency-conflict risk, out of proportion to one autonomous slice).
//! `CARGO_MANIFEST_DIR` (baked in at BUILD time) locates the repo root,
//! which only resolves on the machine that compiled the binary — B-M6
//! added `missing_root_failure` so a packaged build copied elsewhere fails
//! with an actionable message instead of an opaque `Command::spawn` OS
//! error, which is the honest, right-sized fix for now.

use std::env;
use std::fs::{self, File};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_STATUS: &str = "sidecar://status";

/// Preferred port — matches the existing `uvicorn ... --port 8100` habit
/// documented in studio/README.md, so a plain `curl 127.0.0.1:8100/health`
/// still works for anyone used to the manual-start workflow.
const PREFERRED_PORT: u16 = 8100;

pub struct SidecarState(pub Mutex<Option<Child>>);

/// B-M7: holds the Windows Job Object the sidecar child is assigned to.
/// Kept alive here (managed app state, dropped only on process exit) so the
/// OS closes its last handle exactly when app.exe terminates for ANY
/// reason -- graceful quit, crash, or a forceful kill -- which is what
/// actually triggers JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. See spawn_job()
/// doc comment for why this exists (a real orphaned-process bug, not a
/// defensive guess).
#[cfg(windows)]
pub struct SidecarJobState(pub Mutex<Option<win32job::Job>>);

/// Latest status, queryable via the `get_sidecar_status` command. Needed
/// because `emit` only reaches listeners that are ALREADY registered —
/// the webview takes a moment to load and register its listener (three
/// sequential dynamic imports in useEngineSidecar), and this sidecar's own
/// health-check can resolve to "ready" well within that window on a fast
/// uvicorn boot. Without this, the frontend can miss "ready" entirely and
/// never learn the negotiated port. The frontend calls this command once on
/// mount to get the current state, THEN listens for subsequent changes.
pub struct SidecarStatusState(pub Mutex<serde_json::Value>);

#[tauri::command]
pub fn get_sidecar_status(state: tauri::State<SidecarStatusState>) -> serde_json::Value {
  state.0.lock().unwrap().clone()
}

fn set_and_emit(app: &AppHandle, payload: serde_json::Value) {
  if let Some(state) = app.try_state::<SidecarStatusState>() {
    *state.0.lock().unwrap() = payload.clone();
  }
  let _ = app.emit(EVENT_STATUS, payload);
}

fn repo_root() -> PathBuf {
  // src-tauri -> desktop -> studio -> repo root
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .and_then(Path::parent)
    .and_then(Path::parent)
    .expect("studio/desktop/src-tauri should be three levels under the repo root")
    .to_path_buf()
}

fn resolve_python(root: &Path) -> PathBuf {
  if let Ok(over_ride) = env::var("RAGGT_ENGINE_PYTHON") {
    if !over_ride.is_empty() {
      return PathBuf::from(over_ride);
    }
  }
  let windows_venv = root.join("venv").join("Scripts").join("python.exe");
  if windows_venv.exists() {
    return windows_venv;
  }
  let unix_venv = root.join("venv").join("bin").join("python");
  if unix_venv.exists() {
    return unix_venv;
  }
  PathBuf::from("python")
}

/// Packaged builds ship an embedded Python runtime as a Tauri resource
/// (built by studio/desktop/build-python-runtime.ps1): a hermetic
/// python.exe whose `._pth` puts `Lib/site-packages` and `app/` (the
/// backend source) on sys.path — no venv, no repo checkout, no PYTHONPATH.
/// Returns (python.exe, working-dir) when the runtime is present and
/// complete. Dev keeps priority: this is only consulted AFTER the env
/// override and the dev venv both miss (see `spawn`), so a dev checkout
/// with a full engine venv never silently downgrades to the light runtime.
fn bundled_runtime(resource_dir: &Path) -> Option<(PathBuf, PathBuf)> {
  let runtime = resource_dir.join("python-runtime");
  let python = runtime.join("python.exe");
  let app_dir = runtime.join("app");
  if python.exists() && app_dir.exists() {
    Some((python, app_dir))
  } else {
    None
  }
}

/// Binds preferred_port if free; otherwise asks the OS for any free port.
/// The listener is dropped (freeing the port) right before returning, so
/// there's an inherent tiny bind-race with whatever grabs it next — uvicorn
/// binding it immediately after keeps that window small in practice, and
/// this is a local dev tool, not a hardened service.
fn find_port(preferred: u16) -> u16 {
  if let Ok(listener) = TcpListener::bind(("127.0.0.1", preferred)) {
    return listener.local_addr().map(|a| a.port()).unwrap_or(preferred);
  }
  let listener = TcpListener::bind(("127.0.0.1", 0)).expect("OS should always grant an ephemeral port");
  listener.local_addr().expect("bound listener has a local address").port()
}

fn is_port_open(port: u16) -> bool {
  TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), Duration::from_millis(200)).is_ok()
}

/// B-M7: assigns the freshly-spawned sidecar child to a Windows Job Object
/// with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, so the OS kills it automatically
/// when app.exe's last handle to the job closes -- which Windows guarantees
/// happens on ANY process exit, including a crash or a forceful
/// Stop-Process/Task Manager kill, not just the graceful
/// WindowEvent::CloseRequested path `shutdown()` already handles below.
/// Found live during B-M6 installer verification: force-killing the
/// installed app left a real orphaned `uvicorn` process bound to the port
/// (confirmed via Get-CimInstance Win32_Process) -- this is a fix for a
/// demonstrated bug, not defensive speculation.
///
/// The Job handle is stashed in managed app state (never explicitly
/// dropped, only torn down by the OS on process exit) -- dropping it
/// earlier would defeat the whole point, since KILL_ON_JOB_CLOSE fires
/// when the LAST handle closes.
#[cfg(windows)]
fn assign_to_job(app: &AppHandle, child: &Child) {
  use std::os::windows::io::AsRawHandle;

  let job = match win32job::Job::create() {
    Ok(j) => j,
    Err(e) => {
      log::warn!("B-M7: could not create Windows Job Object for sidecar cleanup: {e}");
      return;
    }
  };

  let mut info = job.query_extended_limit_info().unwrap_or_default();
  info.limit_kill_on_job_close();
  if let Err(e) = job.set_extended_limit_info(&mut info) {
    log::warn!("B-M7: could not set Job Object kill-on-close limit: {e}");
    return;
  }

  if let Err(e) = job.assign_process(child.as_raw_handle() as _) {
    log::warn!("B-M7: could not assign sidecar process to Job Object: {e}");
    return;
  }

  if let Some(state) = app.try_state::<SidecarJobState>() {
    *state.0.lock().unwrap() = Some(job);
  }
}

#[cfg(not(windows))]
fn assign_to_job(_app: &AppHandle, _child: &Child) {
  // No non-Windows packaging target exists yet (see 03_PHASE2_SOFTWARE_PLAN.md
  // §4 non-goals) -- this is a deliberate no-op so the crate still compiles
  // elsewhere during local development, not a claim of parity.
}

const MISSING_ROOT_MESSAGE: &str = "no Python engine found: this build's bundled runtime is missing or incomplete (reinstall the app), and no dev checkout/venv or RAGGT_ENGINE_PYTHON override is available";

/// B-M6: `root` is `CARGO_MANIFEST_DIR`, a path baked in at COMPILE time on
/// whatever machine built this binary — it only resolves correctly when
/// running from that same dev checkout. A packaged installer copied to
/// another machine (the real B-M6 accept-criterion scenario) has no such
/// path, no `venv/`, and no bundled Python runtime yet (full
/// PyInstaller/embedded-Python packaging is a known, deliberately deferred
/// follow-up — see 09_BM3_BM7_TODO.md). Detecting that up front and failing
/// with an ACTIONABLE message beats letting `Command::spawn` fail on a
/// nonexistent `current_dir` with an opaque OS error.
fn missing_root_failure(root: &Path) -> Option<serde_json::Value> {
  if root.exists() {
    None
  } else {
    Some(serde_json::json!({ "status": "failed", "message": MISSING_ROOT_MESSAGE }))
  }
}

pub fn spawn(app: &AppHandle) {
  let root = repo_root();

  // Resolution order: explicit env override > dev checkout (repo root +
  // venv) > bundled embedded runtime (packaged installs) > actionable
  // failure. The bundled runtime is what makes an installer copied to a
  // machine WITHOUT the dev tree actually work (B-M6 follow-up closed).
  // RAGGT_FORCE_BUNDLED=1 skips the dev-checkout path so the packaged
  // runtime can be exercised on the build machine itself (where the baked
  // CARGO_MANIFEST_DIR root always exists and would otherwise win).
  let force_bundled = env::var("RAGGT_FORCE_BUNDLED").map(|v| v == "1").unwrap_or(false);
  let dev_available = root.exists() && !force_bundled;
  let env_override = !force_bundled
    && env::var("RAGGT_ENGINE_PYTHON").map(|v| !v.is_empty()).unwrap_or(false);
  let bundled = app
    .path()
    .resource_dir()
    .ok()
    .and_then(|d| bundled_runtime(&d));

  let (python, workdir) = if env_override || dev_available {
    (resolve_python(&root), root.clone())
  } else if let Some((python, app_dir)) = bundled {
    (python, app_dir)
  } else {
    if let Some(failure) = missing_root_failure(&root) {
      set_and_emit(app, failure);
    }
    return;
  };

  let port = find_port(PREFERRED_PORT);

  let log_dir = app
    .path()
    .app_local_data_dir()
    .map(|d| d.join("logs"))
    .unwrap_or_else(|_| workdir.join(".sidecar-logs"));
  let _ = fs::create_dir_all(&log_dir);
  let log_path = log_dir.join(format!("backend-{}.log", chrono_like_timestamp()));

  set_and_emit(app, serde_json::json!({ "status": "starting", "port": port }));

  let stdout_file = File::create(&log_path).ok();
  if let Some(f) = &stdout_file {
    write_log_header(f, &workdir, &python, port);
  }
  let stderr_file = stdout_file.as_ref().and_then(|f| f.try_clone().ok());

  let mut command = Command::new(&python);
  command
    .args(["-m", "uvicorn", "studio.backend.api:app", "--host", "127.0.0.1", "--port", &port.to_string()])
    .current_dir(&workdir)
    .stdout(stdout_file.map(Stdio::from).unwrap_or_else(Stdio::null))
    .stderr(stderr_file.map(Stdio::from).unwrap_or_else(Stdio::null));

  let child = match command.spawn() {
    Ok(c) => c,
    Err(e) => {
      set_and_emit(app, serde_json::json!({ "status": "failed", "message": format!("failed to start engine: {e}") }));
      return;
    }
  };

  assign_to_job(app, &child);

  if let Some(state) = app.try_state::<SidecarState>() {
    *state.0.lock().unwrap() = Some(child);
  }

  let app_handle = app.clone();
  std::thread::spawn(move || {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
      if is_port_open(port) {
        set_and_emit(&app_handle, serde_json::json!({ "status": "ready", "port": port }));
        return;
      }
      std::thread::sleep(Duration::from_millis(200));
    }
    set_and_emit(
      &app_handle,
      serde_json::json!({ "status": "failed", "message": "engine did not become ready within 20s — see the log file" }),
    );
  });
}

/// Kills the spawned engine process, if any. Called on window close so no
/// orphan uvicorn survives quitting the app.
pub fn shutdown(app: &AppHandle) {
  if let Some(state) = app.try_state::<SidecarState>() {
    if let Some(mut child) = state.0.lock().unwrap().take() {
      let _ = child.kill();
      let _ = child.wait();
    }
  }
}

/// Good enough for a log filename — avoids pulling in a datetime crate for
/// one string. Not a real calendar timestamp, just a monotonically-ish
/// increasing disambiguator across app launches.
fn chrono_like_timestamp() -> u128 {
  use std::time::{SystemTime, UNIX_EPOCH};
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn write_log_header(mut file: &File, root: &Path, python: &Path, port: u16) {
  let _ = writeln!(file, "# GRAFT Studio engine sidecar log");
  let _ = writeln!(file, "# root={} python={} port={}", root.display(), python.display(), port);
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::Mutex;

  /// cargo runs #[test] fns on PARALLEL threads within one process, and
  /// RAGGT_ENGINE_PYTHON is process-global — the two resolve_python tests
  /// below both mutate it, so without this lock one test's remove_var can
  /// land between the other's set_var and its resolve_python call and the
  /// suite fails intermittently. (The earlier "single-threaded test
  /// process" SAFETY note was simply wrong.)
  static ENV_LOCK: Mutex<()> = Mutex::new(());

  #[test]
  fn missing_root_failure_is_none_when_the_directory_exists() {
    let existing = std::env::temp_dir();
    assert!(missing_root_failure(&existing).is_none());
  }

  #[test]
  fn missing_root_failure_reports_an_actionable_message_when_the_directory_is_gone() {
    let nonexistent = std::env::temp_dir().join("graft-studio-definitely-does-not-exist-12345");
    let failure = missing_root_failure(&nonexistent).expect("should fail for a nonexistent root");
    assert_eq!(failure["status"], "failed");
    assert!(failure["message"].as_str().unwrap().contains("RAGGT_ENGINE_PYTHON"));
  }

  #[test]
  fn find_port_returns_the_preferred_port_when_free() {
    // Ask the OS for a genuinely free port (bind :0, read it back, release
    // it) instead of hardcoding one and hoping nothing on the machine holds
    // it. A tiny reuse window remains between drop and find_port, but that
    // beats a constant that is simply taken on some machines.
    let candidate = {
      let probe = TcpListener::bind(("127.0.0.1", 0)).unwrap();
      probe.local_addr().unwrap().port()
    };
    let port = find_port(candidate);
    assert_eq!(port, candidate);
  }

  #[test]
  fn find_port_falls_back_to_an_os_assigned_port_when_the_preferred_one_is_taken() {
    let holder = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let taken = holder.local_addr().unwrap().port();
    let port = find_port(taken);
    assert_ne!(port, taken);
    assert!(port > 0);
  }

  #[test]
  fn bundled_runtime_found_when_python_and_app_dir_exist() {
    let base = std::env::temp_dir().join(format!("graft-runtime-test-{}", std::process::id()));
    let runtime = base.join("python-runtime");
    std::fs::create_dir_all(runtime.join("app")).unwrap();
    std::fs::write(runtime.join("python.exe"), b"").unwrap();

    let found = bundled_runtime(&base).expect("complete runtime should be found");
    assert_eq!(found.0, runtime.join("python.exe"));
    assert_eq!(found.1, runtime.join("app"));

    let _ = std::fs::remove_dir_all(&base);
  }

  #[test]
  fn bundled_runtime_none_when_incomplete_or_absent() {
    let absent = std::env::temp_dir().join("graft-no-runtime-here-12345");
    assert!(bundled_runtime(&absent).is_none());

    // python.exe present but app/ missing -> incomplete -> None
    let base = std::env::temp_dir().join(format!("graft-runtime-incomplete-{}", std::process::id()));
    let runtime = base.join("python-runtime");
    std::fs::create_dir_all(&runtime).unwrap();
    std::fs::write(runtime.join("python.exe"), b"").unwrap();
    assert!(bundled_runtime(&base).is_none());
    let _ = std::fs::remove_dir_all(&base);
  }

  #[test]
  fn resolve_python_prefers_the_env_override() {
    let _guard = ENV_LOCK.lock().unwrap();
    // SAFETY: serialized by ENV_LOCK with every other test touching this
    // var; restored before the guard drops.
    unsafe { env::set_var("RAGGT_ENGINE_PYTHON", "/custom/python") };
    let result = resolve_python(&std::env::temp_dir());
    unsafe { env::remove_var("RAGGT_ENGINE_PYTHON") };
    assert_eq!(result, PathBuf::from("/custom/python"));
  }

  #[test]
  fn resolve_python_falls_back_to_bare_python_when_no_venv_or_override_exists() {
    let _guard = ENV_LOCK.lock().unwrap();
    // SAFETY: serialized by ENV_LOCK with every other test touching this var.
    unsafe { env::remove_var("RAGGT_ENGINE_PYTHON") };
    let empty_dir = std::env::temp_dir().join("graft-studio-no-venv-here-12345");
    let result = resolve_python(&empty_dir);
    assert_eq!(result, PathBuf::from("python"));
  }
}
