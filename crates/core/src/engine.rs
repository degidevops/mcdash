//! Mesin TPO: dari bar beberapa timeframe -> profil -> snapshot.
use crate::calendar::{Calendar, Mode};
use crate::period::{Period, KINDS};
use crate::profile::{Profile, ProfileCfg};
use crate::series::{Bars, Series};
use crate::snapshot::*;
use crate::util::{decimals_of, fmt_f, fmt_g, fmt_thousands0};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

pub const DAYS_ID: [&str; 7] = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

/// Cache baris histogram per (tag profil, awal periode) -> (sidik, baris). Periode selesai hanya dihitung sekali.
type RowsCache = HashMap<(String, i64), (u64, Arc<Vec<crate::period::TpoRowSnap>>)>;

pub struct TpoEngine {
    pub symbol: String,
    pub point: f64,
    pub tz: String,
    cal: Calendar, // hanya untuk format waktu
    pub cfgs: Vec<ProfileCfg>,
    feed_tf: Vec<i64>, // sejajar dengan cfgs
    atr_period: usize,
    atr_feed_tf: i64,
    profiles: Vec<(String, Profile, i64)>, // tag, profil, tf_min
    pub price: f64,
    pub atr: f64,
    pub asof: i64,
    rows_cache: Arc<Mutex<RowsCache>>,
}

impl TpoEngine {
    pub fn new(symbol: &str, point: f64, tz: &str, cfgs: Vec<ProfileCfg>, atr_period: usize, atr_feed_tf: i64) -> Result<TpoEngine, String> {
        let mut feed_tf = vec![];
        for c in &cfgs {
            feed_tf.push(c.resolve_feed_tf()?);
        }
        Ok(TpoEngine {
            symbol: symbol.to_string(),
            point,
            tz: tz.to_string(),
            cal: Calendar::new(tz, 18, 0, 6, 6, 4)?,
            cfgs,
            feed_tf,
            atr_period,
            atr_feed_tf,
            profiles: vec![],
            price: 0.0,
            atr: 0.0,
            asof: 0,
            rows_cache: Default::default(),
        })
    }

    /// Salinan konfigurasi (tanpa hasil perhitungan) untuk dihitung di thread terpisah; cache baris dipakai bersama.
    pub fn fresh(&self) -> TpoEngine {
        TpoEngine {
            symbol: self.symbol.clone(),
            point: self.point,
            tz: self.tz.clone(),
            cal: self.cal.clone(),
            cfgs: self.cfgs.clone(),
            feed_tf: self.feed_tf.clone(),
            atr_period: self.atr_period,
            atr_feed_tf: self.atr_feed_tf,
            profiles: vec![],
            price: 0.0,
            atr: 0.0,
            asof: 0,
            rows_cache: self.rows_cache.clone(),
        }
    }

    /// Timeframe feed yang dibutuhkan, dari terbesar.
    pub fn needed_tfs(&self) -> Vec<i64> {
        let mut v: Vec<i64> = self.feed_tf.clone();
        v.sort_unstable();
        v.dedup();
        v.reverse();
        v
    }

    pub fn ready(&self, bars: &HashMap<i64, Bars>) -> bool {
        self.needed_tfs().iter().all(|tf| bars.get(tf).map_or(false, |b| !b.is_empty()))
    }

    pub fn rebuild(&mut self, bars: &HashMap<i64, Bars>) -> Result<(), String> {
        let series = self.prepare_series(bars)?;
        self.rebuild_series(&series)
    }

