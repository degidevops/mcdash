//! Notifikasi Telegram — bagian murni: pengaturan, isi pesan (bias lengkap + level per profil), dan mesin pemicu.
//! Pengiriman HTTP dilakukan crate server; semua keputusan "kapan kirim" ada di sini supaya mudah diuji.
//!
//! Kapan terkirim:
//!   on_change      bias berubah pada lapisan di `watch` dan bertahan >= confirm_sec (anti kedip), jeda >= min_interval_sec
//!   on_new_period  periode baru profil tertentu dimulai (mis. W/D/S), digabung dalam satu pesan
use crate::bias::{full_bias, Dir, ORDER};
use crate::snapshot::{PerSnap, Snap};
use crate::util::{decimals_of, to_fixed};
use serde_json::{json, Value};

// ---------------------------------------------------------------- pengaturan
#[derive(Clone, Debug, PartialEq)]
pub struct TgSettings {
    pub enabled: bool, // notifikasi otomatis (tombol manual tetap jalan)
    pub on_change: bool,
    pub watch: Vec<String>,         // lapisan pemicu: base | close | live
    pub on_new_period: Vec<String>, // tag profil
    pub confirm_sec: f64,
    pub min_interval_sec: f64,
    pub send_on_start: bool,
    pub profiles: Vec<String>, // profil yang disertakan di pesan
    pub level_atr: f64,        // naked level dalam ±N ATR dari harga (0 = semua)
    pub max_naked: i64,        // maks naked level per profil
}

impl Default for TgSettings {
    fn default() -> Self {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect();
        TgSettings {
            enabled: true,
            on_change: true,
            watch: s(&["base", "close"]),
            on_new_period: s(&["W", "D", "S"]),
            confirm_sec: 20.0,
            min_interval_sec: 300.0,
            send_on_start: false,
            profiles: s(&["W", "D", "S", "M"]),
            level_atr: 3.0,
            max_naked: 4,
        }
    }
}

fn num_json(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 1e15 { json!(x as i64) } else { json!(x) }
}

impl TgSettings {
    pub fn to_json(&self) -> Value {
        json!({
            "enabled": self.enabled, "on_change": self.on_change, "watch": self.watch, "on_new_period": self.on_new_period,
            "confirm_sec": num_json(self.confirm_sec), "min_interval_sec": num_json(self.min_interval_sec),
            "send_on_start": self.send_on_start, "profiles": self.profiles, "level_atr": num_json(self.level_atr), "max_naked": self.max_naked
        })
    }
}

const SECRET: [&str; 2] = ["token", "chat_id"];

fn num(v: &Value, key: &str, lo: f64, hi: f64) -> Result<f64, String> {
    match v.as_f64() {
        Some(x) if x.is_finite() && x >= lo && x <= hi => Ok(x),
        _ => Err(format!("{key}: harus angka {}–{}", num_str(lo), num_str(hi))),
    }
}
fn num_str(x: f64) -> String {
    if x.fract() == 0.0 { format!("{}", x as i64) } else { format!("{x}") }
}
fn boolean(v: &Value, key: &str) -> Result<bool, String> {
    v.as_bool().ok_or(format!("{key}: harus true/false"))
}
fn tag_list(v: &Value, key: &str) -> Result<Vec<String>, String> {
    let err = || format!("{key}: daftar dari {}", ORDER.join(", "));
    let arr = v.as_array().ok_or_else(err)?;
    let mut out: Vec<String> = vec![];
    for x in arr {
        let s = x.as_str().filter(|s| ORDER.contains(s)).ok_or_else(err)?;
        if !out.iter().any(|o| o == s) {
            out.push(s.to_string());
        }
    }
    Ok(out)
}

