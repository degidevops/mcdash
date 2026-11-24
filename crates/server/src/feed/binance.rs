//! Feed Binance (data publik, tanpa API key): riwayat lewat REST `klines`, live lewat WebSocket.
//!
//! Satu feed = satu timeframe (sama seperti feed TradingView), jadi runner memperlakukannya persis sama.
//! Urutan tiap sesi: sambung WebSocket dulu → baru ambil riwayat/backfill lewat REST. Dengan begitu tidak ada
//! bar yang terlewat di antara keduanya, dan setelah koneksi putus bar yang terlewat diisi ulang dari bar terakhir.
//!
//! realtime: SATU koneksi combined stream memuat `@kline_<interval>` (untuk bar) DAN `@aggTrade`
//! (futures) / `@trade` (spot) — harga bergerak per TRADE, bukan menunggu update kline (1–2 dtk).
//! Klien juga mengirim ping WS berkala; koneksi zombie (TCP hidup tapi tidak mengirim apa pun)
//! terdeteksi dalam ~75 dtk, bukan 240 dtk.
//!
//! Simbol cukup ditulis `XAUUSDT` (juga diterima: `BINANCE:XAUUSDT.P`, `xau/usdt`).
//! XAUUSDT/XAGUSDT adalah perpetual futures USDⓈ-M, jadi `binance_market` bawaannya `futures`.
use super::{FeedEvent, Tx};
use futures_util::{SinkExt, StreamExt};
use mcdash_core::{Bar, Bars};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::time::{sleep, timeout, MissedTickBehavior};
use tokio_tungstenite::tungstenite::Message;

/// Bar per permintaan REST (batas Binance: 1000 spot, 1500 futures; 1000 aman untuk keduanya).
const PAGE: usize = 1000;
/// Batas tanpa pesan APA PUN (data / pong / ping server) = koneksi mati. Klien mengirim ping WS
/// tiap PING_SECS dan server wajib menjawab pong (RFC 6455), jadi 75 dtk tanpa pesan apa pun
/// berarti koneksi zombie — pulih dalam ~75 dtk, bukan 240 dtk seperti sebelumnya.
const IDLE_SECS: u64 = 75;
/// Klien mengirim ping protokol WS tiap 25 dtk agar liveness tidak bergantung pada arus data
/// (pasar sepi / simbol tidak likuid bisa saja beberapa lama tanpa trade).
const PING_SECS: u64 = 25;
/// Batas halaman saat backfill setelah putus (mencegah loop tak berujung).
const MAX_BACKFILL_PAGES: usize = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Market {
    Futures,
    Spot,
}

impl Market {
    pub fn parse(s: &str) -> Market {
        if s.eq_ignore_ascii_case("spot") { Market::Spot } else { Market::Futures }
    }
    fn name(self) -> &'static str {
        match self {
            Market::Futures => "futures",
            Market::Spot => "spot",
        }
    }
    // MCDASH_BINANCE_REST / MCDASH_BINANCE_WS: untuk pengujian / proxy; bawaan = alamat resmi Binance
    fn rest_base(self) -> String {
        std::env::var("MCDASH_BINANCE_REST").unwrap_or_else(|_| {
            match self {
                Market::Futures => "https://fapi.binance.com",
                Market::Spot => "https://api.binance.com",
            }
            .to_string()
        })
    }
    fn ws_base(self) -> String {
        std::env::var("MCDASH_BINANCE_WS").unwrap_or_else(|_| {
            match self {
                // klines ada di jalur /market (URL futures lama tanpa jalur sudah dipensiunkan Binance)
                Market::Futures => "wss://fstream.binance.com/market/ws",
                Market::Spot => "wss://stream.binance.com:9443/ws",
            }
            .to_string()
        })
    }
    /// URL combined stream: beberapa stream dalam SATU koneksi (`.../stream?streams=a/b`).
    fn ws_combined(self, streams: &str) -> String {
        let base = self.ws_base();
        let root = base.strip_suffix("/ws").unwrap_or(&base);
        format!("{root}/stream?streams={streams}")
    }
    /// Stream harga trade realtime: aggTrade di futures, trade di spot.
    fn trade_stream(self) -> &'static str {
        match self {
            Market::Futures => "aggTrade",
            Market::Spot => "trade",
        }
    }
    fn klines_path(self) -> &'static str {
        match self {
            Market::Futures => "/fapi/v1/klines",
            Market::Spot => "/api/v3/klines",
        }
    }
    fn info_path(self) -> &'static str {
        match self {
            Market::Futures => "/fapi/v1/exchangeInfo",
            Market::Spot => "/api/v3/exchangeInfo",
        }
    }
}

