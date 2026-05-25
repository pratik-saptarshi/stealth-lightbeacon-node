use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

const ONTOLOGY_TOOLS: [&str; 4] = [
    "ontology.lookup",
    "ontology.search",
    "ontology.query",
    "ontology.update",
];
const LEGACY_DB_TOOLS: [&str; 5] = [
    "duckdb.query",
    "duckdb.exec",
    "lancedb.createTable",
    "lancedb.insert",
    "lancedb.search",
];

#[derive(Deserialize)]
struct RpcRequest {
    jsonrpc: String,
    method: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    id: Value,
}

struct ServerState {
    root: PathBuf,
    degraded: bool,
    started_ms: u128,
}

impl ServerState {
    fn new(root: PathBuf) -> Self {
        let _ = fs::create_dir_all(root.join(".agent/logs"));
        let _ = fs::create_dir_all(root.join(".agent/context"));
        let _ = fs::create_dir_all(root.join(".agent/db/ladybug"));
        let degraded = !init_schema(&root);
        Self {
            root,
            degraded,
            started_ms: now_millis(),
        }
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn append_log(root: &Path, msg: &str) {
    let path = root.join(".agent/logs/indexer_crash.log");
    if let Ok(mut out) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(out, "{msg}");
    }
}

fn run_lbug(root: &Path, cypher: &str, json_mode: bool) -> Result<(String, String), String> {
    let db = root.join(".agent/db/ladybug/ladybug.db");
    let lbug_path = root.join("tools/bin/lbug");
    let lbug_cmd = if lbug_path.exists() {
        lbug_path
    } else {
        PathBuf::from("lbug")
    };
    let mut delay_ms = 50;
    for attempt in 0..6 {
        let mut command = Command::new(&lbug_cmd);
        command
            .arg(db.as_os_str())
            .arg("--no_progress_bar")
            .arg("--no_stats")
            .current_dir(root)
            .env("HOME", root.join(".agent"))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if json_mode {
            command.arg("-m").arg("json");
        }

        let output = command
            .spawn()
            .and_then(|mut child| {
                if let Some(stdin) = child.stdin.as_mut() {
                    let _ = stdin.write_all(format!("{cypher};\n").as_bytes());
                }
                child.wait_with_output()
            })
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Ok((stdout, stderr));
        }

        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let lock_error = stderr.contains("Could not set lock on file");
        if lock_error && attempt < 5 {
            thread::sleep(std::time::Duration::from_millis(delay_ms));
            delay_ms *= 2;
            continue;
        }
        return Err(stderr);
    }

    Err("lbug execution failed after retries".to_string())
}

fn lbug_exec(root: &Path, cypher: &str) -> Result<Value, String> {
    let (stdout, _) = run_lbug(root, cypher, true)?;
    if stdout.is_empty() {
        return Ok(Value::Array(vec![]));
    }
    serde_json::from_str(&stdout).map_err(|err| err.to_string())
}

fn lbug_exec_write(root: &Path, cypher: &str) -> Result<(), String> {
    let _ = run_lbug(root, cypher, false)?;
    Ok(())
}

fn schema_bootstrap_marker(root: &Path) -> PathBuf {
    root.join(".agent/db/ladybug/bootstrap.done")
}

fn materialize_schema(root: &Path) -> Result<(), String> {
    let _ = lbug_exec(root, "MATCH (c:CodeSymbol) RETURN c LIMIT 1")?;
    let _ = lbug_exec(root, "MATCH (f:SourceFile) RETURN f LIMIT 1")?;
    Ok(())
}

fn node_path_for_id(nodes: &[Value], node_id: i64) -> String {
    for node in nodes {
        if node.get("id").and_then(Value::as_i64) == Some(node_id) {
            if let Some(file) = node.get("data").and_then(Value::as_object) {
                if let Some(entry) = file.get("File").and_then(Value::as_object) {
                    return entry
                        .get("path")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                }
            }
        }
    }
    String::new()
}