/// Kunci salah ketik ditolak dengan pesan jelas (token/chat_id dan kunci berawalan "_" diabaikan).
pub fn sanitize(raw: &Value) -> Result<TgSettings, String> {
    let mut s = TgSettings::default();
    let obj = raw.as_object().ok_or("telegram.json harus berupa objek {...}")?;
    for (k, v) in obj {
        if k.starts_with('_') || SECRET.contains(&k.as_str()) {
            continue;
        }
        match k.as_str() {
            "enabled" => s.enabled = boolean(v, k)?,
            "on_change" => s.on_change = boolean(v, k)?,
            "send_on_start" => s.send_on_start = boolean(v, k)?,
            "confirm_sec" => s.confirm_sec = num(v, k, 0.0, 3600.0)?,
            "min_interval_sec" => s.min_interval_sec = num(v, k, 0.0, 86400.0)?,
            "level_atr" => s.level_atr = num(v, k, 0.0, 50.0)?,
            "max_naked" => s.max_naked = (num(v, k, 0.0, 20.0)? + 0.5).floor() as i64,
            "on_new_period" => s.on_new_period = tag_list(v, k)?,
            "profiles" => s.profiles = tag_list(v, k)?,
            "watch" => {
                let err = || "watch: daftar dari base, close, live".to_string();
                let mut out: Vec<String> = vec![];
                for x in v.as_array().ok_or_else(err)? {
                    let w = x.as_str().filter(|w| ["base", "close", "live"].contains(w)).ok_or_else(err)?;
                    if !out.iter().any(|o| o == w) {
                        out.push(w.to_string());
                    }
                }
                s.watch = out;
            }
            _ => return Err(format!("kunci tidak dikenal: {k}")),
        }
    }
    Ok(s)
}

// ---------------------------------------------------------------- isi pesan
fn esc(t: &str) -> String {
    t.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}
fn icon(k: &str) -> &'static str {
    match k { "up" => "🟢", "dn" => "🔴", "in" => "🔵", "am" => "🟡", _ => "⚪" }
}
fn name_of(t: &str) -> &'static str {
    match t { "W" => "Weekly", "D" => "Daily", "S" => "Sessional", _ => "Micro" }
}
fn u16len(s: &str) -> usize {
    s.encode_utf16().count()
}
fn pad_end(s: &str, w: usize) -> String {
    format!("{}{}", s, " ".repeat(w.saturating_sub(u16len(s))))
}
fn pad_start(s: &str, w: usize) -> String {
    format!("{}{}", " ".repeat(w.saturating_sub(u16len(s))), s)
}
const LIMIT: usize = 3800; // batas aman di bawah 4096 karakter Telegram
const KEYS: [&str; 3] = ["VAH", "POC", "VAL"]; // urutan tampil

fn level_of(p: &PerSnap, k: &str) -> Option<f64> {
    if !p.valid { return None; }
    match k { "POC" => p.poc, "VAH" => p.vah, _ => p.val }
}

