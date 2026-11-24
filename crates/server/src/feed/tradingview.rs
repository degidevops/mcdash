//! Feed WebSocket TradingView (anonim, tanpa akun) — port tv_feed.py. Protokol tidak resmi dan bisa berubah.
use super::{FeedEvent, Tx};
use futures_util::{SinkExt, StreamExt};
use mcdash_core::{Bar, Bars};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

const WS_URL: &str = "wss://data.tradingview.com/socket.io/websocket";
const ORIGIN: &str = "https://www.tradingview.com";
const CHUNK: i64 = 5000; // bar per permintaan (batas umum akun anonim)
/// TV mengirim heartbeat `~h~` tiap beberapa detik walau pasar tutup; tanpa pesan APA PUN selama
/// 45 dtk = koneksi mati/zombie. Sebelumnya 60 dtk -> data bisa basi sampai semenit sebelum pulih.
const IDLE_SECS: u64 = 45;
const FATAL: [&str; 4] = ["critical_error", "protocol_error", "symbol_error", "series_error"];

fn now_f() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn rand_id(prefix: &str) -> String {
    let mut x = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(88172645463325252) | 1;
    let mut s = String::from(prefix);
    for _ in 0..12 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        s.push((b'a' + (x % 26) as u8) as char);
    }
    s
}

pub fn frame(method: &str, params: Value) -> String {
    let body = serde_json::to_string(&json!({"m": method, "p": params})).unwrap();
    format!("~m~{}~m~{}", body.chars().count(), body)
}

/// Pecah satu pesan WebSocket menjadi daftar payload (`~m~LEN~m~payload`, LEN dalam karakter).
pub fn parse_frames(raw: &str) -> Vec<String> {
    let mut out = vec![];
    let mut rest = raw;
    while let Some(r) = rest.strip_prefix("~m~") {
        let Some(end) = r.find("~m~") else { break };
        let Ok(n) = r[..end].parse::<usize>() else { break };
        let body = &r[end + 3..];
        let cut = body.char_indices().nth(n).map_or(body.len(), |(i, _)| i);
        out.push(body[..cut].to_string());
        rest = &body[cut..];
    }
    out
}

struct State {
    id: u64,
    symbol: String,
    tf: i64,
    target: i64,
    tx: Tx,
    bars: Bars,
    history_done: bool,
    count_before: usize,
    got_data: bool,
    point: Option<f64>,
    cs: String,
    /// Epoch detik saat sesi terakhir berakhir; dipakai untuk mengukur celah data saat reconnect.
    down_at: f64,
}

enum Fail {
    Transient(String),
    Fatal(String),
}

pub async fn run(id: u64, symbol: String, tf: i64, target: i64, tx: Tx) {
    let mut st = State { id, symbol, tf, target, tx, bars: Bars::new(), history_done: false, count_before: 0, got_data: false, point: None, cs: String::new(), down_at: 0.0 };
    let mut backoff = 1u64;
    loop {
        match session(&mut st).await {
            Err(Fail::Fatal(e)) => {
                let _ = st.tx.send((st.id, FeedEvent::Died { tf: st.tf, error: e }));
                return;
            }
            Err(Fail::Transient(e)) => eprintln!("[feed M{}] terputus ({e}), reconnect {backoff}s", st.tf),
            Ok(()) => {}
        }
        st.down_at = now_f(); // catat kapan data berhenti mengalir -> jendela catch-up saat reconnect
        if st.got_data {
            backoff = 1;
            st.got_data = false;
        }
        sleep(Duration::from_secs(backoff)).await;
        backoff = (backoff * 2).min(30);
    }
}

