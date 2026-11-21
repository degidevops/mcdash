//! HTTP + WebSocket (axum): halaman, API config/Telegram, dan siaran frame ke browser.
use crate::app::*;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use mcdash_core::config;
use mcdash_core::series::{Bar, Bars};
use std::sync::Arc;
use tokio::sync::broadcast::error::RecvError;

pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/", get(|s| file(s, "index.html", "text/html; charset=utf-8")))
        .route("/chart", get(|s| file(s, "chart.html", "text/html; charset=utf-8")))
        .route("/chart/*path", get(chart_js))
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
/// or chart.html if path is empty.
async fn chart_js(State(app): State<Arc<App>>, axum::extract::Path(path): axum::extract::Path<String>) -> Response {
    let clean = path.trim_start_matches('/');
    if clean.is_empty() {
        return file(State(app), "chart.html", "text/html; charset=utf-8").await;
    }
    // validate: only allow [a-z0-9_/-]+\.js
    let ok = clean.strip_suffix(".js").map_or(false, |b| {
        !b.is_empty() && b.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-' || c == b'/')
            && !b.contains("..")
    });
    if !ok {
        return StatusCode::NOT_FOUND.into_response();
    }
    let full = format!("chart/{clean}");
    file(State(app), &full, "text/javascript; charset=utf-8").await
}

#[derive(serde::Deserialize)]
struct ChartQuery {
    tf: Option<i64>,
    count: Option<usize>,
}

/// Agregasi bar dari timeframe lebih kecil ke timeframe lebih besar (dalam detik).
pub fn aggregate_bars(base: &Bars, target_tf_sec: i64) -> Bars {
    let mut out = Bars::new();
    if target_tf_sec <= 0 {
        return out;
    }
    for (&ts, &bar) in base {
        let bucket = ts - (ts % target_tf_sec);
        out.entry(bucket)
            .and_modify(|b: &mut Bar| {
                b.h = b.h.max(bar.h);
                b.l = b.l.min(bar.l);
                b.c = bar.c;
                b.v += bar.v;
            })
            .or_insert(bar);
    }
    out
}

/// GET /api/chart-bars?tf=60&count=500 → [[ts,o,h,l,c,v], ...]
async fn chart_bars(State(app): State<Arc<App>>, axum::extract::Query(q): axum::extract::Query<ChartQuery>) -> Response {
    let tf = q.tf.unwrap_or(60);
    let count = q.count.unwrap_or(500);
    let sh = app.shared.read().unwrap();
    let maybe_bars = sh.chart_bars.get(&tf).cloned();
    let bars = match maybe_bars {
        Some(b) if !b.is_empty() => b,
        _ => {
            // Coba agregasi dari timeframe dasar lebih kecil yang ada
            let base_candidate = [1, 5, 15, 60, 240]
                .into_iter()
                .find(|&btf| btf < tf && sh.chart_bars.get(&btf).map_or(false, |b| !b.is_empty()));
            if let Some(btf) = base_candidate {
                let base_bars = sh.chart_bars.get(&btf).unwrap();
                aggregate_bars(base_bars, tf * 60)
            } else {
                return json_resp(StatusCode::OK, "[]".into());
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn router_creates_without_panicking() {
        let (tx, _) = tokio::sync::broadcast::channel(16);
        let app = Arc::new(App {
            shared: std::sync::RwLock::new(Shared::default()),
            tx,
            cfg_path: "config.json".into(),
            web_dir: PathBuf::from("web/dist"),
            notifier: crate::notifier::Notifier::new(PathBuf::from("telegram.json")),
        });
        let _ = router(app);
    }

    #[test]
    fn aggregate_bars_combines_ohlcv_correctly() {
        let mut base = Bars::new();
        // 3 bar 1-menit: menit 0, 1, 2 (ts: 0, 60, 120)
        base.insert(0, Bar { o: 100.0, h: 105.0, l: 99.0, c: 102.0, v: 10.0 });
        base.insert(60, Bar { o: 102.0, h: 108.0, l: 101.0, c: 107.0, v: 15.0 });
        base.insert(120, Bar { o: 107.0, h: 107.5, l: 95.0, c: 98.0, v: 25.0 });

        // Agregasi ke interval 300 detik (5m)
        let agg = aggregate_bars(&base, 300);
        assert_eq!(agg.len(), 1);
        let b = agg.get(&0).expect("bucket 0 exists");
        assert_eq!(b.o, 100.0, "open should be first bar open");
        assert_eq!(b.h, 108.0, "high should be max of all bars");
        assert_eq!(b.l, 95.0, "low should be min of all bars");
        assert_eq!(b.c, 98.0, "close should be last bar close");
        assert_eq!(b.v, 50.0, "volume should be sum of all bars");
    }
}
