//! Bentuk JSON snapshot. Sama persis dengan keluaran engine Python, jadi klien TS tidak perlu berubah.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct TouchInfo {
    pub t: i64,
    pub t_ny: String,
    pub dir: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, TS)]
#[ts(export)]
pub struct Touches {
    #[serde(rename = "POC")]
    pub poc: Option<TouchInfo>,
    #[serde(rename = "VAH")]
    pub vah: Option<TouchInfo>,
    #[serde(rename = "VAL")]
    pub val: Option<TouchInfo>,
}

impl Touches {
    pub fn get(&self, k: &str) -> Option<&TouchInfo> {
        match k {
            "POC" => self.poc.as_ref(),
            "VAH" => self.vah.as_ref(),
            _ => self.val.as_ref(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct PerSnap {
    pub name: String,
    pub start: i64,
    pub end: i64,
    pub start_ny: String,
    pub end_ny: String,
    pub valid: bool,
    pub letters: usize,
    pub tick: f64,
    pub high: Option<f64>,
    pub low: Option<f64>,
    pub open: Option<f64>,
    pub close: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub poc: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub vah: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub val: Option<f64>,
    pub touch: Touches,
    // hanya untuk periode berjalan:
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lc: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lc_ny: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct Settings {
    pub count: usize,
    pub start: String,
    pub week_start: Option<String>,
    pub session_hours: Option<i64>,
    pub micro_min: Option<i64>,
    pub va_pct: f64,
    pub ticks: i64,
    pub rows: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct ProfSnap {
    pub tag: String,
    pub mode: String,
    pub tpo_min: i64,
    pub tf_min: i64,
    pub settings: Settings,
    pub items: Vec<PerSnap>,
    pub developing: Option<PerSnap>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct OpenCtx {
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dist: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub poc_side: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct NLevel {
    pub name: String,
    pub price: f64,
    pub dist: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct LastTouch {
    pub name: String,
    pub t: i64,
    pub dir: String,
    pub t_ny: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct Context {
    pub naked_count: usize,
    pub open_vs_va: BTreeMap<String, OpenCtx>,
    pub n_up: Option<NLevel>,
    pub n_down: Option<NLevel>,
    pub last_touch: BTreeMap<String, Option<LastTouch>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct Snap {
    pub symbol: String,
    pub tz: String,
    pub point: f64,
    pub price: f64,
    pub asof: i64,
    pub asof_ny: String,
    pub atr: f64,
    pub profiles: BTreeMap<String, ProfSnap>,
    pub context: Context,
}
