//! HTTP + WebSocket (axum): halaman, API config/Telegram, dan siaran frame ke browser.
use crate::app::*;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use mcdash_core::config;
use std::sync::Arc;
use tokio::sync::broadcast::error::RecvError;

pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/", get(|s| file(s, "index.html", "text/html; charset=utf-8")))
        .route("/chart", get(|s| file(s, "chart.html", "text/html; charset=utf-8")))
        .route("/chart/{*path}", get(chart_js))
        .route("/api/chart-bars", get(chart_bars))
        .route("/:name", get(js_module))
        .route("/api/snapshot", get(api_snapshot))
        .route("/api/config", get(get_config).post(post_config))
        .route("/api/telegram", get(tg_status))
        .route("/api/telegram/settings", post(tg_settings))
        .route("/api/telegram/send", post(tg_send))
        .route("/api/telegram/test", post(tg_test))
        .route("/ws", get(ws_upgrade))
        .with_state(app)
}

fn json_resp(code: StatusCode, body: String) -> Response {
    (code, [(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-store")], body).into_response()
}
fn detail(code: StatusCode, msg: &str) -> Response {
    json_resp(code, serde_json::json!({ "detail": msg }).to_string())
}

async fn file(State(app): State<Arc<App>>, name: &str, ctype: &'static str) -> Response {
    match tokio::fs::read(app.web_dir.join(name)).await {
        Ok(b) => ([(header::CONTENT_TYPE, ctype), (header::CACHE_CONTROL, "no-store")], b).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            format!("{name} tidak ditemukan di {}. Bangun klien dulu: cd web && npm install && npm run build", app.web_dir.display()),
        )
            .into_response(),
    }
}

/// Modul hasil compile tsc/tsrs (dist/*.js). Nama dibatasi ke `[a-z0-9_-]+.js` agar tidak bisa keluar dari web_dir.
async fn js_module(State(app): State<Arc<App>>, axum::extract::Path(name): axum::extract::Path<String>) -> Response {
    let ok = name.strip_suffix(".js").map_or(false, |b| !b.is_empty() && b.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-'));
    if !ok {
        return StatusCode::NOT_FOUND.into_response();
    }
    file(State(app), &name, "text/javascript; charset=utf-8").await
}

/// Serve chart JS modules from dist/chart/ subdirectory (e.g. /chart/app.js → dist/chart/app.js)
async fn chart_js(State(app): State<Arc<App>>, axum::extract::Path(path): axum::extract::Path<String>) -> Response {
    // validate: only allow [a-z0-9_/-]+\.js
    let ok = path.strip_suffix(".js").map_or(false, |b| {
        !b.is_empty() && b.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-' || c == b'/')
            && !b.contains("..")
    });
    if !ok {
        return StatusCode::NOT_FOUND.into_response();
    }
    let full = format!("chart/{path}");
    file(State(app), &full, "text/javascript; charset=utf-8").await
}

#[derive(serde::Deserialize)]
struct ChartQuery {
    tf: Option<i64>,
    count: Option<usize>,
}

/// GET /api/chart-bars?tf=60&count=500 → [[ts,o,h,l,c,v], ...]
async fn chart_bars(State(app): State<Arc<App>>, axum::extract::Query(q): axum::extract::Query<ChartQuery>) -> Response {
    let tf = q.tf.unwrap_or(60);
    let count = q.count.unwrap_or(500);
    let sh = app.shared.read().unwrap();
    let bars = match sh.chart_bars.get(&tf) {
        Some(b) => b,
        None => return json_resp(StatusCode::OK, "[]".into()),
    };
    // Take the last `count` bars, output as array of arrays
    let total = bars.len();
    let skip = if total > count { total - count } else { 0 };
    let arr: Vec<[f64; 6]> = bars.iter().skip(skip).map(|(ts, b)| [*ts as f64, b.o, b.h, b.l, b.c, b.v]).collect();
    json_resp(StatusCode::OK, serde_json::to_string(&arr).unwrap_or_else(|_| "[]".into()))
}

async fn api_snapshot(State(app): State<Arc<App>>) -> Response {
    let sh = app.shared.read().unwrap();
    json_resp(StatusCode::OK, snapshot_doc(&sh.meta, sh.snap.as_ref()))
}

async fn get_config(State(app): State<Arc<App>>) -> Response {
    json_resp(StatusCode::OK, std::fs::read_to_string(&app.cfg_path).unwrap_or_else(|_| "{}".into()))
}

async fn post_config(State(app): State<Arc<App>>, body: String) -> Response {
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => return detail(StatusCode::BAD_REQUEST, &format!("JSON tidak valid: {e}")),
    };
    if let Err(e) = config::parse(&v) {
        return detail(StatusCode::BAD_REQUEST, &e); // ditolak sebelum disimpan; pesannya tampil di dialog
    }
    let tmp = format!("{}.tmp", app.cfg_path);
    if let Err(e) = std::fs::write(&tmp, &body).and_then(|_| std::fs::rename(&tmp, &app.cfg_path)) {
        return detail(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    json_resp(StatusCode::OK, "{\"ok\":true}".into()) // runner memuat ulang otomatis
}

async fn tg_status(State(app): State<Arc<App>>) -> Response {
    json_resp(StatusCode::OK, app.notifier.status().to_string())
}
async fn tg_settings(State(app): State<Arc<App>>, body: String) -> Response {
    match app.notifier.save_settings(&body) {
        Ok(()) => json_resp(StatusCode::OK, "{\"ok\":true}".into()),
        Err(e) => detail(StatusCode::BAD_REQUEST, &e),
    }
}
async fn tg_send(State(app): State<Arc<App>>) -> Response {
    let snap = app.shared.read().unwrap().snap.clone();
    match app.notifier.send_manual(snap).await {
        Ok(()) => json_resp(StatusCode::OK, "{\"ok\":true}".into()),
        Err(e) => detail(StatusCode::BAD_GATEWAY, &e),
    }
}
async fn tg_test(State(app): State<Arc<App>>) -> Response {
    match app.notifier.send_test().await {
        Ok(()) => json_resp(StatusCode::OK, "{\"ok\":true}".into()),
        Err(e) => detail(StatusCode::BAD_GATEWAY, &e),
    }
}

async fn ws_upgrade(State(app): State<Arc<App>>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |sock| client(sock, app))
}

async fn client(mut sock: WebSocket, app: Arc<App>) {
    let mut rx = app.tx.subscribe();
    let initial = |app: &App| {
        let sh = app.shared.read().unwrap();
        let mut v: Vec<String> = vec![];
        if let Some(f) = &sh.snap_frame {
            v.push(f.clone());
        }
        v.push(meta_frame(&sh.meta));
        if let Some(t) = &sh.tick {
            v.push(tick_frame(t));
        }
        v
    };
    for f in initial(&app) {
        if sock.send(Message::Text(f)).await.is_err() {
            return;
        }
    }
    loop {
        tokio::select! {
            m = rx.recv() => match m {
                Ok(t) => { if sock.send(Message::Text(t)).await.is_err() { return; } }
                Err(RecvError::Lagged(_)) => {
                    // klien terlambat: kirim ulang keadaan terbaru
                    for f in initial(&app) { if sock.send(Message::Text(f)).await.is_err() { return; } }
                }
                Err(RecvError::Closed) => return,
            },
            incoming = sock.recv() => match incoming {
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return,
                _ => {}
            },
        }
    }
}