/// `BINANCE:XAUUSDT.P` / `xau/usdt` / ` XAUUSDT ` -> `XAUUSDT`
pub fn normalize_symbol(s: &str) -> String {
    let s = s.trim();
    let s = s.rsplit(':').next().unwrap_or(s);
    let s = s.strip_suffix(".P").or_else(|| s.strip_suffix(".p")).unwrap_or(s);
    s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase()
}

/// Timeframe feed (menit) -> interval Binance. None bila Binance tidak punya timeframe itu.
pub fn interval(tf: i64) -> Option<&'static str> {
    Some(match tf {
        1 => "1m",
        3 => "3m",
        5 => "5m",
        15 => "15m",
        30 => "30m",
        60 => "1h",
        120 => "2h",
        240 => "4h",
        360 => "6h",
        480 => "8h",
        720 => "12h",
        1440 => "1d",
        _ => return None,
    })
}

fn as_f(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

/// Baris REST: `[openTimeMs, "o", "h", "l", "c", "v", closeTimeMs, ...]`
fn parse_row(r: &Value) -> Option<(i64, Bar)> {
    let a = r.as_array()?;
    let t = a.first()?.as_i64()?;
    Some((t, Bar { o: as_f(a.get(1)?)?, h: as_f(a.get(2)?)?, l: as_f(a.get(3)?)?, c: as_f(a.get(4)?)?, v: as_f(a.get(5)?)? }))
}

/// Respons REST klines -> [(open time ms, bar)], urut naik.
pub fn parse_klines(v: &Value) -> Result<Vec<(i64, Bar)>, String> {
    let arr = v.as_array().ok_or_else(|| format!("respons klines bukan array: {}", v.to_string().chars().take(160).collect::<String>()))?;
    let mut out: Vec<(i64, Bar)> = arr.iter().filter_map(parse_row).collect();
    out.sort_by_key(|(t, _)| *t);
    Ok(out)
}

/// Pesan WebSocket kline (bentuk mentah atau terbungkus `{"stream":..,"data":..}`) -> (open time detik, bar).
pub fn parse_ws_kline(raw: &str) -> Option<(i64, Bar)> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let v = v.get("data").unwrap_or(&v);
    if v.get("e")?.as_str()? != "kline" {
        return None;
    }
    let k = v.get("k")?;
    let bar = Bar { o: as_f(k.get("o")?)?, h: as_f(k.get("h")?)?, l: as_f(k.get("l")?)?, c: as_f(k.get("c")?)?, v: as_f(k.get("v")?)? };
    Some((k.get("t")?.as_i64()? / 1000, bar))
}

/// Pesan aggTrade (futures) / trade (spot) -> harga trade terakhir. Ini jalur harga realtime:
/// bergerak per TRADE, tidak menunggu update kline yang dikirim 1–2 detik sekali.
pub fn parse_ws_trade(raw: &str) -> Option<f64> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let v = v.get("data").unwrap_or(&v);
    let e = v.get("e")?.as_str()?;
    if e != "aggTrade" && e != "trade" {
        return None;
    }
    as_f(v.get("p")?)
}

/// tickSize filter PRICE_FILTER simbol; Err bila simbol tidak ada di daftar, Ok(None) bila ada tapi tanpa tickSize.
pub fn tick_size(info: &Value, symbol: &str) -> Result<Option<f64>, String> {
    let syms = info.get("symbols").and_then(|s| s.as_array()).ok_or("exchangeInfo tanpa daftar symbols")?;
    let s = syms.iter().find(|s| s.get("symbol").and_then(|x| x.as_str()) == Some(symbol)).ok_or("simbol tidak ada")?;
    let tick = s
        .get("filters")
        .and_then(|f| f.as_array())
        .and_then(|f| f.iter().find(|x| x.get("filterType").and_then(|t| t.as_str()) == Some("PRICE_FILTER")))
        .and_then(|f| f.get("tickSize"))
        .and_then(as_f)
        .filter(|t| *t > 0.0);
    Ok(tick)
}

