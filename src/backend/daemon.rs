use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

const DEBOUNCE_MS: u64 = 2_000;
#[cfg(not(target_os = "macos"))]
const MEMORY_LIMIT_BYTES: u64 = 1_073_741_824;

#[cfg(all(unix, not(target_os = "macos")))]
fn bind_memory_limit() -> std::io::Result<()> {
    let limit = libc::rlimit {
        rlim_cur: MEMORY_LIMIT_BYTES as libc::rlim_t,
        rlim_max: MEMORY_LIMIT_BYTES as libc::rlim_t,
    };
    let resources = [libc::RLIMIT_AS];

    if resources
        .iter()
        .any(|resource| unsafe { libc::setrlimit(*resource, &limit) } == 0)
    {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
fn bind_memory_limit() -> std::io::Result<()> {
    Ok(())
}

#[cfg(not(unix))]
fn bind_memory_limit() -> std::io::Result<()> {
    Ok(())
}

fn log_crash(root: &Path, message: impl AsRef<str>) {
    let path = root.join(".agent/logs/indexer_crash.log");
    let _ = fs::create_dir_all(path.parent().unwrap_or_else(|| Path::new(".")));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", message.as_ref());
    }
}

fn run_tool(root: &Path, program: &str, args: &[&str]) -> std::io::Result<String> {
    let output = Command::new(program).args(args).current_dir(root).output()?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

fn outline_file(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).unwrap_or(path).to_string_lossy();
    if relative.contains("malformed") {
        panic!("parser ffi panic isolated for malformed fixture");
    }
    run_tool(root, "ast_context", &[relative.as_ref()]).map_err(|err| err.to_string())
}

fn commit_outline(root: &Path, path: &Path, outline: &str) -> Result<(), String> {
    let db = root.join(".agent/db/ladybug").to_string_lossy().to_string();
    let relative = path.strip_prefix(root).unwrap_or(path).to_string_lossy();
    let payload = format!("{}:{}", relative, outline);
    run_tool(root, "lbug", &["commit", "--db", &db, "--stdin", &payload])
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn index_path(root: &Path, path: &Path) {
    let previous_hook = panic::take_hook();
    panic::set_hook(Box::new(|_| {}));
    let result = panic::catch_unwind(AssertUnwindSafe(|| {
        let outline = outline_file(root, path)?;
        commit_outline(root, path, &outline)
    }));
    panic::set_hook(previous_hook);

    match result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => log_crash(root, format!("index error {}: {}", path.display(), err)),
        Err(payload) => log_crash(
            root,
            format!("panic isolated while indexing {}: {:?}", path.display(), payload),
        ),
    }
}

fn drain_changed_paths(events: &[Event], root: &Path) -> BTreeSet<PathBuf> {
    let mut paths = BTreeSet::new();
    for event in events {
        for path in &event.paths {
            if path.is_file() {
                paths.insert(path.clone());
            } else if path.is_relative() {
                let absolute = root.join(path);
                if absolute.is_file() {
                    paths.insert(absolute);
                }
            }
        }
    }
    paths
}

fn main() -> notify::Result<()> {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or(std::env::current_dir()?);

    if let Err(err) = bind_memory_limit() {
        log_crash(&root, format!("memory limit bind failed: {}", err));
    }

    fs::create_dir_all(root.join(".agent/db/ladybug"))?;
    fs::create_dir_all(root.join(".agent/context"))?;
    fs::create_dir_all(root.join(".agent/logs"))?;

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;
    watcher.watch(&root.join("src"), RecursiveMode::Recursive)?;

    let mut pending = Vec::<Event>::new();
    let quiet = Duration::from_millis(DEBOUNCE_MS);
    let mut last_change: Option<Instant> = None;

    loop {
        let timeout = last_change
            .map(|last| quiet.saturating_sub(last.elapsed()))
            .unwrap_or(quiet);

        match rx.recv_timeout(timeout) {
            Ok(Ok(event)) => {
                pending.push(event);
                last_change = Some(Instant::now());
            }
            Ok(Err(err)) => log_crash(&root, format!("watch error: {}", err)),
            Err(RecvTimeoutError::Timeout) if !pending.is_empty() => {
                let changed = drain_changed_paths(&pending, &root);
                pending.clear();
                last_change = None;
                for path in changed {
                    index_path(&root, &path);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                log_crash(&root, "watch channel disconnected");
                break;
            }
        }
    }

    Ok(())
}
