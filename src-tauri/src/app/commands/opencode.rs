// ============================================
// OpenCode Service Management (desktop only)
// Android 不支持子进程管理和 window.destroy()
// ============================================

use crate::app::service::ServiceState;
use std::{
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::Ordering,
    time::Duration,
};
use tauri::State;

/// 检查 opencode 服务是否在运行（通过 health endpoint）
pub async fn is_service_running(url: &str) -> bool {
    let health_url = format!("{}/global/health", url.trim_end_matches('/'));
    match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client
            .get(&health_url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// 启动 opencode serve 进程
fn spawn_opencode_serve(
    binary_path: &str,
    url: &str,
    env_vars: &std::collections::HashMap<String, String>,
) -> Result<std::process::Child, String> {
    let (hostname, port) = resolve_server_address(url)?;
    log::info!("Starting opencode serve with binary: {}", binary_path);
    log::info!("Binding opencode serve to {}:{}", hostname, port);
    if !env_vars.is_empty() {
        log::info!("Injecting {} environment variable(s)", env_vars.len());
    }

    let serve_args = [
        "serve".to_string(),
        "--hostname".to_string(),
        hostname,
        "--port".to_string(),
        port.to_string(),
    ];

    let mut cmd = build_opencode_command(binary_path, &serve_args);
    cmd.stdout(Stdio::null()).stderr(Stdio::null());

    // 注入用户配置的环境变量
    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().map_err(|e| {
        format!(
            "Failed to start '{}': {}. Check that the path is correct.",
            binary_path, e
        )
    })
}

fn build_opencode_command(binary_path: &str, args: &[String]) -> Command {
    #[cfg(target_os = "windows")]
    {
        let path = Path::new(binary_path);
        let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("");
        let requires_shell = ext.eq_ignore_ascii_case("cmd")
            || ext.eq_ignore_ascii_case("bat")
            || path.extension().is_none();

        if requires_shell {
            let mut cmd = Command::new("cmd.exe");
            cmd.arg("/C").arg(binary_path).args(args);
            return cmd;
        }
    }

    let mut cmd = Command::new(binary_path);
    cmd.args(args);
    cmd
}

fn resolve_server_address(url: &str) -> Result<(String, u16), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid server URL '{}': {}", url, e))?;
    let hostname = parsed
        .host_str()
        .ok_or_else(|| format!("Server URL '{}' has no hostname", url))?
        .to_string();
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| format!("Server URL '{}' has no port", url))?;
    Ok((hostname, port))
}

fn patched_env_var(env_vars: &std::collections::HashMap<String, String>, key: &str) -> Option<OsString> {
    for (env_key, value) in env_vars {
        if env_key.eq_ignore_ascii_case(key) {
            return Some(OsString::from(value));
        }
    }
    env::var_os(key)
}

fn path_candidates(env_vars: &std::collections::HashMap<String, String>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(bin) = patched_env_var(env_vars, "OPENCODE_BIN") {
        if !bin.is_empty() {
            candidates.push(PathBuf::from(bin));
        }
    }

    let Some(path) = patched_env_var(env_vars, "PATH") else {
        return candidates;
    };

    let names: Vec<&str> = if cfg!(windows) {
        vec!["opencode.exe", "opencode.cmd", "opencode.bat", "opencode"]
    } else {
        vec!["opencode"]
    };

    for dir in env::split_paths(&path) {
        for name in &names {
            candidates.push(dir.join(name));
        }
    }

    candidates
}

fn is_runnable_file(path: &Path) -> bool {
    path.is_file()
}

/// 自动检测 opencode 可执行文件，行为接近直接在终端输入 `opencode`。
#[tauri::command]
pub async fn detect_opencode_binary(
    env_vars: std::collections::HashMap<String, String>,
) -> Result<Option<String>, String> {
    for candidate in path_candidates(&env_vars) {
        if is_runnable_file(&candidate) {
            return Ok(Some(candidate.to_string_lossy().to_string()));
        }
    }

    Ok(None)
}

/// 跨平台杀进程
pub fn kill_process_by_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

/// 检查 opencode 服务是否在运行
#[tauri::command]
pub async fn check_opencode_service(url: String) -> Result<bool, String> {
    Ok(is_service_running(&url).await)
}

/// 启动 opencode serve
#[tauri::command]
pub async fn start_opencode_service(
    state: State<'_, ServiceState>,
    url: String,
    binary_path: String,
    env_vars: std::collections::HashMap<String, String>,
) -> Result<bool, String> {
    if is_service_running(&url).await {
        log::info!("opencode service already running at {}", url);
        return Ok(false);
    }

    let child = spawn_opencode_serve(&binary_path, &url, &env_vars)?;
    let pid = child.id();
    log::info!("Started opencode serve, PID: {}", pid);

    state.child_pid.store(pid, Ordering::SeqCst);
    state.we_started.store(true, Ordering::SeqCst);

    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if is_service_running(&url).await {
            log::info!("opencode service is ready at {}", url);
            return Ok(true);
        }
    }

    log::warn!("opencode service started but health check not passing yet");
    Ok(true)
}

/// 停止 opencode serve
#[tauri::command]
pub async fn stop_opencode_service(state: State<'_, ServiceState>) -> Result<(), String> {
    let pid = state.child_pid.swap(0, Ordering::SeqCst);
    state.we_started.store(false, Ordering::SeqCst);

    if pid > 0 {
        log::info!("Stopping opencode serve, PID: {}", pid);
        kill_process_by_pid(pid);
    }

    Ok(())
}

/// 查询是否由我们启动了 opencode 服务
#[tauri::command]
pub async fn get_service_started_by_us(state: State<'_, ServiceState>) -> Result<bool, String> {
    Ok(state.we_started.load(Ordering::SeqCst))
}

/// 确认关闭应用（前端调用，可选择是否同时停止服务）
#[tauri::command]
pub async fn confirm_close_app(
    window: tauri::Window,
    state: State<'_, ServiceState>,
    stop_service: bool,
) -> Result<(), String> {
    if stop_service {
        let pid = state.child_pid.swap(0, Ordering::SeqCst);
        if pid > 0 {
            log::info!("Closing app and stopping opencode serve, PID: {}", pid);
            kill_process_by_pid(pid);
        }
        state.we_started.store(false, Ordering::SeqCst);
    } else {
        log::info!("Closing app, keeping opencode serve running");
    }

    window.destroy().map_err(|e| e.to_string())
}
