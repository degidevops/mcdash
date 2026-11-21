//! Bias: posisi Open periode berjalan vs Value Area periode sebelumnya (port bias.ts).
//!   Open > VAH sebelumnya -> BULLISH | Open < VAL sebelumnya -> BEARISH | di dalam VA -> BALANCE
//! "status" menilai apakah harga menerima (akseptasi) atau menolak posisi open tersebut.
use crate::snapshot::{PerSnap, Snap};
use crate::util::to_fixed;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum Dir {
    Bull,
    Bear,
    Bal,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct Bias {
    pub label: String, // BULLISH | BEARISH | BALANCE
    pub cls: String,   // up | dn | in
    pub open: String,
    pub status: String,
    pub sc: String, // up | dn | am | in
    pub eff: Dir,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct Verdict {
    pub text: String,
    pub cls: String,
}

fn sg(x: f64, dec: usize) -> String {
    format!("{}{}", if x >= 0.0 { '+' } else { '−' }, to_fixed(x.abs(), dec))
}

pub fn bias(price: f64, d: Option<&PerSnap>, pv: Option<&PerSnap>, dec: usize) -> Option<Bias> {
    let d = d?;
    let pv = pv?;
    if !d.valid || !pv.valid {
        return None;
    }
    let o = d.open?;
    let (vah, val, poc) = (pv.vah?, pv.val?, pv.poc?);
    let n = &pv.name;
    let f = |x: f64| to_fixed(x, dec);
    let mk = |label: &str, cls: &str, open: String, status: String, sc: &str, eff: Dir| Bias {
        label: label.into(), cls: cls.into(), open, status, sc: sc.into(), eff,
    };
    if o > vah {
        let hi = if pv.high.map_or(false, |h| price > h) { format!(" · di atas high {n}") } else { String::new() };
        let (status, sc, eff) = if price > vah {
            (format!("Akseptasi di atas VAH — bullish berlanjut{hi}"), "up", Dir::Bull)
        } else if price >= val {
            ("Kembali ke dalam VA — penolakan, bullish gagal".to_string(), "am", Dir::Bal)
        } else {
            ("Tembus VAL — reversal penuh ke bearish".to_string(), "dn", Dir::Bear)
        };
        return Some(mk("BULLISH", "up", format!("Open {} di atas VAH {} {} ({})", f(o), n, f(vah), sg(o - vah, dec)), status, sc, eff));
    }
    if o < val {
        let lo = if pv.low.map_or(false, |l| price < l) { format!(" · di bawah low {n}") } else { String::new() };
        let (status, sc, eff) = if price < val {
            (format!("Akseptasi di bawah VAL — bearish berlanjut{lo}"), "dn", Dir::Bear)
        } else if price <= vah {
            ("Kembali ke dalam VA — penolakan, bearish gagal".to_string(), "am", Dir::Bal)
        } else {
            ("Tembus VAH — reversal penuh ke bullish".to_string(), "up", Dir::Bull)
        };
        return Some(mk("BEARISH", "dn", format!("Open {} di bawah VAL {} {} ({})", f(o), n, f(val), sg(o - val, dec)), status, sc, eff));
    }
    let (status, sc, eff) = if price > vah {
        ("Breakout ke atas dari balance", "up", Dir::Bull)
    } else if price < val {
        ("Breakout ke bawah dari balance", "dn", Dir::Bear)
    } else {
        ("Rotasi di dalam VA", "in", Dir::Bal)
    };
    Some(mk("BALANCE", "in", format!("Open {} di dalam VA {} ({} POC {})", f(o), n, if o >= poc { "atas" } else { "bawah" }, f(poc)), status.to_string(), sc, eff))
}

/// Label dasar (dari Open) -> arah.
pub fn base_dir(b: &Bias) -> Dir {
    match b.label.as_str() {
        "BULLISH" => Dir::Bull,
        "BEARISH" => Dir::Bear,
        _ => Dir::Bal,
    }
}

/// Ringkasan beberapa profil jadi satu kalimat (dasar · close terakhir · realtime).
pub fn summarize(dirs: &[Option<Dir>]) -> Verdict {
    let v: Vec<Dir> = dirs.iter().flatten().copied().collect();
    if v.is_empty() {
        return Verdict { text: "n/a".into(), cls: "mu".into() };
    }
    let bull = v.iter().filter(|d| **d == Dir::Bull).count();
    let bear = v.iter().filter(|d| **d == Dir::Bear).count();
    let bal = v.len() - bull - bear;
    let cnt = format!("{bull} bull · {bear} bear · {bal} balance");
    let vd = |t: String, c: &str| Verdict { text: t, cls: c.into() };
    if bull > 0 && bear > 0 {
        return vd(format!("Campuran · {cnt}"), "am");
    }
    if bull == 0 && bear == 0 {
        return vd(format!("Balance · {cnt}"), "in");
    }
    let n = if bull > 0 { bull } else { bear };
    let (name, cls) = if bull > 0 { ("bullish", "up") } else { ("bearish", "dn") };
    if n == v.len() {
        return vd(format!("Selaras {name} · {cnt}"), cls);
    }
    if n > bal {
        return vd(format!("Condong {name} · {cnt}"), cls);
    }
    if n == bal {
        return vd(format!("Imbang {name} vs balance · {cnt}"), "am");
    }
    vd(format!("Condong balance · {cnt}"), "in")
}

/// Bias lengkap satu snapshot. Dipakai dashboard (dikirim ke browser) DAN Telegram, jadi keduanya selalu sama.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, TS)]
#[ts(export)]
pub struct Full {
    pub tags: Vec<String>,
    pub live: Vec<Option<Bias>>,   // label dasar + status dari harga realtime
    pub closed: Vec<Option<Bias>>, // status dari close huruf TPO terakhir yang sudah selesai
    #[serde(rename = "vBase")]
    pub v_base: Verdict,
    #[serde(rename = "vClose")]
    pub v_close: Verdict,
    #[serde(rename = "vLive")]
    pub v_live: Verdict,
}

pub const ORDER: [&str; 4] = ["W", "D", "S", "M"];

pub fn full_bias(s: &Snap, dec: usize, order: &[&str]) -> Full {
    let tags: Vec<String> = order.iter().filter(|t| s.profiles.contains_key(**t)).map(|t| t.to_string()).collect();
    let mut live = vec![];
    let mut closed = vec![];
    for t in &tags {
        let p = &s.profiles[t];
        let prev = p.items.last();
        live.push(bias(s.price, p.developing.as_ref(), prev, dec));
        closed.push(match &p.developing {
            Some(d) if d.lc.is_some() => bias(d.lc.unwrap(), Some(d), prev, dec),
            _ => None,
        });
    }
    Full {
        v_base: summarize(&live.iter().map(|b| b.as_ref().map(base_dir)).collect::<Vec<_>>()),
        v_close: summarize(&closed.iter().map(|b| b.as_ref().map(|b| b.eff)).collect::<Vec<_>>()),
        v_live: summarize(&live.iter().map(|b| b.as_ref().map(|b| b.eff)).collect::<Vec<_>>()),
        tags,
        live,
        closed,
    }
}