enum Fail {
    Transient(String),
    /// Kena rate limit (HTTP 429/418): tunggu sejumlah detik ini (dari header Retry-After) lalu
    /// coba halaman yang sama lagi — pengambilan riwayat TIDAK diulang dari nol.
    RateLimit(u64),
    Fatal(String),
}

fn get_json(url: &str) -> Result<Value, Fail> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(25)).build();
    match agent.get(url).call() {
        Ok(r) => r.into_json::<Value>().map_err(|e| Fail::Transient(format!("respons bukan JSON: {e}"))),
        Err(ureq::Error::Status(code, resp)) => {
            // Retry-After (detik) dikirim Binance saat 429/418; pakai 5 dtk bila header tidak ada.
            let retry_after = resp
                .header("retry-after")
                .and_then(|v| v.trim().parse::<u64>().ok())
                .unwrap_or(5)
                .clamp(2, 120);
            let body = resp.into_string().unwrap_or_default();
            let msg = format!("Binance HTTP {code}: {}", body.chars().take(200).collect::<String>());
            match code {
                451 | 403 => Err(Fail::Fatal(format!("{msg} — Binance menolak IP/lokasi ini; coba VPN/proxy atau server di wilayah lain"))),
                400 | 404 => Err(Fail::Fatal(msg)), // mis. -1121 Invalid symbol, interval tidak valid
                418 | 429 => Err(Fail::RateLimit(retry_after)), // rate limit / ban sementara: tunggu lalu lanjut
                _ => Err(Fail::Transient(msg)),     // 5xx dan lainnya
            }
        }
        Err(e) => Err(Fail::Transient(e.to_string())),
    }
}

/// Riwayat mundur dari bar terbaru sampai `target` bar (atau awal data simbol).
/// `bars` adalah akumulator yang bertahan antar percobaan: koneksi putus / rate limit di tengah
/// jalan TIDAK mengulang dari nol — halaman berikutnya dilanjutkan dari bar terlama yang sudah
/// ada. Untuk target besar (mis. 200.000+ bar) ini wajib, karena Binance hanya memberi 1000 bar
/// per permintaan dan bisa mengirim 429 di tengah pengambilan.
fn fetch_history(market: Market, symbol: &str, iv: &str, target: i64, bars: &mut Bars) -> Result<(), Fail> {
    let base = market.rest_base();
    // Resume: mulai dari SEBELUM bar terlama yang sudah terkumpul (bila ada).
    let mut end = bars.keys().next().map(|&t| t - 1);
    while (bars.len() as i64) < target {
        let mut url = format!("{base}{}?symbol={symbol}&interval={iv}&limit={PAGE}", market.klines_path());
        if let Some(e) = end {
            url.push_str(&format!("&endTime={e}"));
        }
        let rows = {
            let mut tries = 0u32;
            loop {
                match get_json(&url) {
                    Ok(v) => break parse_klines(&v).map_err(Fail::Transient)?,
                    Err(Fail::RateLimit(wait)) => {
                        tries += 1;
                        if tries >= 10 {
                            return Err(Fail::Transient("terus-menerus kena rate limit (429/418)".into()));
                        }
                        eprintln!("[binance] kena rate limit, tunggu {wait} dtk lalu coba lagi ({tries}/10)");
                        std::thread::sleep(Duration::from_secs(wait));
                    }
                    Err(e) => return Err(e), // bars tetap terisi; percobaan berikutnya lanjut dari sini
                }
            }
        };
        let Some(&(first_ms, _)) = rows.first() else { break };
        let before = bars.len();
        let got = rows.len();
        for (t, b) in rows {
            bars.insert(t / 1000, b);
        }
        if bars.len() == before || got < PAGE {
            break; // sudah di awal data simbol
        }
        end = Some(first_ms - 1);
        std::thread::sleep(Duration::from_millis(60)); // ramah terhadap rate limit
    }
    while (bars.len() as i64) > target {
        bars.pop_first(); // buang yang terlama kelebihan
    }
    Ok(())
}

/// Bar dari `since_ms` (termasuk) sampai sekarang — mengisi celah setelah koneksi putus.
fn fetch_since(market: Market, symbol: &str, iv: &str, since_ms: i64) -> Result<Vec<(i64, Bar)>, Fail> {
    let base = market.rest_base();
    let mut out = vec![];
    let mut start = since_ms;
    for _ in 0..MAX_BACKFILL_PAGES {
        let url = format!("{base}{}?symbol={symbol}&interval={iv}&limit={PAGE}&startTime={start}", market.klines_path());
        let rows = parse_klines(&get_json(&url)?).map_err(Fail::Transient)?;
        let got = rows.len();
        let Some(&(last_ms, _)) = rows.last() else { break };
        out.extend(rows.into_iter().map(|(t, b)| (t / 1000, b)));
        if got < PAGE {
            break;
        }
        start = last_ms + 1;
        std::thread::sleep(Duration::from_millis(60));
    }
    Ok(out)
}