async fn session(st: &mut State) -> Result<(), Fail> {
    // MCDASH_TV_URL: untuk pengujian / proxy; bawaan = alamat resmi TradingView
    let url = std::env::var("MCDASH_TV_URL").unwrap_or_else(|_| WS_URL.to_string());
    let mut req = url.into_client_request().map_err(|e| Fail::Transient(e.to_string()))?;
    req.headers_mut().insert("Origin", ORIGIN.parse().unwrap());
    let mut cfg = WebSocketConfig::default();
    cfg.max_message_size = None;
    cfg.max_frame_size = None;
    let (mut ws, _) = timeout(Duration::from_secs(20), tokio_tungstenite::connect_async_with_config(req, Some(cfg), false))
        .await
        .map_err(|_| Fail::Transient("timeout menyambung".into()))?
        .map_err(|e| Fail::Transient(e.to_string()))?;
    st.cs = rand_id("cs_");
    let cs = st.cs.clone();
    let send = |m: &str, p: Value| Message::Text(frame(m, p));
    // Riwayat yang sudah ada tetap di st.bars. Setelah reconnect, cukup minta jendela bar seluas
    // selisih waktu putus (+margin) — reconnect jadi cepat (beberapa bar) dan tidak mengunduh ulang
    // seluruh riwayat. Celah lebih panjang dari target bar kembali meminta penuh seperti perilaku lama.
    let first = if st.history_done {
        let gap = (now_f() - st.down_at).max(0.0);
        let need = (gap / (st.tf as f64 * 60.0)).ceil() as i64 + 10;
        st.target.min(need.max(10))
    } else {
        st.target.min(CHUNK)
    };
    let sym = format!("={{\"symbol\": {}, \"adjustment\": \"splits\"}}", serde_json::to_string(&st.symbol).unwrap());
    for m in [
        send("set_auth_token", json!(["unauthorized_user_token"])),
        send("chart_create_session", json!([cs, ""])),
        send("switch_timezone", json!([cs, "Etc/UTC"])),
        send("resolve_symbol", json!([cs, "sds_sym_1", sym])),
        send("create_series", json!([cs, "sds_1", "s1", "sds_sym_1", st.tf.to_string(), first, ""])),
    ] {
        ws.send(m).await.map_err(|e| Fail::Transient(e.to_string()))?;
    }
    loop {
        let msg = timeout(Duration::from_secs(IDLE_SECS), ws.next())
            .await
            .map_err(|_| Fail::Transient(format!("timeout {IDLE_SECS} dtk tanpa data")))?
            .ok_or_else(|| Fail::Transient("koneksi ditutup".into()))?
            .map_err(|e| Fail::Transient(e.to_string()))?;
        let raw = match msg {
            Message::Text(t) => t,
            Message::Close(_) => return Err(Fail::Transient("koneksi ditutup".into())),
            _ => continue,
        };
        for payload in parse_frames(&raw) {
            if let Some(reply) = handle(st, &payload)? {
                ws.send(Message::Text(reply)).await.map_err(|e| Fail::Transient(e.to_string()))?;
            }
        }
    }
}

fn as_f(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

/// Mengembalikan balasan yang perlu dikirim (heartbeat / minta riwayat lebih lama).
fn handle(st: &mut State, msg: &str) -> Result<Option<String>, Fail> {
    if msg.starts_with("~h~") {
        // heartbeat: balas persis sama
        return Ok(Some(format!("~m~{}~m~{}", msg.chars().count(), msg)));
    }
    let Ok(d) = serde_json::from_str::<Value>(msg) else { return Ok(None) };
    let m = d.get("m").and_then(|x| x.as_str()).unwrap_or("");
    if FATAL.contains(&m) {
        return Err(Fail::Fatal(format!("TradingView: {m} {}", d.get("p").map_or("".into(), |p| p.to_string()))));
    }
    match m {
        "timescale_update" | "du" => {
            st.got_data = true;
            let series = d["p"][1]["sds_1"]["s"].as_array().cloned().unwrap_or_default();
            let mut live: Vec<(i64, Bar)> = vec![];
            for it in series {
                let Some(v) = it["v"].as_array() else { continue };
                let Some(ts) = v.first().and_then(|x| x.as_f64()) else { continue };
                let f = |i: usize| v.get(i).and_then(as_f).unwrap_or(0.0);
                let bar = Bar { o: f(1), h: f(2), l: f(3), c: f(4), v: f(5) };
                st.bars.insert(ts as i64, bar);
                live.push((ts as i64, bar));
            }
            if st.history_done && !live.is_empty() {
                let _ = st.tx.send((st.id, FeedEvent::Live { tf: st.tf, bars: live }));
            }
        }
        "symbol_resolved" => {
            let info = &d["p"][2];
            if let Some(ps) = as_f(&info["pricescale"]).filter(|x| *x != 0.0) {
                st.point = Some(as_f(&info["minmov"]).unwrap_or(1.0) / ps);
            }
        }
        "series_completed" if !st.history_done => {
            let n = st.bars.len();
            let grew = n > st.count_before;
            if (n as i64) < st.target && grew {
                // minta riwayat lebih lama
                st.count_before = n;
                return Ok(Some(frame("request_more_data", json!([st.cs, "sds_1", CHUNK]))));
            }
            st.history_done = true;
            let _ = st.tx.send((st.id, FeedEvent::History { tf: st.tf, bars: st.bars.clone(), point: st.point }));
        }
        _ => {}
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_dan_parse_bolak_balik() {
        let f = frame("set_auth_token", json!(["unauthorized_user_token"]));
        assert!(f.starts_with("~m~") && f.contains("\"m\":\"set_auth_token\""));
        let two = format!("{}{}", f, "~m~4~m~~h~1");
        let parts = parse_frames(&two);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1], "~h~1");
        assert!(serde_json::from_str::<Value>(&parts[0]).is_ok());
    }

    #[test]
    fn parse_frame_karakter_non_ascii() {
        let body = "{\"x\":\"é€\"}";
        let raw = format!("~m~{}~m~{}~m~4~m~~h~9", body.chars().count(), body);
        let p = parse_frames(&raw);
        assert_eq!(p, vec![body.to_string(), "~h~9".to_string()]);
    }
}