    /// Salin HANYA bar yang dipakai perhitungan: jendela `count` periode per profil (plus lookback tick otomatis),
    /// serta ekor pendek untuk harga & ATR. Dengan begitu biaya hitung tidak ikut membesar saat history_bars besar.
    pub fn prepare_series(&self, bars: &HashMap<i64, Bars>) -> Result<BTreeMap<i64, Series>, String> {
        let present: BTreeMap<i64, &Bars> = bars.iter().filter(|(_, b)| !b.is_empty()).map(|(tf, b)| (*tf, b)).collect();
        let finest = *present.keys().next().ok_or("tidak ada data bar")?;
        let atr_tf = if present.contains_key(&self.atr_feed_tf) {
            self.atr_feed_tf
        } else if present.contains_key(&15) {
            15
        } else {
            finest
        };
        let mut from: BTreeMap<i64, i64> = BTreeMap::new(); // tf -> waktu bar tertua yang dibutuhkan
        let mut need_tail = |tf: i64, ts: i64| {
            let e = from.entry(tf).or_insert(ts);
            *e = (*e).min(ts);
        };
        for tf in [finest, atr_tf] {
            let b = present[&tf];
            if let Some((ts, _)) = b.iter().rev().take(self.atr_period + 2).last() {
                need_tail(tf, *ts);
            }
        }
        for (i, cfg) in self.cfgs.iter().enumerate() {
            let tf = self.feed_tf[i];
            let Some(b) = present.get(&tf) else { continue };
            let pf = Profile::new(cfg.clone(), &self.tz, tf, self.point)?;
            let (ps, lookback) = pf.window(*b.keys().next_back().unwrap(), tf);
            let start = b.range(..ps).rev().take(lookback).last().map_or(ps, |(ts, _)| *ts);
            need_tail(tf, start);
        }
        Ok(from.into_iter().map(|(tf, ts)| (tf, Series::from_iter(tf, present[&tf].range(ts..)))).collect())
    }

    pub fn rebuild_series(&mut self, series: &BTreeMap<i64, Series>) -> Result<(), String> {
        self.profiles.clear();
        for (i, cfg) in self.cfgs.iter().enumerate() {
            if let Some(ser) = series.get(&self.feed_tf[i]) {
                let mut pf = Profile::new(cfg.clone(), &self.tz, ser.tf_min, self.point)?;
                pf.build(ser);
                self.profiles.push((cfg.tag.clone(), pf, ser.tf_min));
            }
        }
        let fine = series.values().next().ok_or("tidak ada data bar")?; // timeframe terkecil
        self.price = *fine.c.last().ok_or("tidak ada data bar")?;
        self.asof = *fine.t.last().unwrap();
        let rf = series.get(&self.atr_feed_tf).or_else(|| series.get(&15)).unwrap_or(fine);
        self.atr = rf.atr(self.atr_period);
        Ok(())
    }

    fn period_snap(&self, p: &Period, name: &str) -> PerSnap {
        let cal = &self.cal;
        let tc = |k: usize| {
            p.touch[k].map(|(t, d)| TouchInfo { t, t_ny: cal.fmt(t, false), dir: if d > 0 { "bawah".into() } else { "atas".into() } })
        };
        PerSnap {
            name: name.to_string(),
            start: p.start,
            end: p.end,
            start_ny: cal.fmt(p.start, false),
            end_ny: cal.fmt(p.end + 1, false),
            valid: p.valid,
            letters: p.lh.len(),
            tick: p.tick,
            high: if p.lh.is_empty() { None } else { Some(p.d_high) },
            low: if p.lh.is_empty() { None } else { Some(p.d_low) },
            open: if p.has_open { Some(p.open_p) } else { None },
            close: p.close_p,
            poc: if p.valid { Some(p.poc) } else { None },
            vah: if p.valid { Some(p.vah) } else { None },
            val: if p.valid { Some(p.val) } else { None },
            touch: Touches { poc: tc(0), vah: tc(1), val: tc(2) },
            lc: None,
            lc_ny: None,
        }
    }