/// Ukuran 1 point = tickSize simbol. Sekaligus memastikan simbol memang ada di pasar yang dipilih.
fn fetch_tick(market: Market, symbol: &str) -> Result<Option<f64>, Fail> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<f64>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let key = format!("{}:{symbol}", market.name());
    if let Some(v) = cache.lock().unwrap().get(&key) {
        return Ok(*v);
    }
    let mut url = format!("{}{}", market.rest_base(), market.info_path());
    if market == Market::Spot {
        url.push_str(&format!("?symbol={symbol}")); // spot bisa difilter per simbol; futures mengembalikan semuanya
    }
    let info = get_json(&url)?;
    let tick = tick_size(&info, symbol).map_err(|e| {
        let hint = if market == Market::Futures {
            " (XAUUSDT/XAGUSDT & kripto ada di 'futures'; untuk pasar spot isi source.binance_market = \"spot\")"
        } else {
            " (XAUUSDT/XAGUSDT hanya ada di futures: source.binance_market = \"futures\")"
        };
        Fail::Fatal(format!("Binance {}: {e}: '{symbol}'{hint}", market.name()))
    })?;
    cache.lock().unwrap().insert(key, tick);
    Ok(tick)
}

struct State {
    id: u64,
    market: Market,
    symbol: String,
    tf: i64,
    iv: &'static str,
    target: i64,
    tx: Tx,
    bars: Bars,
    history_done: bool,
    got_data: bool,
    point: Option<f64>,
}