pub fn build_messages(s: &Snap, cfg: &TgSettings, reasons: &[String]) -> Vec<String> {
    let dec = decimals_of(s.point);
    let f = |x: Option<f64>| x.map_or("–".to_string(), |v| to_fixed(v, dec));
    let sg = |x: f64| format!("{}{}", if x >= 0.0 { '+' } else { '−' }, to_fixed(x.abs(), dec));
    let atr = if s.atr == 0.0 { 1.0 } else { s.atr };
    let order: Vec<&str> = ORDER.iter().copied().filter(|t| cfg.profiles.iter().any(|p| p == t)).collect();
    let fb = full_bias(s, dec, &order);

    let mut head: Vec<String> = vec![
        format!("<b>📊 {}</b>  <code>{}</code>  ·  ATR {}", esc(&s.symbol), f(Some(s.price)), f(Some(s.atr))),
        format!("<i>{} {}</i>", esc(&s.asof_ny), esc(&s.tz)),
    ];
    if !reasons.is_empty() {
        head.push(format!("<b>Pemicu:</b> {}", esc(&reasons.join(" · "))));
    }
    head.push(String::new());
    head.push("<b>BIAS</b>".into());
    head.push(format!("Dasar    {} {}", icon(&fb.v_base.cls), esc(&fb.v_base.text)));
    head.push(format!("Close    {} {}", icon(&fb.v_close.cls), esc(&fb.v_close.text)));
    head.push(format!("Realtime {} {}", icon(&fb.v_live.cls), esc(&fb.v_live.text)));
    let head = head.join("\n");

    let mut blocks: Vec<String> = vec![];
    for (i, t) in fb.tags.iter().enumerate() {
        let p = &s.profiles[t];
        let (Some(b), Some(d)) = (fb.live[i].as_ref(), p.developing.as_ref()) else {
            blocks.push(format!("<b>{t} · {}</b>  n/a", name_of(t)));
            continue;
        };
        let prev = p.items.last();
        let mut l: Vec<String> = vec![format!("<b>{t} · {}</b>  {} <b>{}</b>", name_of(t), icon(&b.cls), b.label), esc(&b.open)];
        l.push(match fb.closed[i].as_ref() {
            Some(cl) => format!(
                "Close ▸ {} {} <i>({}m · {} @ {})</i>",
                icon(&cl.sc), esc(&cl.status), p.tpo_min, f(d.lc), esc(&d.lc_ny.clone().unwrap_or_default().chars().skip(6).collect::<String>())
            ),
            None => "Close ▸ belum ada letter yang selesai".to_string(),
        });
        l.push(format!("Live  ▸ {} {}", icon(&b.sc), esc(&b.status)));

        // tabel level: VA periode sebelumnya vs yang berjalan
        let dname = d.name.strip_suffix("-now").map_or(d.name.clone(), |x| format!("{x} now"));
        let rows: Vec<(String, Option<&PerSnap>)> = vec![(prev.map_or(String::new(), |p| p.name.clone()), prev), (dname, Some(d))];
        let w = rows.iter().map(|r| u16len(&r.0)).max().unwrap_or(0).max(4);
        let cw = dec + 5;
        let line = |n: &str, p: &PerSnap| {
            format!("{}  {}", pad_end(n, w), KEYS.iter().map(|k| pad_start(&f(level_of(p, k)), cw)).collect::<Vec<_>>().join(" "))
        };
        let mut tbl: Vec<String> = vec![format!("{}  {}", pad_end("", w), KEYS.iter().map(|k| pad_start(k, cw)).collect::<Vec<_>>().join(" "))];
        for (n, p) in &rows {
            if let Some(p) = p {
                tbl.push(line(n, p));
            }
        }
        tbl.push(format!("Hi {}  Lo {}  Open {}", f(d.high), f(d.low), f(d.open)));

        // naked level terdekat
        let mut nk: Vec<(String, f64)> = vec![];
        for it in &p.items {
            if !it.valid { continue; }
            for k in KEYS {
                if it.touch.get(k).is_none() {
                    nk.push((format!("n{} {}", k, it.name), level_of(it, k).unwrap_or(0.0)));
                }
            }
        }
        let mut near: Vec<&(String, f64)> = nk.iter().filter(|n| cfg.level_atr <= 0.0 || (n.1 - s.price).abs() <= cfg.level_atr * atr).collect();
        near.sort_by(|a, b| (a.1 - s.price).abs().partial_cmp(&(b.1 - s.price).abs()).unwrap_or(std::cmp::Ordering::Equal));
        near.truncate(cfg.max_naked.max(0) as usize);
        if !near.is_empty() {
            let nw = near.iter().map(|n| u16len(&n.0)).max().unwrap_or(0);
            tbl.push(String::new());
            tbl.push(format!("naked{}", if cfg.level_atr > 0.0 { format!(" ±{} ATR", num_str(cfg.level_atr)) } else { String::new() }));
            for n in near {
                tbl.push(format!(
                    "{}  {}  {}  {}×",
                    pad_end(&n.0, nw), pad_start(&f(Some(n.1)), cw), pad_start(&sg(n.1 - s.price), cw), to_fixed((n.1 - s.price).abs() / atr, 1)
                ));
            }
        }
        l.push(format!("<pre>{}</pre>", esc(&tbl.join("\n"))));
        blocks.push(l.join("\n"));
    }

    let mut out: Vec<String> = vec![];
    let mut cur = head;
    for b in blocks {
        if u16len(&cur) + u16len(&b) + 2 > LIMIT {
            out.push(std::mem::replace(&mut cur, b));
        } else {
            cur.push_str("\n\n");
            cur.push_str(&b);
        }
    }
    out.push(cur);
    out
}