fn seed_graph_from_ast(root: &Path) -> Result<(), String> {
    let temp_dir = std::env::temp_dir().join(format!("stealth-lightbeacon-graph-{}", now_millis()));
    fs::create_dir_all(&temp_dir).map_err(|err| err.to_string())?;
    let source_dir = root.join("src");
    let ast_context = root.join("tools/bin/ast_context");
    let output = Command::new(ast_context)
        .arg("index")
        .arg(&source_dir)
        .arg("--format")
        .arg("json")
        .current_dir(&temp_dir)
        .output()
        .map_err(|err| err.to_string())?;

    if !output.status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let graph_path = temp_dir.join("graph.json");
    let graph_text = fs::read_to_string(&graph_path).map_err(|err| err.to_string())?;
    let graph: Value = serde_json::from_str(&graph_text).map_err(|err| err.to_string())?;
    let _ = fs::remove_dir_all(&temp_dir);

    let nodes = graph
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "graph missing nodes".to_string())?;
    let edges = graph
        .get("edges")
        .and_then(Value::as_array)
        .ok_or_else(|| "graph missing edges".to_string())?;

    let mut symbol_nodes = HashSet::new();
    let mut file_nodes = HashSet::new();
    let mut statements = Vec::new();

    for node in nodes {
        let node_id = node.get("id").and_then(Value::as_i64).ok_or_else(|| "node missing id".to_string())?;
        let label = node.get("label").and_then(Value::as_str).unwrap_or("");
        match label {
            "Function" | "Class" => {
                let payload = node
                    .get("data")
                    .and_then(Value::as_object)
                    .and_then(|data| data.get(label))
                    .ok_or_else(|| format!("missing payload for node {node_id}"))?;
                let name = payload.get("name").and_then(Value::as_str).unwrap_or("");
                let path = payload.get("path").and_then(Value::as_str).unwrap_or("");
                let span = payload.get("span").and_then(Value::as_object);
                let start_line = span
                    .and_then(|s| s.get("start_line"))
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                if !name.is_empty() && !path.is_empty() {
                    symbol_nodes.insert(node_id);
                    statements.push(format!(
                        "MERGE (c:CodeSymbol {{id: '{node_id}'}}) SET c.name = '{}', c.kind = '{}', c.filePath = '{}', c.startLine = {}",
                        cypher_escape(name),
                        cypher_escape(&label.to_lowercase()),
                        cypher_escape(&format!("src/{path}")),
                        start_line
                    ));
                }
            }
            "File" => {
                let payload = node
                    .get("data")
                    .and_then(Value::as_object)
                    .and_then(|data| data.get("File"))
                    .ok_or_else(|| format!("missing file payload for node {node_id}"))?;
                let path = payload.get("path").and_then(Value::as_str).unwrap_or("");
                let language = payload.get("language").and_then(Value::as_str).unwrap_or("");
                if !path.is_empty() {
                    file_nodes.insert(node_id);
                    statements.push(format!(
                        "MERGE (f:SourceFile {{path: '{}'}}) SET f.language = '{}', f.lastHash = ''",
                        cypher_escape(&format!("src/{path}")),
                        cypher_escape(language)
                    ));
                }
            }
            _ => {}
        }
    }

    for edge in edges {
        let label = edge.get("label").and_then(Value::as_str).unwrap_or("");
        let source = edge.get("source").and_then(Value::as_i64).unwrap_or(-1);
        let target = edge.get("target").and_then(Value::as_i64).unwrap_or(-1);
        match label {
            "CALLS" if symbol_nodes.contains(&source) && symbol_nodes.contains(&target) => {
                statements.push(format!(
                    "MATCH (a:CodeSymbol {{id: '{source}'}}), (b:CodeSymbol {{id: '{target}'}}) MERGE (a)-[:CALLS]->(b)"
                ));
            }
            "CONTAINS" if file_nodes.contains(&source) && symbol_nodes.contains(&target) => {
                let source_path = node_path_for_id(nodes, source);
                if !source_path.is_empty() {
                    statements.push(format!(
                        "MATCH (a:SourceFile {{path: '{}'}}), (b:CodeSymbol {{id: '{target}'}}) MERGE (a)-[:CONTAINS]->(b)",
                        cypher_escape(&format!("src/{source_path}"))
                    ));
                }
            }
            _ => {}
        }
    }

    if statements.is_empty() {
        return Err("no graph statements generated".to_string());
    }

    let batch = statements.join(";\n");
    lbug_exec_write(root, &batch)?;

    Ok(())
}