pub async fn run(id: u64, symbol: String, tf: i64, target: i64, market: Market, tx: Tx) {
    let symbol = normalize_symbol(&symbol);
    let Some(iv) = interval(tf) else {
        let _ = tx.send((id, FeedEvent::Died { tf, error: format!("Binance tidak punya timeframe {tf} menit (tersedia: 1, 3, 5, 15, 30, 60, 120, 240, 360, 480, 720, 1440)") }));
        return;
    };
    let mut st = State { id, market, symbol, tf, iv, target, tx, bars: Bars::new(), history_done: false, got_data: false, point: None };
    let mut backoff = 1u64;
    loop {
        match session(&mut st).await {
            Err(Fail::Fatal(e)) => {
                let _ = st.tx.send((st.id, FeedEvent::Died { tf: st.tf, error: e }));
                return;
            }
            Err(Fail::Transient(e)) => eprintln!("[binance M{}] terputus ({e}), reconnect {backoff}s", st.tf),
            // RateLimit biasanya sudah ditunggu di dalam fetch_history; kalau lolos (mis. dari
            // fetch_since), bar yang terkumpul tetap ada — reconnect lalu lanjut dari situ.
            Err(Fail::RateLimit(wait)) => eprintln!("[binance M{}] rate limit, tunggu {wait} dtk sebelum reconnect", st.tf),
            Ok(()) => {}
        }
        if st.got_data {
            backoff = 1;
            st.got_data = false;
        }
        sleep(Duration::from_secs(backoff)).await;
        backoff = (backoff * 2).min(30);
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, Fail> + Send + 'static) -> Result<T, Fail> {
    tokio::task::spawn_blocking(f).await.map_err(|e| Fail::Transient(format!("tugas REST gagal: {e}")))?
}

async fn session(st: &mut State) -> Result<(), Fail> {
    // 1) WebSocket dulu: pesan yang datang selama REST berjalan antre di socket dan diproses sesudahnya (tanpa celah).
    //    Combined stream: kline (untuk bar) + aggTrade/trade (harga realtime per trade) dalam satu koneksi.
    let sl = st.symbol.to_lowercase();
    let streams = format!("{sl}@kline_{iv}/{sl}@{tr}", sl = sl, iv = st.iv, tr = st.market.trade_stream());
    let url = st.market.ws_combined(&streams);
    let (mut ws, _) = timeout(Duration::from_secs(20), tokio_tungstenite::connect_async(url))
        .await
        .map_err(|_| Fail::Transient("timeout menyambung".into()))?
        .map_err(|e| Fail::Transient(e.to_string()))?;

    // 2) REST: riwayat penuh (sesi pertama) atau backfill dari bar terakhir (setelah reconnect)
    let (market, symbol, iv) = (st.market, st.symbol.clone(), st.iv);
    if !st.history_done {
        if st.point.is_none() {
            let sym = symbol.clone();
            st.point = blocking(move || fetch_tick(market, &sym)).await?;
        }
        let target = st.target;
        // Akumulator ikut masuk task dan dikembalikan bersama hasilnya, supaya riwayat parsial
        // yang sudah terkumpul tidak hilang saat koneksi terputus di tengah pengambilan —
        // percobaan berikutnya melanjutkan dari bar terlama (resume), bukan dari nol.
        let mut acc = std::mem::take(&mut st.bars);
        let (acc, res) = blocking(move || {
            let r = fetch_history(market, &symbol, iv, target, &mut acc);
            Ok((acc, r))
        })
        .await?;
        st.bars = acc;
        res?;
        if st.bars.is_empty() {
            return Err(Fail::Fatal(format!("Binance tidak mengembalikan bar untuk {} {}", st.symbol, st.iv)));
        }
        st.history_done = true;
        st.got_data = true;
        let _ = st.tx.send((st.id, FeedEvent::History { tf: st.tf, bars: st.bars.clone(), point: st.point }));
    } else if let Some(&last) = st.bars.keys().next_back() {
        let rows = blocking(move || fetch_since(market, &symbol, iv, last * 1000)).await?;
        if !rows.is_empty() {
            st.got_data = true;
            for (t, b) in &rows {
                st.bars.insert(*t, *b);
            }
            let _ = st.tx.send((st.id, FeedEvent::Live { tf: st.tf, bars: rows }));
        }
    }

    // 3) live — dengan ping klien berkala: koneksi zombie (tidak mengirim apa pun) terdeteksi ~IDLE_SECS
    let mut pinger = tokio::time::interval(Duration::from_secs(PING_SECS));
    pinger.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = pinger.tick() => {
                // ping protokol WS: server wajib menjawab pong -> pesan tetap mengalir walau pasar sepi
                if ws.send(Message::Ping(Vec::new())).await.is_err() {
                    return Err(Fail::Transient("gagal mengirim ping".into()));
                }
            }
            msg = timeout(Duration::from_secs(IDLE_SECS), ws.next()) => {
                let msg = msg
                    .map_err(|_| Fail::Transient(format!("timeout {IDLE_SECS} dtk tanpa data/pong")))?
                    .ok_or_else(|| Fail::Transient("koneksi ditutup".into()))?
                    .map_err(|e| Fail::Transient(e.to_string()))?;
                match msg {
                    Message::Text(t) => {
                        if let Some((ts, bar)) = parse_ws_kline(&t) {
                            st.got_data = true;
                            st.bars.insert(ts, bar);
                            let _ = st.tx.send((st.id, FeedEvent::Live { tf: st.tf, bars: vec![(ts, bar)] }));
                        } else if let Some(px) = parse_ws_trade(&t) {
                            // jalur cepat harga: per trade, tanpa menunggu bar
                            st.got_data = true;
                            let _ = st.tx.send((st.id, FeedEvent::Price { price: px }));
                        }
                    }
                    Message::Ping(p) => ws.send(Message::Pong(p)).await.map_err(|e| Fail::Transient(e.to_string()))?,
                    Message::Close(_) => return Err(Fail::Transient("koneksi ditutup".into())),
                    _ => {}
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalisasi_simbol() {
        assert_eq!(normalize_symbol("XAUUSDT"), "XAUUSDT");
        assert_eq!(normalize_symbol(" xauusdt "), "XAUUSDT");
        assert_eq!(normalize_symbol("BINANCE:XAUUSDT.P"), "XAUUSDT");
        assert_eq!(normalize_symbol("xau/usdt"), "XAUUSDT");
        assert_eq!(normalize_symbol("BTC-USDT"), "BTCUSDT");
    }

    #[test]
    fn interval_dari_timeframe_feed() {
        for (tf, iv) in [(1, "1m"), (3, "3m"), (5, "5m"), (15, "15m"), (30, "30m"), (60, "1h")] {
            assert_eq!(interval(tf), Some(iv));
        }
        assert_eq!(interval(7), None);
    }

    #[test]
    fn parse_klines_rest() {
        let v = json!([
            [1700000060000i64, "2.0", "3.0", "1.5", "2.5", "10", 1700000119999i64, "0", 0, "0", "0", "0"],
            [1700000000000i64, "1.0", "2.0", "0.5", "1.5", "7.5", 1700000059999i64, "0", 0, "0", "0", "0"]
        ]);
        let r = parse_klines(&v).unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].0, 1700000000000); // diurutkan naik
        assert_eq!(r[0].1, Bar { o: 1.0, h: 2.0, l: 0.5, c: 1.5, v: 7.5 });
        assert!(parse_klines(&json!({"code": -1121, "msg": "Invalid symbol."})).is_err());
    }

    #[test]
    fn parse_kline_websocket() {
        let raw = r#"{"e":"kline","E":1700000001000,"s":"XAUUSDT","k":{"t":1700000000000,"T":1700000059999,"s":"XAUUSDT","i":"1m","o":"4000.10","c":"4001.25","h":"4002.00","l":"3999.90","v":"12.5","x":false}}"#;
        let (ts, b) = parse_ws_kline(raw).unwrap();
        assert_eq!(ts, 1700000000);
        assert_eq!(b, Bar { o: 4000.10, h: 4002.0, l: 3999.90, c: 4001.25, v: 12.5 });
        // bentuk combined stream
        let wrapped = format!(r#"{{"stream":"xauusdt@kline_1m","data":{raw}}}"#);
        assert_eq!(parse_ws_kline(&wrapped).unwrap().0, 1700000000);
        // pesan non-kline diabaikan
        assert!(parse_ws_kline(r#"{"result":null,"id":1}"#).is_none());
    }

    #[test]
    fn parse_trade_websocket() {
        // futures aggTrade (bentuk mentah)
        let agg = r#"{"e":"aggTrade","E":1700000001000,"s":"XAUUSDT","a":123,"p":"4001.25","q":"0.5","f":1,"l":2,"T":1700000001000,"m":false}"#;
        assert_eq!(parse_ws_trade(agg), Some(4001.25));
        // spot trade (bentuk combined stream)
        let tr = r#"{"e":"trade","E":1700000002000,"s":"XAUUSDT","t":1,"p":"4001.30","q":"0.1","m":true}"#;
        let wrapped = format!(r#"{{"stream":"xauusdt@trade","data":{tr}}}"#);
        assert_eq!(parse_ws_trade(&wrapped), Some(4001.30));
        // pesan lain (kline / respons) bukan harga trade
        assert!(parse_ws_trade(r#"{"e":"kline","E":1,"s":"XAUUSDT","k":{"t":1,"o":"1","c":"1","h":"1","l":"1","v":"1"}}"#).is_none());
        assert!(parse_ws_trade(r#"{"result":null,"id":1}"#).is_none());
    }

    #[test]
    fn url_combined_stream() {
        let m = Market::Futures;
        let base = std::env::var("MCDASH_BINANCE_WS").unwrap_or_default();
        std::env::remove_var("MCDASH_BINANCE_WS");
        let url = m.ws_combined("xauusdt@kline_1m/xauusdt@aggTrade");
        assert_eq!(url, "wss://fstream.binance.com/market/stream?streams=xauusdt@kline_1m/xauusdt@aggTrade");
        let spot = Market::Spot.ws_combined("btcusdt@kline_1m/btcusdt@trade");
        assert_eq!(spot, "wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/btcusdt@trade");
        // kembalikan env bila sebelumnya diatur (pengujian dengan mock)
        if !base.is_empty() {
            std::env::set_var("MCDASH_BINANCE_WS", base);
        }
    }

    #[test]
    fn tick_size_dari_exchange_info() {
        let info = json!({"symbols": [
            {"symbol": "BTCUSDT", "filters": [{"filterType": "PRICE_FILTER", "tickSize": "0.10"}]},
            {"symbol": "XAUUSDT", "filters": [{"filterType": "LOT_SIZE", "stepSize": "0.001"}, {"filterType": "PRICE_FILTER", "tickSize": "0.01000000"}]}
        ]});
        assert_eq!(tick_size(&info, "XAUUSDT").unwrap(), Some(0.01));
        assert_eq!(tick_size(&info, "BTCUSDT").unwrap(), Some(0.1));
        assert!(tick_size(&info, "XAUUSD").is_err());
    }
}