// ---------------------------------------------------------------- pemicu otomatis
#[derive(Clone, Debug, PartialEq)]
pub struct Layers {
    pub base: String,
    pub close: String,
    pub live: String,
}
pub type State = Vec<(String, Layers)>;

fn layer<'a>(l: &'a Layers, w: &str) -> &'a str {
    match w { "base" => &l.base, "close" => &l.close, _ => &l.live }
}
fn layer_name(w: &str) -> &'static str {
    match w { "base" => "dasar", "close" => "close", _ => "realtime" }
}
fn eff_name(d: Dir) -> &'static str {
    match d { Dir::Bull => "BULL", Dir::Bear => "BEAR", Dir::Bal => "BAL" }
}

pub fn state_of(s: &Snap, cfg: &TgSettings) -> State {
    let order: Vec<&str> = ORDER.iter().copied().filter(|t| cfg.profiles.iter().any(|p| p == t)).collect();
    let fb = full_bias(s, decimals_of(s.point), &order);
    fb.tags.iter().enumerate().map(|(i, t)| {
        let (b, c) = (&fb.live[i], &fb.closed[i]);
        (t.clone(), Layers {
            base: b.as_ref().map_or("N/A".into(), |b| b.label.clone()),
            close: c.as_ref().map_or("–".into(), |c| eff_name(c.eff).into()),
            live: b.as_ref().map_or("N/A".into(), |b| eff_name(b.eff).into()),
        })
    }).collect()
}

fn sig(st: &State, watch: &[String]) -> String {
    st.iter().map(|(t, l)| format!("{}|{}", t, watch.iter().map(|w| layer(l, w)).collect::<Vec<_>>().join("|"))).collect::<Vec<_>>().join(";")
}

fn diff(a: &State, b: &State, watch: &[String]) -> Vec<String> {
    let mut out = vec![];
    for (t, lb) in b {
        if let Some((_, la)) = a.iter().find(|(x, _)| x == t) {
            for w in watch {
                if layer(la, w) != layer(lb, w) {
                    out.push(format!("{} {}: {}→{}", t, layer_name(w), layer(la, w), layer(lb, w)));
                }
            }
        }
    }
    out
}

pub struct Fire {
    pub reasons: Vec<String>,
    cur: State,
}

#[derive(Default)]
pub struct Trigger {
    reference: Option<State>, // keadaan saat pesan terakhir (atau saat start)
    cur_sig: String,
    cur_since: f64, // keadaan sekarang bertahan sejak kapan
    starts: Vec<(String, i64)>,
    pend: Vec<String>,
    pend_since: f64,
    last_sent: f64,
    retry_at: f64,
}

impl Trigger {
    pub fn new() -> Trigger {
        Trigger::default()
    }