    fn open_vs_va(&self, pf: &Profile) -> OpenCtx {
        let na = OpenCtx { state: "n/a".into(), dist: None, poc_side: None };
        let (Some(cur), Some(pv)) = (pf.cur.as_ref(), pf.items.last()) else { return na };
        if !cur.has_open || !pv.valid {
            return na;
        }
        let o = cur.open_p;
        if o > pv.vah {
            return OpenCtx { state: "Above VAH".into(), dist: Some(o - pv.vah), poc_side: None };
        }
        if o < pv.val {
            return OpenCtx { state: "Below VAL".into(), dist: Some(pv.val - o), poc_side: None };
        }
        OpenCtx { state: "Inside VA".into(), dist: None, poc_side: Some(if o >= pv.poc { "atas" } else { "bawah" }.into()) }
    }

    fn last_touch(&self, pf: &Profile) -> Option<LastTouch> {
        let mut best: Option<LastTouch> = None;
        for (i, p) in pf.items.iter().enumerate() {
            for (k, kind) in KINDS.iter().enumerate() {
                if let Some((t, d)) = p.touch[k] {
                    if best.as_ref().map_or(true, |b| t >= b.t) {
                        best = Some(LastTouch {
                            name: format!("n{} {}", kind, pf.name(i)),
                            t,
                            dir: if d > 0 { "bawah".into() } else { "atas".into() },
                            t_ny: self.cal.fmt(t, false),
                        });
                    }
                }
            }
        }
        best
    }

    /// Isi satu profil per baris (mis. "S-1", "D-now") untuk dibandingkan dengan platform lain.
    pub fn dump(&self, name: &str) -> Result<String, String> {
        let dec = decimals_of(self.point).max(2);
        let mut names: Vec<String> = vec![];
        for (tag, pf, _) in &self.profiles {
            let mut all: Vec<(String, &Period)> = pf.items.iter().enumerate().map(|(i, p)| (pf.name(i), p)).collect();
            if let Some(c) = pf.cur.as_ref() {
                all.push((format!("{tag}-now"), c));
            }
            for (n, p) in all {
                if !n.eq_ignore_ascii_case(name) {
                    names.push(n);
                    continue;
                }
                let c = &pf.cfg;
                let bound_desc = match c.va_bound {
                    crate::period::VaBound::Center => "(VAH/VAL = harga pusat baris, gaya Sierra/ATAS)",
                    crate::period::VaBound::Edge => "(VAH/VAL = tepi baris, bukan pusat baris)",
                };
                let mut l = vec![
                    format!(
                        "=== {} | {} -> {} {} | TPO {}m | VA {}% {:?} {:?} (POC {:?}, VA-tie {:?}, Stop {:?}) ===",
                        n, self.cal.fmt(p.start, true), self.cal.fmt(p.end + 1, true), self.tz, c.tpo_min, fmt_g(c.va_pct), c.va_method, c.va_bound, c.poc_rule, c.va_tie_break, c.va_stop
                    ),
                    format!(
                        "High {} Low {} | Open {} | baris {} ({} baris) | {} huruf | total TPO {} | VA {} baris",
                        fmt_f(p.d_high, dec), fmt_f(p.d_low, dec), fmt_f(p.open_p, dec), fmt_g(p.tick), p.n_bins, p.lh.len(), p.total_tpo(), p.va_rows()
                    ),
                    format!("POC {} VAH {} VAL {}  {}", fmt_f(p.poc, dec), fmt_f(p.vah, dec), fmt_f(p.val, dec), bound_desc),
                    "harga(pusat baris)  TPO  tanda  huruf".to_string(),
                ];
                l.push(p.dump());
                return Ok(l.join("\n"));
            }
        }
        Err(format!("profil '{name}' tidak ada. Tersedia: {}", names.join(", ")))
    }