fn init_schema(root: &Path) -> bool {
    let marker = schema_bootstrap_marker(root);
    if marker.exists() {
        append_log(root, "schema bootstrap marker present");
        return true;
    }

    append_log(root, "schema init start");

    let init = root.join(".agent/db/ladybug/init_db.sh");
    if !init.exists() {
        append_log(root, "schema init missing");
        return false;
    }
    let ran = Command::new(init).current_dir(root).output();
    if let Ok(output) = ran {
        if !output.status.success() {
            append_log(root, &String::from_utf8_lossy(&output.stderr));
            return false;
        }
    } else if let Err(err) = ran {
        append_log(root, &err.to_string());
        return false;
    }

    append_log(root, "schema verify start");
    if let Err(err) = materialize_schema(root) {
        append_log(root, &format!("schema materialize failed: {err}"));
        return false;
    }
    append_log(root, "schema verify complete");

    append_log(root, "graph seed start");
    if let Err(err) = seed_graph_from_ast(root) {
        append_log(root, &format!("graph seed failed: {err}"));
        return false;
    }
    append_log(root, "graph seed complete");

    if let Err(err) = fs::write(marker, "bootstrapped") {
        append_log(root, &format!("bootstrap marker failed: {err}"));
        return false;
    }

    true
}

fn degraded_tool_error() -> Value {
    json!({
      "ok": false,
      "error": {
        "code": "ONTOLOGY_DEGRADED",
        "message": "LadybugDB schema unavailable; ontology tools are degraded"
      }
    })
}

fn tool_error(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": { "code": code, "message": message } })
}

fn run_write_batch(root: &Path, statements: &[String]) -> Result<(), String> {
    let batch = statements.join(";\n");
    lbug_exec_write(root, &batch)?;
    Ok(())
}

fn cypher_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('\'', "\\'")
}

fn build_update_statements(args: &Value) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    if let Some(nodes) = args.get("nodes").and_then(Value::as_array) {
        for node in nodes {
            let id = node.get("id").and_then(Value::as_str).unwrap_or("");
            let name = node.get("name").and_then(Value::as_str).unwrap_or("");
            let kind = node.get("kind").and_then(Value::as_str).unwrap_or("");
            let file_path = node.get("filePath").and_then(Value::as_str).unwrap_or("");
            let start_line = node.get("startLine").and_then(Value::as_i64).unwrap_or(0);
            if !id.is_empty() && !file_path.is_empty() {
                out.push(format!(
                    "MERGE (c:CodeSymbol {{id: '{}'}}) SET c.name='{}', c.kind='{}', c.filePath='{}', c.startLine={}",
                    cypher_escape(id),
                    cypher_escape(name),
                    cypher_escape(kind),
                    cypher_escape(file_path),
                    start_line
                ));
                continue;
            }
            let path = node.get("path").and_then(Value::as_str).unwrap_or("");
            let language = node.get("language").and_then(Value::as_str).unwrap_or("");
            let hash = node.get("lastHash").and_then(Value::as_str).unwrap_or("");
            if !path.is_empty() {
                out.push(format!(
                    "MERGE (f:SourceFile {{path: '{}'}}) SET f.language='{}', f.lastHash='{}'",
                    cypher_escape(path),
                    cypher_escape(language),
                    cypher_escape(hash)
                ));
            }
        }
    }
    if let Some(relationships) = args.get("relationships").and_then(Value::as_array) {
        for rel in relationships {
            let relation = rel.get("relation").and_then(Value::as_str).unwrap_or("");
            let from = rel.get("from").and_then(Value::as_str).unwrap_or("");
            let to = rel.get("to").and_then(Value::as_str).unwrap_or("");
            match relation {
                "CALLS" if !from.is_empty() && !to.is_empty() => out.push(format!(
                    "MATCH (a:CodeSymbol {{id: '{}'}}), (b:CodeSymbol {{id: '{}'}}) MERGE (a)-[:CALLS]->(b)",
                    cypher_escape(from),
                    cypher_escape(to)
                )),
                "CONTAINS" if !from.is_empty() && !to.is_empty() => out.push(format!(
                    "MATCH (a:SourceFile {{path: '{}'}}), (b:CodeSymbol {{id: '{}'}}) MERGE (a)-[:CONTAINS]->(b)",
                    cypher_escape(from),
                    cypher_escape(to)
                )),
                _ => {}
            }
        }
    }
    if out.is_empty() {
        return Err("No valid nodes or relationships supplied".to_string());
    }
    Ok(out)
}

