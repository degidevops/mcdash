//! State bersama (dibaca HTTP/WS/Telegram, ditulis runner) dan bentuk frame WebSocket.
use crate::notifier::Notifier;
use mcdash_core::bias::Full;
use mcdash_core::Snap;
use serde::Serialize;
use std::path::PathBuf;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

pub fn now_f() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

pub use mcdash_core::wire::Meta;

#[derive(Clone, Debug)]
pub struct TickState {
    pub p: f64,
    pub wall: f64,
    pub bias_json: Option<String>,
}

/// Sumber data chart: 0 = sumber utama (config), 1 = Binance on-demand, 2 = TradingView on-demand.
pub const CHART_SRC_MAIN: u8 = 0;
pub const CHART_SRC_BINANCE: u8 = 1;
pub const CHART_SRC_TV: u8 = 2;

pub fn chart_src_name(kind: u8) -> &'static str {
    match kind {
        CHART_SRC_BINANCE => "binance",
        CHART_SRC_TV => "tv",
        _ => "main",
    }
}

/// Simbol untuk feed Binance alternatif chart. Binance hanya mengenal kutipan USDT/USDC,
/// jadi USD polos dari simbol TradingView/FX (XAUUSD, BTCUSD) dipetakan ke USDT.
pub fn chart_binance_symbol(sym: &str) -> String {
    let s = crate::feed::binance::normalize_symbol(sym);
    if s.ends_with("USDT") || s.ends_with("USDC") || s.ends_with("FDUSD") || s.ends_with("BUSD") {
        s
    } else if let Some(base) = s.strip_suffix("USD") {
        format!("{base}USDT")
    } else {
        s
    }
}

/// Sumber utama dideteksi dari teks meta.source ("tradingview" | "binance …" | "mt5 …").
pub fn primary_src_kind(meta_source: &str) -> u8 {
    if meta_source == "tradingview" {
        CHART_SRC_TV
    } else if meta_source.starts_with("binance") {
        CHART_SRC_BINANCE
    } else {
        CHART_SRC_MAIN
    }
}

#[derive(Default)]
pub struct Shared {
    pub meta: Meta,
    pub snap: Option<Snap>, // harga di dalamnya selalu yang terbaru (ikut tick)
    pub snap_frame: Option<String>,
    pub tick: Option<TickState>,
    pub chart_bars: HashMap<i64, mcdash_core::Bars>,
    /// Bar dari sumber alternatif untuk halaman /chart: (sumber, tf_menit) -> bars.
    /// Feed-nya dinyalakan on-demand oleh runner bila /api/chart-bars memintanya.
    pub chart_bars_ext: HashMap<(u8, i64), mcdash_core::Bars>,
    /// Permintaan terakhir per (sumber, tf) — bila tidak ada permintaan baru 15 menit, feed dimatikan.
    pub chart_want: HashMap<(u8, i64), f64>,
    /// Terakhir kali bar (sumber, tf) benar-benar dipakai (permintaan API atau data feed baru).
    /// Bar sumber alternatif dipertahankan 24 jam sejak waktu ini WALAU feed-nya sudah dimatikan,
    /// supaya membuka ulang sumber yang sama tidak mengambil ulang seluruh riwayat dari nol.
    pub chart_keep: HashMap<(u8, i64), f64>,
    /// Simbol TradingView untuk chart alternatif (config general.tv_symbol).
    pub chart_tv_symbol: String,
    pub chart_tpo: Option<mcdash_core::ChartTpoResponse>,
}

pub struct App {
    pub shared: RwLock<Shared>,
    pub tx: broadcast::Sender<String>,
    pub cfg_path: String,
    pub web_dir: PathBuf,
    pub notifier: Notifier,
}

#[derive(Serialize)]
struct SnapDoc<'a> {
    meta: &'a Meta,
    data: Option<&'a Snap>,
}
#[derive(Serialize)]
struct SnapFrame<'a> {
    now: f64,
    s: SnapDoc<'a>,
    bias: Option<&'a Full>,
}

pub fn snapshot_frame(meta: &Meta, snap: Option<&Snap>, full: Option<&Full>) -> String {
    serde_json::to_string(&SnapFrame { now: now_f(), s: SnapDoc { meta, data: snap }, bias: full }).unwrap_or_default()
}

pub fn snapshot_doc(meta: &Meta, snap: Option<&Snap>) -> String {
    serde_json::to_string(&SnapDoc { meta, data: snap }).unwrap_or_default()
}

pub fn meta_frame(meta: &Meta) -> String {
    format!("{{\"k\":\"meta\",\"now\":{},\"meta\":{}}}", now_f(), serde_json::to_string(meta).unwrap_or_default())
}

/// Frame tick harga (jalur cepat). `age` = umur tick sejak diterima engine, dihitung saat dikirim.
pub fn tick_frame(t: &TickState) -> String {
    let bias = t.bias_json.as_ref().map_or(String::new(), |b| format!(",\"bias\":{b}"));
    format!(
        "{{\"k\":\"tick\",\"p\":{},\"wall\":{},\"age\":{}{}}}",
        serde_json::to_string(&t.p).unwrap_or("0".into()),
        t.wall,
        (now_f() - t.wall).max(0.0),
        bias
    )
}

#[cfg(test)]
mod wire_tests {
    use super::*;
    use mcdash_core::wire::{Frame, Msg, SnapDoc};

    #[test]
    fn frames_match_wire_types() {
        let meta = Meta { ts: 1.5, status: "ok".into(), config_error: None, build_ms: 2.0, feeds: Default::default(), source: "tradingview".into() };
        let m: Msg = serde_json::from_str(&snapshot_frame(&meta, None, None)).expect("snapshot frame");
        assert_eq!(m.s.meta, meta);
        let d: SnapDoc = serde_json::from_str(&snapshot_doc(&meta, None)).expect("snapshot doc");
        assert!(d.data.is_none());
        match serde_json::from_str::<Frame>(&meta_frame(&meta)).expect("meta frame") {
            Frame::Meta { meta: got, .. } => assert_eq!(got, meta),
            _ => panic!("bukan frame meta"),
        }
        let t = TickState { p: 2650.123, wall: 10.0, bias_json: None };
        match serde_json::from_str::<Frame>(&tick_frame(&t)).expect("tick frame") {
            Frame::Tick { p, bias, .. } => {
                assert_eq!(p, 2650.123);
                assert!(bias.is_none());
            }
            _ => panic!("bukan frame tick"),
        }
    }
}