    pub fn snapshot(&self) -> Snap {
        let (price, pt) = (self.price, self.point);
        let mut naked: Vec<(String, f64)> = vec![];
        let mut ctx_open = BTreeMap::new();
        let mut last = BTreeMap::new();
        let mut profs = BTreeMap::new();
        for (tag, pf, tf_min) in &self.profiles {
            let c = &pf.cfg;
            let mut dev = pf.cur.as_ref().map(|cur| self.period_snap(cur, &format!("{}-now", tag)));
            if let (Some(d), Some(cur)) = (dev.as_mut(), pf.cur.as_ref()) {
                d.lc = cur.lc;
                d.lc_ny = cur.lc_t.map(|t| self.cal.fmt(t, false));
            }
            profs.insert(
                tag.clone(),
                ProfSnap {
                    tag: tag.clone(),
                    mode: c.mode.as_str().into(),
                    tpo_min: c.tpo_min,
                    tf_min: *tf_min,
                    settings: Settings {
                        count: c.count,
                        start: format!("{:02}:{:02}", c.start_h, c.start_m),
                        week_start: if c.mode == Mode::Weekly { Some(DAYS_ID[c.week_start as usize].into()) } else { None },
                        session_hours: if c.mode == Mode::Session { Some(c.sess_hours) } else { None },
                        micro_min: if c.mode == Mode::Micro { Some(c.sess_hours * 60 / c.parts) } else { None },
                        va_pct: c.va_pct,
                        ticks: c.ticks,
                        rows: c.rows,
                    },
                    items: pf.items.iter().enumerate().map(|(i, p)| self.period_snap(p, &pf.name(i))).collect(),
                    developing: dev,
                },
            );
            naked.extend(pf.naked_levels());
            ctx_open.insert(tag.clone(), self.open_vs_va(pf));
            last.insert(tag.clone(), self.last_touch(pf));
        }
        // nLevel terdekat di atas / di bawah harga (yang pertama bila sama dekat)
        let mut up: Option<&(String, f64)> = None;
        let mut dn: Option<&(String, f64)> = None;
        for n in &naked {
            if n.1 > price && up.map_or(true, |u| n.1 - price < u.1 - price) {
                up = Some(n);
            }
            if n.1 < price && dn.map_or(true, |d| price - n.1 < price - d.1) {
                dn = Some(n);
            }
        }
        Snap {
            symbol: self.symbol.clone(),
            tz: self.tz.clone(),
            point: pt,
            price,
            asof: self.asof,
            asof_ny: self.cal.fmt(self.asof, true),
            atr: self.atr,
            profiles: profs,
            context: Context {
                naked_count: naked.len(),
                open_vs_va: ctx_open,
                n_up: up.map(|u| NLevel { name: u.0.clone(), price: u.1, dist: u.1 - price }),
                n_down: dn.map(|d| NLevel { name: d.0.clone(), price: d.1, dist: price - d.1 }),
                last_touch: last,
            },
        }
    }

    /// Ekspor representasi TPO lengkap untuk rendering overlay di chart.
    pub fn chart_tpo(&self) -> ChartTpoResponse {
        let mut profiles = BTreeMap::new();
        let mut naked = Vec::new();
        let mut cache = self.rows_cache.lock().unwrap_or_else(|e| e.into_inner());
        let mut keep: RowsCache = HashMap::new();

        for (tag, pf, tf_min) in &self.profiles {
            let mut periods = Vec::new();
            let all = pf
                .items
                .iter()
                .enumerate()
                .map(|(i, p)| (pf.name(i), p, false))
                .chain(pf.cur.iter().map(|c| (format!("{tag}-now"), c, true)));

            for (name, p, developing) in all {
                if !p.valid {
                    continue;
                }
                let sig = p.rows_sig();
                let key = (tag.clone(), p.start);
                let rows = match cache.remove(&key) {
                    Some((s, rows)) if s == sig => rows,
                    _ => Arc::new(p.tpo_rows()),
                };
                keep.insert(key, (sig, rows.clone()));
                let touch = |k: usize| p.touch[k].map(|(t, _)| t);
                if !developing {
                    for (k, kind) in KINDS.iter().enumerate() {
                        if p.touch[k].is_none() {
                            naked.push(ChartNakedLevel {
                                name: format!("n{kind} {name}"),
                                kind: kind.to_string(),
                                price: p.level(k),
                                start_time: p.start,
                            });
                        }
                    }
                }
                periods.push(ChartTpoPeriod {
                    name,
                    start: p.start,
                    end: p.end,
                    tick: p.tick,
                    high: p.d_high,
                    low: p.d_low,
                    poc: p.poc,
                    vah: p.vah,
                    val: p.val,
                    developing,
                    touch_poc: touch(0),
                    touch_vah: touch(1),
                    touch_val: touch(2),
                    sig,
                    rows: Some(rows),
                });
            }

            profiles.insert(
                tag.clone(),
                ChartTpoProfile {
                    tag: tag.clone(),
                    mode: pf.cfg.mode.as_str().into(),
                    tf_min: *tf_min,
                    periods,
                },
            );
        }
        *cache = keep; // periode yang sudah keluar jendela dibuang

        ChartTpoResponse {
            symbol: self.symbol.clone(),
            point: self.point,
            profiles,
            naked,
        }
    }
}

