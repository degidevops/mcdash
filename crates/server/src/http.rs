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
        .route("/api/chart-info", get(chart_info))
        .route("/api/chart-tpo", get(chart_tpo))
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
    /// "main" (bawaan) | "binance" | "tv" — sumber alternatif untuk halaman /chart.
    source: Option<String>,
    /// Hanya bar yang LEBIH LAMA dari waktu ini (epoch detik) — lazy-load history
    /// saat chart di-pan ke kiri melampaui data yang sudah dimuat.
    before: Option<f64>,
}

fn pool_get<'a>(sh: &'a Shared, kind: u8, tf: i64) -> Option<&'a Bars> {
    if kind == CHART_SRC_MAIN {
        sh.chart_bars.get(&tf)
    } else {
        sh.chart_bars_ext.get(&(kind, tf))
    }
}

/// Agregasi bar dari timeframe lebih kecil ke timeframe lebih besar (dalam detik).
/// `upper` = hanya bar dengan ts < upper yang diagregasi (i64::MAX = semua) — untuk lazy-load
/// supaya permintaan "history lebih lama" tidak perlu meng-agregasi seluruh kolam M1.
pub fn aggregate_bars(base: &Bars, target_tf_sec: i64, upper: i64) -> Bars {
    let mut out = Bars::new();
    if target_tf_sec <= 0 {
        return out;
    }
    for (&ts, &bar) in base.range(..upper) {
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

/// Ambil `count` bar terakhir dengan ts < `upper` (epoch detik; i64::MAX = tanpa batas), urut naik.
/// Iterasi MUNDUR dari BTreeMap supaya biayanya hanya O(count) — tanpa menyalin seluruh kolam bar
/// (penting saat kolam berisi ratusan ribu bar).
fn bars_tail(bars: &Bars, count: usize, upper: i64) -> Vec<[f64; 6]> {
    let mut out: Vec<[f64; 6]> = bars
        .range(..upper)
        .rev()
        .take(count)
        .map(|(ts, b)| [*ts as f64, b.o, b.h, b.l, b.c, b.v])
        .collect();
    out.reverse();
    out
}

/// GET /api/chart-bars?tf=60&count=500&source=main|binance|tv → [[ts,o,h,l,c,v], ...]
/// source=binance|tv: bar diambil dari feed alternatif yang dinyalakan on-demand;
/// permintaan dicatat di chart_want agar runner tahu feed mana yang harus hidup.
async fn chart_bars(State(app): State<Arc<App>>, axum::extract::Query(q): axum::extract::Query<ChartQuery>) -> Response {
    let tf = q.tf.unwrap_or(60);
    let count = q.count.unwrap_or(500);
    let req = match q.source.as_deref() {
        Some("binance") => CHART_SRC_BINANCE,
        Some("tv") => CHART_SRC_TV,
        _ => CHART_SRC_MAIN,
    };
    let kind = {
        let sh = app.shared.read().unwrap();
        let k = if req == primary_src_kind(&sh.meta.source) { CHART_SRC_MAIN } else { req };
        if k != CHART_SRC_MAIN {
            drop(sh);
            if let Ok(mut sh) = app.shared.write() {
                sh.chart_want.insert((k, tf), now_f());
                sh.chart_keep.insert((k, tf), now_f()); // bar-nya juga diperpanjang umur keep-nya
            }
        }
        k
    };
    let upper = q.before.map_or(i64::MAX, |b| (b.floor() as i64).max(0));
    let sh = app.shared.read().unwrap();
    let arr = match pool_get(&sh, kind, tf) {
        Some(b) if !b.is_empty() => bars_tail(b, count, upper),
        _ => {
            // Coba agregasi dari timeframe dasar lebih kecil yang ada pada kolam sumber yang sama
            let base_candidate = [1i64, 5, 15, 60, 240]
                .into_iter()
                .find(|&btf| btf < tf && pool_get(&sh, kind, btf).map_or(false, |b| !b.is_empty()));
            if let Some(btf) = base_candidate {
                // upper sudah menyingkat input agregasi, jadi hasilnya boleh langsung dipotong
                bars_tail(&aggregate_bars(pool_get(&sh, kind, btf).unwrap(), tf * 60, upper), count, i64::MAX)
            } else {
                vec![]
            }
        }
    };
    json_resp(StatusCode::OK, serde_json::to_string(&arr).unwrap_or_else(|_| "[]".into()))
}

#[derive(serde::Serialize)]
struct ChartSrcOption {
    id: String,
    label: String,
    /// Simbol aktual sumber ini (mis. OANDA:XAUUSD / XAUUSDT). Dipakai halaman /chart
    /// untuk judul kiri atas, watermark, dan kunci penyimpanan drawing.
    symbol: String,
}

/// GET /api/chart-info → daftar pilihan sumber data untuk dropdown halaman /chart.
async fn chart_info(State(app): State<Arc<App>>) -> Response {
    let sh = app.shared.read().unwrap();
    let primary = primary_src_kind(&sh.meta.source);
    let sym = sh.snap.as_ref().map(|s| s.symbol.clone()).unwrap_or_else(|| sh.chart_tv_symbol.clone());
    let main_label = if sh.meta.source == "tradingview" {
        format!("TradingView · {sym}")
    } else if sh.meta.source.is_empty() {
        "Sumber utama".into()
    } else {
        sh.meta.source.clone()
    };
    let mut opts = vec![ChartSrcOption { id: "main".into(), label: main_label, symbol: sym.clone() }];
    if primary != CHART_SRC_BINANCE && !sym.is_empty() {
        let bsym = crate::app::chart_binance_symbol(&sym);
        opts.push(ChartSrcOption {
            id: "binance".into(),
            label: format!("Binance · {bsym}"),
            symbol: bsym,
        });
    }
    if primary != CHART_SRC_TV {
        let tv_sym = if sh.chart_tv_symbol.is_empty() { sym.clone() } else { sh.chart_tv_symbol.clone() };
        if !tv_sym.is_empty() {
            opts.push(ChartSrcOption {
                id: "tv".into(),
                label: format!("TradingView · {tv_sym}"),
                symbol: tv_sym,
            });
        }
    }
    let body = serde_json::json!({ "primary": sh.meta.source, "options": opts });
    json_resp(StatusCode::OK, body.to_string())
}

#[derive(serde::Deserialize)]
struct ChartTpoQuery {
    tag: Option<String>,
}

/// GET /api/chart-tpo?tag=S
async fn chart_tpo(State(app): State<Arc<App>>, axum::extract::Query(q): axum::extract::Query<ChartTpoQuery>) -> Response {
    let sh = app.shared.read().unwrap();
    if let Some(tpo) = sh.chart_tpo.as_ref() {
        if let Some(tag) = q.tag {
            let mut filtered = tpo.clone();
            filtered.profiles.retain(|k, _| k == &tag);
            return json_resp(StatusCode::OK, serde_json::to_string(&filtered).unwrap_or_else(|_| "{}".into()));
        }
        return json_resp(StatusCode::OK, serde_json::to_string(tpo).unwrap_or_else(|_| "{}".into()));
    }
    let sym = sh.snap.as_ref().map(|s| s.symbol.clone()).unwrap_or_default();
    let pt = sh.snap.as_ref().map(|s| s.point).unwrap_or(0.01);
    json_resp(
        StatusCode::OK,
        format!("{{\"symbol\":\"{sym}\",\"point\":{pt},\"profiles\":{{}},\"naked\":[]}}"),
    )
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
        let agg = aggregate_bars(&base, 300, i64::MAX);
        assert_eq!(agg.len(), 1);
        let b = agg.get(&0).expect("bucket 0 exists");
        assert_eq!(b.o, 100.0, "open should be first bar open");
        assert_eq!(b.h, 108.0, "high should be max of all bars");
        assert_eq!(b.l, 95.0, "low should be min of all bars");
        assert_eq!(b.c, 98.0, "close should be last bar close");
        assert_eq!(b.v, 50.0, "volume should be sum of all bars");
    }

    #[test]
    fn aggregate_bars_menghormati_batas_upper() {
        let mut base = Bars::new();
        base.insert(0, Bar { o: 1.0, h: 1.0, l: 1.0, c: 1.0, v: 1.0 });
        base.insert(60, Bar { o: 2.0, h: 2.0, l: 2.0, c: 2.0, v: 1.0 });
        base.insert(120, Bar { o: 3.0, h: 3.0, l: 3.0, c: 3.0, v: 1.0 });
        // upper = 60: hanya bar ts 0 yang diagregasi
        let agg = aggregate_bars(&base, 300, 60);
        assert_eq!(agg.len(), 1);
        assert_eq!(agg.get(&0).unwrap().o, 1.0);
    }

    #[test]
    fn bars_tail_ambil_tera_akhir_dan_menghormati_before() {
        let mut base = Bars::new();
        for i in 0..10i64 {
            base.insert(i * 60, Bar { o: i as f64, h: i as f64, l: i as f64, c: i as f64, v: 1.0 });
        }
        // 3 bar terakhir, urut naik
        let tail = bars_tail(&base, 3, i64::MAX);
        assert_eq!(tail.len(), 3);
        assert_eq!(tail[0][0], 7.0 * 60.0);
        assert_eq!(tail[2][0], 9.0 * 60.0);
        // before = 300 dtk -> hanya ts < 300 (0..240); 2 terakhir = 180 dan 240
        let tail = bars_tail(&base, 2, 300);
        assert_eq!(tail.len(), 2);
        assert_eq!(tail[0][0], 180.0);
        assert_eq!(tail[1][0], 240.0);
        // count lebih besar dari jumlah bar -> semua diberikan
        assert_eq!(bars_tail(&base, 100, i64::MAX).len(), 10);
    }
}
