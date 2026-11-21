use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, Url};

struct BackendChild(Mutex<Option<Child>>);

fn append_log(msg: &str) {
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/cure-backend.log")
    {
        let _ = writeln!(f, "{}", msg);
    }
}

fn resolve_bun_binary() -> String {
    if let Ok(home) = std::env::var("HOME") {
        let bun_home = PathBuf::from(home).join(".bun/bin/bun");
        if bun_home.exists() {
            return bun_home.to_string_lossy().into_owned();
        }
    }
    for candidate in ["/opt/homebrew/bin/bun", "/usr/local/bin/bun"] {
        if PathBuf::from(candidate).exists() {
            return candidate.to_string();
        }
    }
    "bun".to_string()
}

fn resolve_project_root(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        for candidate in [
            resource_dir.clone(),
            resource_dir.join("_up_"),
            resource_dir.join(".."),
        ] {
            if candidate.join("server.ts").exists() {
                return candidate;
            }
        }
    }

    let dev_root = PathBuf::from("/Users/rishishanmuganathan/Downloads/project-cure-2");
    if dev_root.join("server.ts").exists() {
        return dev_root;
    }

    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn wait_for_port(port: u16, timeout: Duration) {
    let start = Instant::now();
    let addr = format!("127.0.0.1:{}", port);
    while start.elapsed() < timeout {
        if TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_millis(200)).is_ok() {
            append_log(&format!("Port {} is listening", port));
            return;
        }
        thread::sleep(Duration::from_millis(150));
    }
    append_log(&format!("Timed out waiting for port {}", port));
}

fn open_log_stdio() -> Stdio {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/cure-backend.log")
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null())
}

fn spawn_backend(app: &tauri::AppHandle) -> Option<Child> {
    append_log("=== Starting Project C.U.R.E. backend ===");
    let bun_bin = resolve_bun_binary();
    let project_root = resolve_project_root(app);
    let server_script = project_root.join("server.ts");
    append_log(&format!(
        "bun={}, root={}, server={}",
        bun_bin,
        project_root.display(),
        server_script.display()
    ));

    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("/tmp/project-cure-data"));

    let db_dir = app_data_dir.join("data");
    let upload_dir = db_dir.join("uploads");
    let _ = fs::create_dir_all(&upload_dir);
    let db_path = db_dir.join("cure.db");

    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Ok(home) = std::env::var("HOME") {
        path_env = format!(
            "{}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:{}",
            home, path_env
        );
    }

    let spawned = Command::new(&bun_bin)
        .arg("run")
        .arg(server_script)
        .current_dir(&project_root)
        .env("PATH", path_env)
        .env("PORT", "3000")
        .env("CURE_DB_PATH", db_path.to_string_lossy().as_ref())
        .env("CURE_UPLOAD_DIR", upload_dir.to_string_lossy().as_ref())
        .stdout(open_log_stdio())
        .stderr(open_log_stdio())
        .spawn();

    match spawned {
        Ok(child) => {
            append_log(&format!("Spawned backend PID {}", child.id()));
            wait_for_port(3000, Duration::from_secs(8));
            Some(child)
        }
        Err(e) => {
            append_log(&format!("Failed to spawn backend: {}", e));
            None
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let child = spawn_backend(app.handle());
            app.manage(BackendChild(Mutex::new(child)));
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(url) = "http://127.0.0.1:3000".parse() {
                    let _ = win.navigate(url);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Project C.U.R.E. Tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit | RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<BackendChild>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
