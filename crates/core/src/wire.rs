//! Kontrak kawat server -> browser. Sumber kebenaran tipe TypeScript klien (`web/src/gen/*.ts`, lewat ts-rs).
//! Server membuat frame JSON dengan struct berpinjam / string manual (jalur cepat); tes di crate server
//! memastikan keluarannya selalu bisa dibaca kembali sebagai tipe-tipe di bawah ini, jadi tidak bisa melenceng.
use crate::bias::Full;
use crate::snapshot::Snap;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, TS)]
#[ts(export)]
pub struct Meta {
    pub ts: f64,
    pub status: String,
    pub config_error: Option<String>,
    pub build_ms: f64,
    pub feeds: BTreeMap<String, usize>,
    pub source: String,
}

/// Isi `/api/snapshot` dan bagian `s` pada frame snapshot.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct SnapDoc {
    pub meta: Meta,
    pub data: Option<Snap>,
}

/// Frame snapshot penuh (tanpa field `k`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct Msg {
    pub now: f64,
    pub s: SnapDoc,
    pub bias: Option<Full>,
}

/// Frame ringan, dibedakan oleh field `k`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum Frame {
    Meta { now: f64, meta: Meta },
    Tick {
        p: f64,
        wall: f64,
        age: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        bias: Option<Full>,
    },
}
