//! Jembatan MetaTrader 5: Expert Advisor `MCDashBridge` (lihat mt5/MCDashBridge.mq5) menyambung ke server ini lewat TCP.
//! Protokol "MCB1": satu objek JSON per baris, waktu bar dalam epoch UTC detik (EA yang mengonversi dari waktu server broker).
//!
//!   EA -> server : {"t":"hello","symbol":"XAUUSD","digits":3,"point":0.001}
//!                  {"t":"bars","tf":15,"b":[[t,o,h,l,c,v],...],"last":false|true}      (jawaban "need", boleh banyak potongan)
//!                  {"t":"live","bid":4012.34,"u":[{"tf":15,"b":[t,o,h,l,c,v],"p":[...]|null}, ...]}
//!                  {"t":"hb"}
//!   server -> EA : {"t":"need","tf":15,"count":20000}   |   {"t":"reject","why":"..."}
use super::{FeedEvent, Tx};
use mcdash_core::brokertime::ServerTz;
use mcdash_core::{Bar, Bars};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::time::timeout;

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Desired {
    pub tfs: Vec<i64>,
    pub count: i64,
    pub symbol_filter: String,
    pub server_tz: String, // source.mt5_server_tz
}

const IDLE: Duration = Duration::from_secs(30); // EA mengirim heartbeat tiap ~5 dtk

