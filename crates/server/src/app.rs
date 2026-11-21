//! State bersama (dibaca HTTP/WS/Telegram, ditulis runner) dan bentuk frame WebSocket.
use crate::notifier::Notifier;
use mcdash_core::bias::Full;
use mcdash_core::Snap;
use serde::Serialize;
use std::path::PathBuf;
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

#[derive(Default)]
pub struct Shared {
    pub meta: Meta,
    pub snap: Option<Snap>, // harga di dalamnya selalu yang terbaru (ikut tick)
    pub snap_frame: Option<String>,
    pub tick: Option<TickState>,
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
