use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEBOUNCE_MS: u64 = 2_000;
const PARSER_WORKERS: usize = 2;
#[cfg(not(target_os = "macos"))]
const MEMORY_LIMIT_BYTES: u64 = 1_073_741_824;

#[cfg(all(unix, not(target_os = "macos")))]
fn bind_memory_limit(root: &Path) {
    let limit = libc::rlimit {
        rlim_cur: MEMORY_LIMIT_BYTES as libc::rlim_t,
        rlim_max: MEMORY_LIMIT_BYTES as libc::rlim_t,
    };
    let resources = [libc::RLIMIT_AS];
    if !resources
        .iter()
        .any(|resource| unsafe { libc::setrlimit(*resource, &limit) } == 0)
    {
        log_crash(
            root,
            "memory_limit",
            None,
            "setrlimit",
            &std::io::Error::last_os_error().to_string(),
        );
    }
}

#[cfg(target_os = "macos")]
fn bind_memory_limit(root: &Path) {
    log_crash(
        root,
        "memory_limit",
        None,
        "macos-ulimit",
        "RLIMIT_AS strict cap unsupported on macOS; relying on launcher ulimit -v and telemetry guard",
    );
}

#[cfg(not(unix))]
fn bind_memory_limit(_root: &Path) {}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn json_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('\"', "\\\"")
}

fn log_crash(root: &Path, kind: &str, file: Option<&Path>, phase: &str, stderr: &str) {
    let path = root.join(".agent/logs/indexer_crash.log");
    let _ = fs::create_dir_all(path.parent().unwrap_or_else(|| Path::new(".")));
    if let Ok(mut out) = OpenOptions::new().create(true).append(true).open(path) {
        let file_str = file
            .map(|f| f.display().to_string())
            .unwrap_or_else(|| "".to_string());
        let line = format!(
            "{{\"ts\":{},\"kind\":\"{}\",\"file\":\"{}\",\"phase\":\"{}\",\"stderr\":\"{}\"}}",
            now_millis(),
            json_escape(kind),
            json_escape(&file_str),
            json_escape(phase),
            json_escape(stderr)
        );
        let _ = writeln!(out, "{line}");
    }
}

fn run_tool(root: &Path, program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn outline_file(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).unwrap_or(path).to_string_lossy();
    run_tool(root, "ast_context", &["parse", relative.as_ref()])
}

fn augment_codegraph(root: &Path, path: &Path) {
    let relative = path.strip_prefix(root).unwrap_or(path).to_string_lossy();
    let _ = run_tool(root, "codegraph", &["index", relative.as_ref()]);
}

fn commit_outline(root: &Path, path: &Path, outline: &str) -> Result<(), String> {
    let db = root.join(".agent/db/ladybug").to_string_lossy().to_string();
    let relative = path.strip_prefix(root).unwrap_or(path).to_string_lossy();
    run_tool(
        root,
        "lbug",
        &["commit", "--db", &db, "--stdin", &format!("{relative}:{outline}")],
    )
    .map(|_| ())
}

fn process_file(root: &Path, path: &Path) -> Result<(), (String, &'static str)> {
    let outline = outline_file(root, path).map_err(|e| (e, "outline"))?;
    augment_codegraph(root, path);
    commit_outline(root, path, &outline).map_err(|e| (e, "commit"))
}

#[derive(Clone)]
struct ParserTask {
    path: PathBuf,
}

struct WorkerSlot {
    tx: Sender<ParserTask>,
    handle: thread::JoinHandle<()>,
}

fn spawn_worker(
    root: PathBuf,
    rx: Receiver<ParserTask>,
    done_tx: Sender<usize>,
    worker_id: usize,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        loop {
            let task = match rx.recv() {
                Ok(task) => task,
                Err(_) => break,
            };

            let result = std::panic::catch_unwind(|| process_file(&root, &task.path));
            match result {
                Ok(Ok(())) => {}
                Ok(Err((stderr, phase))) => {
                    log_crash(&root, "index_error", Some(&task.path), phase, &stderr)
                }
                Err(payload) => {
                    let panic_msg = if let Some(msg) = payload.downcast_ref::<&str>() {
                        *msg
                    } else if let Some(msg) = payload.downcast_ref::<String>() {
                        msg
                    } else {
                        "unknown panic"
                    };
                    log_crash(&root, "parser_panic", Some(&task.path), "worker", panic_msg);
                }
            }
        }
        let _ = done_tx.send(worker_id);
    })
}