fn handle_tool_call(state: &mut ServerState, name: &str, args: &Value) -> Value {
    if state.degraded && ONTOLOGY_TOOLS.contains(&name) {
        return degraded_tool_error();
    }
    match name {
        "health" => json!({
          "ok": true,
          "tool": "health",
          "result": {"status":"ok", "uptimeMs": now_millis().saturating_sub(state.started_ms)}
        }),
        "status" => json!({
          "ok": true,
          "tool":"status",
          "result":{
            "pid": std::process::id(),
            "tools": [
              "health","status",
              "duckdb.query","duckdb.exec",
              "lancedb.createTable","lancedb.insert","lancedb.search",
              "ontology.lookup","ontology.search","ontology.query","ontology.update"
            ]
          }
        }),
        "duckdb.query" | "duckdb.exec" | "lancedb.createTable" | "lancedb.insert" | "lancedb.search" => {
            let _ = args;
            json!({
              "ok": false,
              "error": {
                "code": "LEGACY_DB_TOOL_UNAVAILABLE",
                "message": "Legacy DB tool surface is compatibility-only in Rust MCP; use ontology tools in this runtime"
              }
            })
        }
        "ontology.lookup" => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or("");
            let cypher = format!(
                "MATCH (c:CodeSymbol) WHERE c.name = '{}' RETURN c LIMIT 1",
                query.replace('\'', "\\'")
            );
            match lbug_exec(&state.root, &cypher) {
                Ok(out) => json!({"ok": true, "result": out}),
                Err(err) => tool_error("ONTOLOGY_QUERY_FAILED", &err),
            }
        }
        "ontology.search" => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or("");
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(5);
            let cypher = format!(
                "MATCH (c:CodeSymbol) WHERE c.name =~ '(?i).*{}.*' RETURN c LIMIT {}",
                query.replace('\'', "\\'"),
                limit
            );
            match lbug_exec(&state.root, &cypher) {
                Ok(out) => json!({"ok": true, "result": out}),
                Err(err) => tool_error("ONTOLOGY_QUERY_FAILED", &err),
            }
        }
        "ontology.query" => {
            let cypher = args.get("cypher").and_then(Value::as_str).unwrap_or("");
            if cypher.trim().is_empty() {
                return tool_error("INVALID_ARGUMENTS", "cypher must be a non-empty string");
            }
            match lbug_exec(&state.root, cypher) {
                Ok(out) => json!({"ok": true, "result": out}),
                Err(err) => tool_error("ONTOLOGY_QUERY_FAILED", &err),
            }
        }
        "ontology.update" => {
            match build_update_statements(args)
                .and_then(|stmts| run_write_batch(&state.root, &stmts).map(|_| stmts.len()))
            {
                Ok(applied) => json!({"ok": true, "result": {"appliedStatements": applied}}),
                Err(err) => tool_error("ONTOLOGY_UPDATE_FAILED", &err),
            }
        }
        _ => json!({"ok": false, "error": format!("Unknown tool: {name}")}),
    }
}