    /// Dipanggil tiap detik dengan snapshot terbaru. Mengembalikan pesan yang perlu dikirim (bila ada).
    pub fn step(&mut self, s: &Snap, cfg: &TgSettings, now: f64) -> Option<Fire> {
        let cur = state_of(s, cfg);
        let starts: Vec<(String, i64)> = cur.iter().map(|(t, _)| (t.clone(), s.profiles[t].developing.as_ref().map_or(0, |d| d.start))).collect();
        let find = |v: &Vec<(String, i64)>, t: &str| v.iter().find(|(x, _)| x == t).map(|(_, n)| *n);

        if self.reference.is_none() {
            // kondisi awal = acuan; tidak mengirim apa pun (kecuali send_on_start)
            self.reference = Some(cur.clone());
            self.cur_sig = sig(&cur, &cfg.watch);
            self.cur_since = now;
            self.starts = starts;
            return if cfg.enabled && cfg.send_on_start { Some(Fire { reasons: vec!["Start dashboard".into()], cur }) } else { None };
        }
        for t in &cfg.on_new_period {
            if let (Some(n), Some(o)) = (find(&starts, t), find(&self.starts, t)) {
                if n != o {
                    if !self.pend.contains(t) {
                        self.pend.push(t.clone());
                    }
                    if self.pend_since == 0.0 {
                        self.pend_since = now;
                    }
                }
            }
        }
        for (t, n) in &starts {
            match self.starts.iter_mut().find(|(x, _)| x == t) {
                Some(e) => e.1 = *n,
                None => self.starts.push((t.clone(), *n)),
            }
        }

        let sg = sig(&cur, &cfg.watch);
        if sg != self.cur_sig {
            self.cur_sig = sg.clone();
            self.cur_since = now;
        }
        if !cfg.enabled {
            // mati: pantau diam-diam, tanpa tunggakan
            self.reference = Some(cur);
            self.pend.clear();
            self.pend_since = 0.0;
            return None;
        }
        if now < self.retry_at {
            return None;
        }
        let refsig = sig(self.reference.as_ref().unwrap(), &cfg.watch);
        let change_due = cfg.on_change && sg != refsig && now - self.cur_since >= cfg.confirm_sec && now - self.last_sent >= cfg.min_interval_sec;
        let period_due = !self.pend.is_empty() && now - self.pend_since >= cfg.confirm_sec;
        if !change_due && !period_due {
            return None;
        }
        let mut reasons: Vec<String> = vec![];
        if period_due {
            reasons.push(format!("Periode baru: {}", self.pend.join(" ")));
        }
        if change_due {
            reasons.extend(diff(self.reference.as_ref().unwrap(), &cur, &cfg.watch));
        }
        Some(Fire { reasons, cur })
    }

    pub fn sent(&mut self, f: Fire, now: f64) {
        self.reference = Some(f.cur);
        self.pend.clear();
        self.pend_since = 0.0;
        self.last_sent = now;
    }