fn ensure_agent_dirs(root: &Path) -> notify::Result<()> {
    fs::create_dir_all(root.join(".agent/db/ladybug"))?;
    fs::create_dir_all(root.join(".agent/context"))?;
    fs::create_dir_all(root.join(".agent/logs"))?;
    Ok(())
}

fn validate_session(root: &Path) {
    let session = root.join(".agent/context/session.json");
    if !session.exists() {
        log_crash(
            root,
            "session_missing",
            Some(&session),
            "startup",
            "missing .agent/context/session.json",
        );
    }
}

fn ensure_schema(root: &Path) -> bool {
    let init_script = root.join(".agent/db/ladybug/init_db.sh");
    if !init_script.exists() {
        log_crash(
            root,
            "schema_init_missing",
            Some(&init_script),
            "startup",
            "missing init_db.sh",
        );
        return false;
    }

    let result = Command::new(init_script).current_dir(root).output();
    match result {
        Ok(output) if output.status.success() => true,
        Ok(output) => {
            log_crash(
                root,
                "schema_init_failed",
                None,
                "startup",
                &String::from_utf8_lossy(&output.stderr),
            );
            false
        }
        Err(err) => {
            log_crash(root, "schema_init_failed", None, "startup", &err.to_string());
            false
        }
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

    ensure_agent_dirs(&root)?;
    validate_session(&root);
    bind_memory_limit(&root);
    let _schema_ok = ensure_schema(&root);

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;
    watcher.watch(&root.join("src"), RecursiveMode::Recursive)?;

    let (done_tx, done_rx) = mpsc::channel::<usize>();
    let mut worker_handles: Vec<WorkerSlot> = Vec::new();
    for id in 0..PARSER_WORKERS {
        let (task_tx, task_rx) = mpsc::channel::<ParserTask>();
        worker_handles.push(WorkerSlot {
            tx: task_tx,
            handle: spawn_worker(root.clone(), task_rx, done_tx.clone(), id),
        });
    }

    let mut pending = Vec::<Event>::new();
    let quiet = Duration::from_millis(DEBOUNCE_MS);
    let mut last_change: Option<Instant> = None;
    let mut rr = 0usize;

    loop {
        while let Ok(worker_id) = done_rx.try_recv() {
            if worker_id >= worker_handles.len() {
                continue;
            }
            let (task_tx, task_rx) = mpsc::channel::<ParserTask>();
            let old = std::mem::replace(
                &mut worker_handles[worker_id],
                WorkerSlot {
                    tx: task_tx,
                    handle: spawn_worker(root.clone(), task_rx, done_tx.clone(), worker_id),
                },
            );
            let _ = old.handle.join();
            log_crash(
                &root,
                "worker_restart",
                None,
                "supervisor",
                &format!("restarted worker {}", worker_id),
            );
        }

        let timeout = last_change
            .map(|last| quiet.saturating_sub(last.elapsed()))
            .unwrap_or(quiet);

        match rx.recv_timeout(timeout) {
            Ok(Ok(event)) => {
                pending.push(event);
                last_change = Some(Instant::now());
            }
            Ok(Err(err)) => log_crash(&root, "watch_error", None, "watch", &err.to_string()),
            Err(RecvTimeoutError::Timeout) if !pending.is_empty() => {
                let changed = drain_changed_paths(&pending, &root);
                pending.clear();
                last_change = None;
                for path in changed {
                    if worker_handles.is_empty() {
                        log_crash(&root, "worker_missing", Some(&path), "dispatch", "no workers");
                        continue;
                    }
                    let idx = rr % worker_handles.len();
                    rr += 1;
                    if let Err(err) = worker_handles[idx].tx.send(ParserTask { path: path.clone() }) {
                        log_crash(&root, "queue_error", Some(&path), "dispatch", &err.to_string());
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                log_crash(
                    &root,
                    "watch_disconnected",
                    None,
                    "watch",
                    "watch channel disconnected",
                );
                break;
            }
        }
    }

    for worker in worker_handles {
        drop(worker.tx);
        let _ = worker.handle.join();
    }

    Ok(())
}