fn tools_list() -> Value {
    json!({
      "tools": [
        {"name":"health","description":"Health check","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
        {"name":"status","description":"Runtime status","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
        {"name":"duckdb.query","description":"Execute a validated DuckDB query","inputSchema":{"type":"object","properties":{"sql":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"array"},{"type":"object"}]},"timeoutMs":{"type":"integer","minimum":1,"maximum":60000,"default":2000}},"required":["sql"],"additionalProperties":false}},
        {"name":"duckdb.exec","description":"Execute a validated DuckDB statement","inputSchema":{"type":"object","properties":{"sql":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"array"},{"type":"object"}]},"timeoutMs":{"type":"integer","minimum":1,"maximum":60000,"default":2000}},"required":["sql"],"additionalProperties":false}},
        {"name":"lancedb.createTable","description":"Create LanceDB table","inputSchema":{"type":"object","properties":{"name":{"type":"string","minLength":1},"data":{"type":"array"},"mode":{"type":"string","enum":["create","overwrite"]},"timeoutMs":{"type":"integer","minimum":1,"maximum":60000,"default":2000}},"required":["name","data"],"additionalProperties":false}},
        {"name":"lancedb.insert","description":"Insert into LanceDB table","inputSchema":{"type":"object","properties":{"name":{"type":"string","minLength":1},"data":{"type":"array"},"timeoutMs":{"type":"integer","minimum":1,"maximum":60000,"default":2000}},"required":["name","data"],"additionalProperties":false}},
        {"name":"lancedb.search","description":"Search LanceDB table","inputSchema":{"type":"object","properties":{"query":{"type":"string","minLength":1},"limit":{"type":"integer","minimum":1,"maximum":100,"default":10},"timeoutMs":{"type":"integer","minimum":1,"maximum":60000,"default":2000}},"required":["query"],"additionalProperties":false}},
        {"name":"ontology.lookup","description":"Lookup code symbol","inputSchema":{"type":"object","properties":{"query":{"type":"string","minLength":1}},"required":["query"],"additionalProperties":false}},
        {"name":"ontology.search","description":"Search code symbol","inputSchema":{"type":"object","properties":{"query":{"type":"string","minLength":1},"limit":{"type":"integer","minimum":1,"maximum":20,"default":5}},"required":["query"],"additionalProperties":false}},
        {"name":"ontology.query","description":"Run raw Cypher","inputSchema":{"type":"object","properties":{"cypher":{"type":"string","minLength":1}},"required":["cypher"],"additionalProperties":false}},
        {"name":"ontology.update","description":"Update ontology graph","inputSchema":{"type":"object","properties":{"nodes":{"type":"array"},"relationships":{"type":"array"}},"additionalProperties":false}}
      ]
    })
}

fn response_ok(id: Value, result: Value) -> Value {
    json!({"jsonrpc":"2.0", "id": if id.is_null() { Value::Null } else { id }, "result": result})
}

fn response_err(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc":"2.0", "id": if id.is_null() { Value::Null } else { id }, "error": {"code": code, "message": message}})
}

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut state = ServerState::new(root);

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(v) if !v.trim().is_empty() => v,
            _ => continue,
        };
        let req: RpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(_) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    response_err(Value::Null, -32700, "Parse error")
                );
                let _ = stdout.flush();
                continue;
            }
        };

        if req.jsonrpc != "2.0" {
            let _ = writeln!(
                stdout,
                "{}",
                response_err(req.id.clone(), -32600, "Invalid Request")
            );
            let _ = stdout.flush();
            continue;
        }

        let response = match req.method.as_str() {
            "initialize" => response_ok(
                req.id,
                json!({
                  "protocolVersion": "2024-11-05",
                  "serverInfo": {"name":"stealth-lightbeacon-node-mcp", "version": env!("CARGO_PKG_VERSION")},
                  "capabilities": {"tools":{"listChanged": false}}
                }),
            ),
            "tools/list" => response_ok(req.id, tools_list()),
            "tools/call" => {
                let name = req
                    .params
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let args = req.params.get("arguments").cloned().unwrap_or_else(|| json!({}));
                if LEGACY_DB_TOOLS.contains(&name) || ONTOLOGY_TOOLS.contains(&name) || name == "health" || name == "status" {
                    let tool_result = handle_tool_call(&mut state, name, &args);
                    response_ok(req.id, json!({"content":[{"type":"text","text": tool_result.to_string()}]}))
                } else {
                    response_err(req.id, -32602, "Invalid params")
                }
            }
            "shutdown" => response_ok(req.id, Value::Null),
            "ping" => response_ok(req.id, json!({})),
            "notifications/initialized" => continue,
            _ => response_err(req.id, -32601, "Method not found"),
        };

        let _ = writeln!(stdout, "{response}");
        let _ = stdout.flush();
    }
}