/// Satu periode TPO pada chart dengan baris-baris histogram.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ChartTpoPeriod {
    pub name: String,
    pub start: i64,
    pub end: i64,
    pub tick: f64,
    pub high: f64,
    pub low: f64,
    pub poc: f64,
    pub vah: f64,
    pub val: f64,
    /// Periode berjalan (levelnya masih bergerak, belum bisa disebut naked).
    pub developing: bool,
    /// Waktu bar pertama yang menyentuh level (aturan touch_letters); None = masih naked.
    pub touch_poc: Option<i64>,
    pub touch_vah: Option<i64>,
    pub touch_val: Option<i64>,
    /// Sidik isi baris; klien memakai ulang baris cache selama sidiknya sama.
    pub sig: u64,
    /// None = tidak dikirim ulang (klien sudah punya, lihat `since` di /api/chart-tpo).
    pub rows: Option<Arc<Vec<crate::period::TpoRowSnap>>>,
}

/// Kumpulan periode TPO untuk satu profil (mis. Sessional atau Daily).
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ChartTpoProfile {
    pub tag: String,
    pub mode: String,
    /// Timeframe feed (menit) sumber perhitungan, termasuk waktu touch.
    pub tf_min: i64,
    pub periods: Vec<ChartTpoPeriod>,
}

/// Level Naked (belum tersentuh) untuk digambar memanjang melintasi sesi.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ChartNakedLevel {
    pub name: String,
    pub kind: String,
    pub price: f64,
    pub start_time: i64,
}

/// Response JSON lengkap untuk endpoint `/api/chart-tpo`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct ChartTpoResponse {
    pub symbol: String,
    pub point: f64,
    pub profiles: BTreeMap<String, ChartTpoProfile>,
    pub naked: Vec<ChartNakedLevel>,
}

impl ChartTpoResponse {
    /// Salinan ringan untuk satu permintaan: saring per profil, dan bila `since` diisi, baris hanya disertakan
    /// untuk periode berjalan serta periode yang mulai >= `since` (baris dibagi lewat Arc, tidak disalin).
    pub fn view(&self, tag: Option<&str>, since: Option<i64>) -> ChartTpoResponse {
        let profiles = self
            .profiles
            .iter()
            .filter(|(k, _)| tag.map_or(true, |t| t == k.as_str()))
            .map(|(k, pf)| {
                let periods = pf
                    .periods
                    .iter()
                    .map(|p| {
                        let mut q = p.clone();
                        if since.map_or(false, |s| !p.developing && p.start < s) {
                            q.rows = None;
                        }
                        q
                    })
                    .collect();
                (k.clone(), ChartTpoProfile { tag: pf.tag.clone(), mode: pf.mode.clone(), tf_min: pf.tf_min, periods })
            })
            .collect();
        ChartTpoResponse { symbol: self.symbol.clone(), point: self.point, profiles, naked: self.naked.clone() }
    }
}