    pub fn failed(&mut self, now: f64) {
        self.retry_at = now + 60.0; // coba lagi 1 menit kemudian
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load() -> Snap {
        let p = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/xau_default.json");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
        serde_json::from_value(v["expected"].clone()).unwrap()
    }
    fn set_lc(s: &mut Snap, tag: &str, to_far_below: bool) {
        let p = s.profiles.get_mut(tag).unwrap();
        let pv = p.items.last().unwrap().clone();
        let (vah, val) = (pv.vah.unwrap(), pv.val.unwrap());
        p.developing.as_mut().unwrap().lc = Some(if to_far_below { val - 500.0 } else { (vah + val) / 2.0 });
    }

    #[test]
    fn pesan_lengkap_dan_aman() {
        let s = load();
        let m = build_messages(&s, &TgSettings::default(), &["Manual".into()]);
        assert!(m.iter().all(|x| u16len(x) < 4096));
        let all = m.join("\n");
        assert!(all.contains("<b>BIAS</b>") && all.contains("Pemicu:") && all.contains("Realtime"));
        for t in ["W · Weekly", "D · Daily", "S · Sessional", "M · Micro"] {
            assert!(all.contains(t), "{t}");
        }
        assert_eq!(all.matches("<pre>").count(), all.matches("</pre>").count());
        // simbol dengan karakter HTML harus di-escape
        let mut s2 = s.clone();
        s2.symbol = "A<B>&C".into();
        assert!(build_messages(&s2, &TgSettings::default(), &[]).join("").contains("A&lt;B&gt;&amp;C"));
    }

    #[test]
    fn pesan_dipecah_bila_panjang() {
        let s = load();
        let mut cfg = TgSettings::default();
        cfg.max_naked = 20;
        cfg.level_atr = 0.0;
        let m = build_messages(&s, &cfg, &[]);
        assert!(m.iter().all(|x| u16len(x) <= 4096));
    }

    #[test]
    fn sanitize_menolak_salah_ketik() {
        assert!(sanitize(&json!({"typo_key": 1})).unwrap_err().contains("tidak dikenal"));
        assert!(sanitize(&json!({"watch": ["x"]})).is_err());
        assert!(sanitize(&json!({"confirm_sec": "20"})).is_err());
        let ok = sanitize(&json!({"token": "x", "chat_id": 1, "_help": "y", "watch": ["base", "base", "live"], "max_naked": 2.6})).unwrap();
        assert_eq!(ok.watch, vec!["base", "live"]);
        assert_eq!(ok.max_naked, 3);
    }

    #[test]
    fn pemicu_perubahan_stabil_dan_jeda() {
        let cfg = TgSettings { confirm_sec: 20.0, min_interval_sec: 100.0, ..Default::default() };
        let mut t = Trigger::new();
        let mut s = load();
        set_lc(&mut s, "W", false);
        let mut now = 1000.0;
        assert!(t.step(&s, &cfg, now).is_none(), "baseline tidak mengirim");
        set_lc(&mut s, "W", true); // W close jadi bear
        now += 5.0;
        assert!(t.step(&s, &cfg, now).is_none(), "belum stabil");
        now += 20.0;
        let f = t.step(&s, &cfg, now).expect("stabil >= confirm -> kirim");
        assert!(f.reasons.iter().any(|r| r.starts_with("W close:")), "{:?}", f.reasons);
        t.sent(f, now);
        now += 30.0;
        assert!(t.step(&s, &cfg, now).is_none(), "tidak kirim ulang");
        set_lc(&mut s, "W", false); // kembali balance, tapi min_interval belum lewat
        now += 25.0;
        assert!(t.step(&s, &cfg, now).is_none(), "min_interval menahan");
        now += 100.0;
        assert!(t.step(&s, &cfg, now).is_some(), "setelah min_interval kirim");
    }

    #[test]
    fn pemicu_kedip_periode_dan_lapisan() {
        let cfg = TgSettings { confirm_sec: 20.0, min_interval_sec: 100.0, ..Default::default() };
        let mut t = Trigger::new();
        let mut s = load();
        set_lc(&mut s, "S", false);
        let mut now = 1000.0;
        t.step(&s, &cfg, now);
        set_lc(&mut s, "S", true); // kedip: berubah lalu kembali sebelum confirm
        now += 10.0;
        assert!(t.step(&s, &cfg, now).is_none());
        set_lc(&mut s, "S", false);
        now += 200.0;
        assert!(t.step(&s, &cfg, now).is_none(), "kedip tidak dikirim");
        // periode baru D
        s.profiles.get_mut("D").unwrap().developing.as_mut().unwrap().start += 86400;
        now += 1.0;
        assert!(t.step(&s, &cfg, now).is_none(), "menunggu confirm");
        now += 25.0;
        let f = t.step(&s, &cfg, now).expect("periode baru D");
        assert!(f.reasons[0].contains("Periode baru: D"));
        t.sent(f, now);
        // M bukan di on_new_period; realtime saja tidak ikut watch default
        s.profiles.get_mut("M").unwrap().developing.as_mut().unwrap().start += 3600;
        s.price += 300.0;
        now += 300.0;
        assert!(t.step(&s, &cfg, now).is_none());
    }

    #[test]
    fn pemicu_gagal_diulang_dan_nonaktif() {
        let cfg = TgSettings { confirm_sec: 0.0, min_interval_sec: 0.0, ..Default::default() };
        let mut t = Trigger::new();
        let mut s = load();
        set_lc(&mut s, "W", false);
        let mut now = 1000.0;
        t.step(&s, &cfg, now);
        set_lc(&mut s, "W", true);
        now += 1.0;
        let f = t.step(&s, &cfg, now);
        assert!(f.is_some());
        t.failed(now); // gagal kirim
        now += 30.0;
        assert!(t.step(&s, &cfg, now).is_none(), "tunggu 60 dtk");
        now += 40.0;
        assert!(t.step(&s, &cfg, now).is_some(), "ulang setelah 60 dtk");
        // dinonaktifkan: tidak ada tunggakan
        let off = TgSettings { enabled: false, ..cfg.clone() };
        set_lc(&mut s, "W", false);
        now += 10.0;
        assert!(t.step(&s, &off, now).is_none());
        now += 10.0;
        assert!(t.step(&s, &cfg, now).is_none(), "acuan sudah diperbarui saat nonaktif");
    }
}