pub async fn run(id: u64, listen: SocketAddr, desired: watch::Receiver<Desired>, tx: Tx) {
    let mut listener = None;
    let mut last_err = String::new();
    for _ in 0..25 {
        // port bisa belum lepas tepat setelah listener lama dihentikan
        match TcpListener::bind(listen).await {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(e) => {
                last_err = e.to_string();
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
    let Some(listener) = listener else {
        let _ = tx.send((id, FeedEvent::Died { tf: 0, error: format!("tidak bisa membuka {listen}: {last_err}") }));
        return;
    };
    println!("[mt5] menunggu EA MCDashBridge di {listen}");
    let mut conns: tokio::task::JoinSet<()> = tokio::task::JoinSet::new(); // dibatalkan otomatis bila run() dihentikan
    loop {
        let Ok((sock, peer)) = listener.accept().await else { continue };
        println!("[mt5] EA terhubung dari {peer}");
        conns.abort_all(); // koneksi baru menggantikan yang lama
        conns.spawn(serve(id, sock, desired.clone(), tx.clone()));
    }
}

/// `off` = offset server (detik) yang dipakai EA untuk mengubah waktu bar ke "UTC". Bila ada aturan zona server (bukan `auto`),
/// waktu server mentah (t + off) dikonversi ulang PER BAR, sehingga riwayat yang melewati pergantian DST tetap benar.
fn bar_of(v: &Value, rule: &ServerTz, off: Option<i64>) -> Option<(i64, Bar)> {
    let a = v.as_array()?;
    let f = |i: usize| a.get(i).and_then(|x| x.as_f64());
    let mut t = f(0)? as i64;
    if let Some(off) = off {
        if let Some(utc) = rule.to_utc(t + off) {
            t = utc;
        }
    }
    Some((t, Bar { o: f(1)?, h: f(2)?, l: f(3)?, c: f(4)?, v: f(5).unwrap_or(0.0) }))
}

/// Riwayat dengan waktu server MENTAH -> epoch UTC, offset per pekan dideteksi dari pembukaan mingguan (mode auto).
/// Bila tidak terdeteksi, dipakai offset terukur untuk semua bar. Mengembalikan juga baris log.
fn convert_auto(bars: Bars, measured: i64) -> (Bars, Vec<String>) {
    let raws: Vec<i64> = bars.keys().copied().collect();
    match mcdash_core::brokertime::detect_offsets(&raws, measured) {
        Some((map, rep)) => (bars.into_iter().map(|(r, b)| (map.to_utc(r), b)).collect(), mcdash_core::brokertime::auto_report_lines(&rep)),
        None => (
            bars.into_iter().map(|(r, b)| (r - measured, b)).collect(),
            vec![format!("[mt5] zona waktu server: pembukaan mingguan tidak terdeteksi/tidak konsisten (instrumen 24/7, atau jam/zona waktu PC tempat MT5 berjalan tidak sesuai) -> memakai offset terukur saat ini (GMT{:+}) untuk seluruh riwayat; bar sebelum pergantian DST broker bisa bergeser 1 jam. Isi source.mt5_server_tz manual bila perlu.", measured as f64 / 3600.0)],
        ),
    }
}

/// Bandingkan offset terukur EA dengan aturan yang dikonfigurasi (pada waktu sekarang); kembalikan peringatan bila beda.
fn check_rule(rule: &ServerTz, off: i64, now_utc: i64) -> Option<String> {
    if rule.is_auto() {
        return None; // deteksi otomatis dari data, tidak ada aturan untuk dibandingkan
    }
    match rule.offset_at(now_utc) {
        Some(want) if want != off => Some(format!(
            "[mt5] PERINGATAN: aturan mt5_server_tz memberi GMT{:+}, tetapi EA mengukur GMT{:+}. Waktu bar bisa salah — periksa source.mt5_server_tz.",
            want as f64 / 3600.0,
            off as f64 / 3600.0
        )),
        _ => None,
    }
}

async fn write_line(wr: &mut tokio::net::tcp::OwnedWriteHalf, v: Value) -> std::io::Result<()> {
    let mut s = serde_json::to_string(&v).unwrap();
    s.push('\n');
    wr.write_all(s.as_bytes()).await
}

async fn serve(id: u64, sock: TcpStream, mut desired: watch::Receiver<Desired>, tx: Tx) {
    let _ = sock.set_nodelay(true);
    let (rd, mut wr) = sock.into_split();
    let mut lines = BufReader::new(rd).lines();
    let mut point: Option<f64> = None;
    let mut hello = false;
    let mut requested: HashMap<i64, i64> = HashMap::new(); // tf -> count yang sudah diminta
    let mut pending: HashMap<i64, Bars> = HashMap::new();
    let mut raw_pending: HashMap<i64, Vec<i64>> = HashMap::new(); // waktu server mentah (untuk diagnostik zona)
    let mut auto_off: HashMap<i64, i64> = HashMap::new(); // tf -> offset terukur, untuk riwayat yang disimpan dengan waktu server mentah
    let mut diag_span: i64 = 0; // rentang riwayat (detik) terpanjang yang sudah didiagnosis
    let end = |why: &str| {
        let _ = tx.send((id, FeedEvent::Status { text: Some(format!("EA MT5 terputus ({why}) — menunggu koneksi…")) }));
    };
    loop {
        tokio::select! {
            line = timeout(IDLE, lines.next_line()) => {
                let line = match line {
                    Err(_) => return end("tidak ada data 30 dtk"),
                    Ok(Err(e)) => return end(&e.to_string()),
                    Ok(Ok(None)) => return end("koneksi ditutup"),
                    Ok(Ok(Some(l))) => l,
                };
                let Ok(m) = serde_json::from_str::<Value>(line.trim()) else { continue };
                match m["t"].as_str().unwrap_or("") {
                    "hello" => {
                        let symbol = m["symbol"].as_str().unwrap_or("").to_string();
                        let want = desired.borrow().symbol_filter.clone();
                        if symbol.is_empty() || (!want.is_empty() && !want.eq_ignore_ascii_case(&symbol)) {
                            let why = format!("simbol '{symbol}' ditolak; server hanya menerima '{want}' (config source.mt5_symbol)");
                            let _ = write_line(&mut wr, json!({"t":"reject","why":why})).await;
                            let _ = tx.send((id, FeedEvent::Status { text: Some(why) }));
                            return;
                        }
                        point = m["point"].as_f64().filter(|p| *p > 0.0);
                        if m["off"].as_i64().is_none() {
                            let rule = ServerTz::parse(&desired.borrow().server_tz).unwrap_or(ServerTz::Auto);
                            if !rule.is_auto() {
                                println!("[mt5] PERINGATAN: mt5_server_tz diatur, tetapi EA tidak mengirim field 'off' — EA lama? Compile ulang MCDashBridge.mq5 dan pasang ulang; selama itu waktu bar TIDAK dikoreksi.");
                            }
                        }
                        if let Some(off) = m["off"].as_i64() {
                            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
                            let rule = ServerTz::parse(&desired.borrow().server_tz).unwrap_or(ServerTz::Auto);
                            if let Some(w) = check_rule(&rule, off, now) { println!("{w}"); }
                        }
                        hello = true;
                        requested.clear();
                        pending.clear();
                        let _ = tx.send((id, FeedEvent::Hello { symbol, point }));
                        let _ = tx.send((id, FeedEvent::Status { text: None }));
                        let d = desired.borrow().clone();
                        if send_needs(&mut wr, &d, &mut requested).await.is_err() { return end("gagal menulis"); }
                    }
                    "bars" if hello => {
                        let Some(tf) = m["tf"].as_i64() else { continue };
                        if !requested.contains_key(&tf) { continue; }
                        let entry = pending.entry(tf).or_default();
                        let rule = ServerTz::parse(&desired.borrow().server_tz).unwrap_or(ServerTz::Auto);
                        let off = m["off"].as_i64();
                        // auto + EA baru: simpan WAKTU SERVER MENTAH (t + off); dikonversi per pekan setelah riwayat lengkap
                        let auto_raw = rule.is_auto() && off.is_some();
                        for b in m["b"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
                            if auto_raw {
                                if let Some((t, bar)) = bar_of(b, &rule, None) { entry.insert(t + off.unwrap(), bar); }
                            } else if let Some((t, bar)) = bar_of(b, &rule, off) {
                                entry.insert(t, bar);
                            }
                            if let (Some(off), Some(t0)) = (off, b.get(0).and_then(|x| x.as_i64())) {
                                if tf >= 5 && !rule.is_auto() { raw_pending.entry(tf).or_default().push(t0 + off); }
                            }
                        }
                        if auto_raw { auto_off.insert(tf, off.unwrap()); }
                        if m["last"].as_bool().unwrap_or(false) {
                            if let Some(raw) = raw_pending.remove(&tf) {
                                let span = raw.iter().max().zip(raw.iter().min()).map(|(a, b)| a - b).unwrap_or(0);
                                if raw.len() >= 500 && span > diag_span {
                                    diag_span = span; // timeframe berikutnya hanya dilaporkan bila riwayatnya lebih panjang
                                    let cfg = desired.borrow().server_tz.clone();
                                    for l in mcdash_core::brokertime::diagnose_report(&mcdash_core::brokertime::diagnose(&raw, m["off"].as_i64().unwrap_or(0)), &cfg) { println!("{l}"); }
                                }
                            }
                            let mut bars = pending.remove(&tf).unwrap_or_default();
                            if let Some(measured) = auto_off.remove(&tf) {
                                let raws: Vec<i64> = bars.keys().copied().collect();
                                let span = raws.last().zip(raws.first()).map(|(a, b)| a - b).unwrap_or(0);
                                let verbose = span > diag_span; // timeframe berikutnya hanya dilaporkan bila riwayatnya lebih panjang
                                if verbose { diag_span = span; }
                                let (conv, lines) = convert_auto(bars, measured);
                                bars = conv;
                                if verbose { for l in lines { println!("{l}"); } }
                            }
                            let _ = tx.send((id, FeedEvent::History { tf, bars, point }));
                        }
                    }
                    "live" if hello => {
                        if let Some(bid) = m["bid"].as_f64() {
                            let _ = tx.send((id, FeedEvent::Price { price: bid }));
                        }
                        let rule = ServerTz::parse(&desired.borrow().server_tz).unwrap_or(ServerTz::Auto);
                        let off = m["off"].as_i64();
                        for u in m["u"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
                            let Some(tf) = u["tf"].as_i64() else { continue };
                            let mut bars: Vec<(i64, Bar)> = vec![];
                            for key in ["p", "b"] {
                                if let Some(x) = bar_of(&u[key], &rule, off) { bars.push(x); }
                            }
                            if !bars.is_empty() {
                                let _ = tx.send((id, FeedEvent::Live { tf, bars }));
                            }
                        }
                    }
                    _ => {}
                }
            }
            changed = desired.changed() => {
                if changed.is_err() { return; }
                let d = desired.borrow().clone();
                if hello && send_needs(&mut wr, &d, &mut requested).await.is_err() { return end("gagal menulis"); }
            }
        }
    }
}

/// Minta riwayat untuk timeframe yang belum diminta (atau jumlahnya berubah).
async fn send_needs(wr: &mut tokio::net::tcp::OwnedWriteHalf, d: &Desired, requested: &mut HashMap<i64, i64>) -> std::io::Result<()> {
    for tf in &d.tfs {
        if requested.get(tf) != Some(&d.count) {
            write_line(wr, json!({"t":"need","tf":tf,"count":d.count})).await?;
            requested.insert(*tf, d.count);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ts(y: i32, mo: u32, d: u32, h: u32) -> i64 {
        chrono::NaiveDate::from_ymd_opt(y, mo, d).unwrap().and_hms_opt(h, 0, 0).unwrap().and_utc().timestamp()
    }

    /// EA yang mengukur offset SAAT INI (GMT+3, musim panas) mengirim riwayat musim dingin yang salah 1 jam;
    /// dengan aturan ny_close server memperbaikinya per bar. Tanpa aturan (auto) nilai dari EA dipakai apa adanya.
    #[test]
    fn history_across_dst_is_corrected_per_bar() {
        let off = 3 * 3600; // offset terukur EA sekarang (musim panas)
        let raw_winter = ts(2026, 1, 15, 10); // 10:00 waktu server (GMT+2) = 08:00 UTC
        let sent = raw_winter - off; // EA salah: mengurangi +3, bukan +2
        let bar = json!([sent, 1.0, 2.0, 0.5, 1.5, 10]);
        let fixed = bar_of(&bar, &ServerTz::NyClose, Some(off)).unwrap().0;
        assert_eq!(fixed, ts(2026, 1, 15, 8));
        assert_eq!(bar_of(&bar, &ServerTz::Auto, Some(off)).unwrap().0, sent); // auto = perilaku lama
        assert_eq!(bar_of(&bar, &ServerTz::NyClose, None).unwrap().0, sent); // klien tanpa field off (fake_ea) tidak diubah
    }

    #[test]
    fn rule_check_flags_wrong_setting() {
        let now = ts(2026, 7, 15, 12); // NY musim panas -> server GMT+3
        assert!(check_rule(&ServerTz::NyClose, 3 * 3600, now).is_none());
        assert!(check_rule(&ServerTz::NyClose, 2 * 3600, now).unwrap().contains("PERINGATAN"));
        assert!(check_rule(&ServerTz::Auto, 3 * 3600, now).is_none()); // auto: tidak ada aturan untuk dibandingkan
    }

    /// Dari sisi EA: riwayat 1 tahun broker GMT+2/+3 (DST AS) dikirim dengan SATU offset (offset saat ini), lalu dikonversi `auto`.
    #[test]
    fn auto_conversion_recovers_true_utc_across_dst() {
        use chrono::{Duration, NaiveDate};
        let first_sun = NaiveDate::from_ymd_opt(2026, 1, 4).unwrap();
        let measured = 2 * 3600; // 15 Nov 2026: musim dingin
        let mut bars = Bars::new();
        let mut truth: Vec<(i64, i64)> = vec![]; // (utc benar, kunci mentah)
        for w in 0..46 {
            // 17:00 New York: server NyClose = NY+7 jam, jadi 17:00 NY = 24:00 jam dinding server -> UTC lewat aturan itu
            let wall = (first_sun + Duration::days(7 * w)).and_hms_opt(0, 0, 0).unwrap() + Duration::days(1);
            let open = ServerTz::NyClose.to_utc(wall.and_utc().timestamp()).unwrap();
            for u in (0..5).map(|k| open + k * 86400).chain([open + 5 * 86400 - 900]) {
                let server_off = ServerTz::NyClose.offset_at(u).unwrap(); // yang sebenarnya dipakai broker
                let raw = u + server_off;
                bars.insert(raw, Bar { o: 1.0, h: 1.0, l: 1.0, c: 1.0, v: 0.0 });
                truth.push((u, raw));
            }
        }
        let (conv, lines) = convert_auto(bars, measured);
        for (utc, _) in &truth {
            assert!(conv.contains_key(utc), "bar utc {utc} hilang/salah; log: {lines:?}");
        }
        assert!(lines.iter().any(|l| l.contains("TERDETEKSI OTOMATIS")));
    }
}