// ---------------------------------------------------------------- teks (setara --text / --once)
pub fn format_text(s: &Snap) -> String {
    let pt = s.point;
    let dec = decimals_of(pt);
    let dist = |d: f64| format!("{}pt ({})", fmt_thousands0(d / pt), fmt_f(d, dec));
    let f = |x: Option<f64>| x.map_or("-".to_string(), |v| fmt_f(v, dec));
    let tags: Vec<&str> = ["W", "D", "S", "M"].into_iter().filter(|t| s.profiles.contains_key(*t)).collect();
    let mut l: Vec<String> = vec![format!(
        "=== {} | {} {} | harga {} | ATR {} | point {} ===",
        s.symbol, s.asof_ny, s.tz, fmt_f(s.price, dec), fmt_f(s.atr, dec), fmt_g(pt)
    )];
    let c = &s.context;
    l.push(format!("[Context] naked {} level", c.naked_count));
    for tag in ["D", "S", "M", "W"] {
        let Some(o) = c.open_vs_va.get(tag) else { continue };
        let mut txt = o.state.clone();
        if let Some(d) = o.dist {
            txt += &format!(" {}", dist(d));
        }
        if let Some(ps) = &o.poc_side {
            txt += &format!(" ({} POC)", ps);
        }
        l.push(format!("  Open {} vs VA : {}", tag, txt));
    }
    for (n, arrow) in [(&c.n_up, "▲"), (&c.n_down, "▼")] {
        l.push(format!(
            "  nLevel {}      : {}",
            arrow,
            n.as_ref().map_or("-".to_string(), |n| format!("{}  {}  ({})", n.name, fmt_f(n.price, dec), dist(n.dist)))
        ));
    }
    for tag in &tags {
        let lt = c.last_touch.get(*tag).and_then(|x| x.as_ref());
        l.push(format!(
            "  Last touch {}  : {}",
            tag,
            lt.map_or("-".to_string(), |lt| format!("{} | dari {} | {}", lt.name, lt.dir, lt.t_ny))
        ));
    }
    for tag in &tags {
        let name = match *tag { "W" => "Weekly", "D" => "Daily", "S" => "Sessional", _ => "Micro" };
        let pf = &s.profiles[*tag];
        let st = &pf.settings;
        let extra = if let Some(w) = &st.week_start {
            format!(", minggu mulai {}", w)
        } else if let Some(h) = st.session_hours {
            format!(", sesi {} jam", h)
        } else if let Some(m) = st.micro_min {
            format!(", micro {} menit", m)
        } else {
            String::new()
        };
        l.push(format!(
            "\n[{}] TPO {}m | feed M{} | hari mulai {}{} | VA {}% | tick {} (rows {}) | {} periode",
            name, pf.tpo_min, pf.tf_min, st.start, extra, fmt_g(st.va_pct),
            if st.ticks == 0 { "auto".to_string() } else { st.ticks.to_string() }, st.rows, st.count
        ));
        let mut rows: Vec<&PerSnap> = pf.items.iter().collect();
        if let Some(d) = &pf.developing {
            rows.push(d);
        }
        for p in rows {
            if !p.valid {
                l.push(format!("  {:<5} {} -> {}  (tidak valid)", p.name, p.start_ny, p.end_ny));
                continue;
            }
            let nk = if p.name != format!("{}-now", tag) {
                ["POC", "VAH", "VAL"].iter().map(|k| format!("{}{}", k, if p.touch.get(k).is_some() { "✔" } else { "○" })).collect::<Vec<_>>().join(" ")
            } else {
                "developing".to_string()
            };
            l.push(format!(
                "  {:<5} {} -> {} | POC {}  VAH {}  VAL {} | H {} L {} tick {} | {}",
                p.name, p.start_ny, p.end_ny, f(p.poc), f(p.vah), f(p.val), f(p.high), f(p.low), fmt_g(p.tick), nk
            ));
        }
    }
    l.join("\n")
}
