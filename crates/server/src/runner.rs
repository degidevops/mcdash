//! Runner (port runner.py): config -> engine -> sumber data -> snapshot, dengan jalur cepat untuk harga.
use crate::app::*;
use crate::feed::{binance, mt5, tradingview, FeedEvent, Tx};
use mcdash_core::bias::{full_bias, ORDER};
use mcdash_core::config::{self, Config, SourceCfg, SourceKind};
use mcdash_core::util::decimals_of;
use mcdash_core::{format_text, Bars, Snap, TpoEngine};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;

pub struct Opts {
    pub interval: f64, // jeda minimum antar perhitungan TPO (detik); harga tidak menunggu ini
    pub sym_override: Option<String>,
    pub pt_override: f64,
    pub text: bool,
    pub once: bool,
    pub dump: Option<String>, // --dump <profil>: cetak isi profil per baris lalu keluar
}

struct Mt5Ctl {
    id: u64,
    handle: JoinHandle<()>,
    desired: watch::Sender<mt5::Desired>,
    listen: String,
    server_tz: String,
}

struct Runner {
    app: Arc<App>,
    opts: Opts,
    tx: Tx,
    cfg: Option<Config>,
    mtime: Option<SystemTime>,
    config_error: Option<String>,
    engine: Option<TpoEngine>,
    symbol: String,
    auto_point: Option<f64>,
    bars: HashMap<i64, Bars>,
    hist_done: HashSet<i64>,
    next_id: u64,
    active: HashSet<u64>,
    tv: HashMap<i64, (u64, JoinHandle<()>)>,
    /// Feed sumber alternatif untuk /chart: (sumber, tf) -> (id, handle). Dinyalakan on-demand.
    chart_feeds: HashMap<(u8, i64), (u64, JoinHandle<()>)>,
    /// Cooldown feed chart setelah gagal: (sumber, tf) -> waktu boleh coba lagi.
    chart_cool: HashMap<(u8, i64), f64>,
    mt5: Option<Mt5Ctl>,
    restart: Vec<(i64, f64)>,
    dirty: bool,
    force: bool, // bar baru -> hitung ulang segera (abaikan jeda interval)
    last_build: f64,
    build_ms: f64,
    err: Option<String>,
    src_status: Option<String>,
    mt5_hello: bool,
    tick: Option<(f64, f64)>, // (harga, waktu diterima)
    tick_sent: f64,
    tick_dirty: bool,
    last_bias: String,
    last_meta: f64,
    last_status: String,
    last_cfg_check: f64,
    last_data: f64, // waktu event terakhir dari feed utama (bukan feed chart alternatif)
}

pub async fn run(app: Arc<App>, opts: Opts) -> Result<(), String> {
    let (tx, mut rx) = mpsc::unbounded_channel::<(u64, FeedEvent)>();
    let mut r = Runner::new(app, opts, tx);
    r.reload_config(true)?;
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            Some((id, ev)) = rx.recv() => r.handle_event(id, ev),
            _ = tick.tick() => {
                r.flush_tick();
                r.check_config();
                r.restart_feeds();
                r.sync_chart_feeds();
                if r.maybe_rebuild() {
                    return Ok(()); // --once
                }
                r.heartbeat();
            }
        }
    }
}

impl Runner {
    fn new(app: Arc<App>, opts: Opts, tx: Tx) -> Runner {
        Runner {
            app, opts, tx, cfg: None, mtime: None, config_error: None, engine: None, symbol: String::new(), auto_point: None,
            bars: HashMap::new(), hist_done: HashSet::new(), next_id: 1, active: HashSet::new(), tv: HashMap::new(), chart_feeds: HashMap::new(), chart_cool: HashMap::new(), mt5: None, restart: vec![],
            dirty: false, force: false, last_build: 0.0, build_ms: 0.0, err: None, src_status: None, mt5_hello: false,
            tick: None, tick_sent: 0.0, tick_dirty: false, last_bias: String::new(), last_meta: 0.0, last_status: String::new(), last_cfg_check: 0.0, last_data: 0.0,
        }
    }

    // ------------------------------------------------------------ config
    fn check_config(&mut self) {
        let now = now_f();
        if now - self.last_cfg_check < 0.5 {
            return;
        }
        self.last_cfg_check = now;
        let _ = self.reload_config(false);
    }

    fn reload_config(&mut self, force: bool) -> Result<(), String> {
        let mt = std::fs::metadata(&self.app.cfg_path).and_then(|m| m.modified()).ok();
        if !force && mt == self.mtime && self.mtime.is_some() {
            return Ok(());
        }
        match config::load(&self.app.cfg_path) {
            Ok(cfg) => {
                self.mtime = std::fs::metadata(&self.app.cfg_path).and_then(|m| m.modified()).ok();
                let desc = config::describe(&cfg);
                match self.apply(cfg) {
                    Ok(()) => {
                        self.config_error = None;
                        println!("{desc}");
                        Ok(())
                    }
                    Err(e) if self.cfg.is_none() => Err(e),
                    Err(e) => {
                        eprintln!("[config] ditolak, memakai yang lama: {e}");
                        self.config_error = Some(e);
                        Ok(())
                    }
                }
            }
            Err(e) => {
                self.mtime = mt;
                if self.cfg.is_none() {
                    return Err(e);
                }
                if self.config_error.as_deref() != Some(&e) {
                    eprintln!("[config] ditolak, memakai yang lama: {e}");
                }
                self.config_error = Some(e);
                Ok(())
            }
        }
    }

    fn point_for(&self, cfg: &Config) -> f64 {
        if self.opts.pt_override > 0.0 { self.opts.pt_override } else if cfg.point > 0.0 { cfg.point } else { self.auto_point.unwrap_or(0.01) }
    }

    fn make_engine(&self, cfg: &Config, symbol: &str) -> Result<TpoEngine, String> {
        TpoEngine::new(symbol, self.point_for(cfg), &cfg.timezone, cfg.profiles.clone(), cfg.atr_period, cfg.atr_feed_tf)
    }

    fn apply(&mut self, cfg: Config) -> Result<(), String> {
        let same = self.cfg.as_ref().map_or(false, |o| o.source == cfg.source && o.symbol == cfg.symbol && o.history_bars == cfg.history_bars);
        let symbol = if same {
            self.symbol.clone()
        } else {
            let s = self.opts.sym_override.clone().unwrap_or_else(|| cfg.symbol.clone());
            if cfg.source.kind == SourceKind::Binance { binance::normalize_symbol(&s) } else { s }
        };
        let engine = self.make_engine(&cfg, &symbol)?; // validasi dulu sebelum mengubah apa pun
        if !same {
            self.stop_all();
            self.symbol = symbol;
            self.auto_point = None;
        }
        let mut needed = engine.needed_tfs();
        if cfg.atr_feed_tf > 0 && !needed.contains(&cfg.atr_feed_tf) {
            needed.push(cfg.atr_feed_tf);
        }
        for &ctf in &[1, 5, 15, 60, 240, 1440] {
            if !needed.contains(&ctf) {
                needed.push(ctf);
            }
        }
        self.engine = Some(self.make_engine(&cfg, &self.symbol.clone())?);
        match cfg.source.kind {
            SourceKind::TradingView | SourceKind::Binance => self.sync_tv(&cfg, &needed),
            SourceKind::Mt5 => self.sync_mt5(&cfg, &needed)?,
        }
        let tv_sym = cfg.tv_symbol.clone();
        self.cfg = Some(cfg);
        if let Ok(mut sh) = self.app.shared.write() {
            sh.chart_tv_symbol = tv_sym;
        }
        self.dirty = true;
        self.force = true;
        Ok(())
    }

    fn drop_tf(&mut self, tf: i64) {
        self.bars.remove(&tf);
        self.hist_done.remove(&tf);
    }

    /// Satu feed per timeframe; berlaku untuk TradingView dan Binance (map `tv` menampung keduanya).
    fn start_tv(&mut self, tf: i64, target: i64, src: &SourceCfg) {
        let id = self.next_id;
        self.next_id += 1;
        self.active.insert(id);
        let h = match src.kind {
            SourceKind::Binance => tokio::spawn(binance::run(id, self.symbol.clone(), tf, target, binance::Market::parse(&src.binance_market), self.tx.clone())),
            _ => tokio::spawn(tradingview::run(id, self.symbol.clone(), tf, target, self.tx.clone())),
        };
        self.tv.insert(tf, (id, h));
    }

    fn sync_tv(&mut self, cfg: &Config, needed: &[i64]) {
        let gone: Vec<i64> = self.tv.keys().copied().filter(|tf| !needed.contains(tf)).collect();
        for tf in gone {
            if let Some((id, h)) = self.tv.remove(&tf) {
                h.abort();
                self.active.remove(&id);
            }
            self.drop_tf(tf);
        }
        for &tf in needed {
            if !self.tv.contains_key(&tf) {
                self.start_tv(tf, cfg.history_bars, &cfg.source);
            }
        }
    }

    fn sync_mt5(&mut self, cfg: &Config, needed: &[i64]) -> Result<(), String> {
        let addr: SocketAddr = cfg.source.mt5_listen.parse().map_err(|_| format!("source.mt5_listen tidak valid: {}", cfg.source.mt5_listen))?;
        let mut tfs = needed.to_vec();
        tfs.sort_unstable();
        let want = mt5::Desired { tfs: tfs.clone(), count: cfg.history_bars, symbol_filter: cfg.source.mt5_symbol.clone(), server_tz: cfg.source.mt5_server_tz.clone() };
        let stale: Vec<i64> = self.bars.keys().copied().filter(|tf| !tfs.contains(tf)).collect();
        for tf in stale {
            self.drop_tf(tf);
        }
        match &self.mt5 {
            Some(c) if c.listen == cfg.source.mt5_listen && c.server_tz == cfg.source.mt5_server_tz => {
                c.desired.send_if_modified(|d| if *d != want { *d = want.clone(); true } else { false });
            }
            _ => {
                if let Some(c) = self.mt5.take() {
                    c.handle.abort();
                    self.active.remove(&c.id);
                    if c.server_tz != cfg.source.mt5_server_tz {
                        // aturan waktu berubah: riwayat lama (dikonversi dengan aturan lama) dibuang, EA mengirim ulang
                        self.bars.clear();
                        self.hist_done.clear();
                        self.mt5_hello = false;
                    }
                }
                let id = self.next_id;
                self.next_id += 1;
                self.active.insert(id);
                let (dtx, drx) = watch::channel(want);
                let handle = tokio::spawn(mt5::run(id, addr, drx, self.tx.clone()));
                self.mt5 = Some(Mt5Ctl { id, handle, desired: dtx, listen: cfg.source.mt5_listen.clone(), server_tz: cfg.source.mt5_server_tz.clone() });
            }
        }
        Ok(())
    }

    /// Sinkronkan feed sumber alternatif untuk /chart: nyalakan bila /api/chart-bars memintanya
    /// (chart_want), matikan bila tidak ada permintaan baru 15 menit. chart_want HANYA diperbarui
    /// oleh permintaan API (bukan oleh event feed sendiri) — kalau tidak, feed yang hidup terus
    /// memperbarui want-nya sendiri dan GC 15 menit tidak pernah jalan. Halaman /chart memanggil
    /// ulang API tiap 4 menit agar feed tetap hidup selama halamannya terbuka.
    /// Sumber = sumber utama tidak perlu feed terpisah (sudah disediakan feed utama).
    /// Bar-nya sendiri (chart_bars_ext) tidak ikut dibuang saat feed mati: bar dipertahankan
    /// 24 jam sejak terakhir dipakai (chart_keep), jadi membuka ulang sumber yang sama langsung
    /// menampilkan history lama sambil feed baru menyegarkan datanya — penting untuk history
    /// panjang (20.000+ bar) yang butuh waktu lama untuk diambil ulang dari nol.
    fn sync_chart_feeds(&mut self) {
        let now = now_f();
        let Some(cfg) = self.cfg.clone() else { return };
        let primary = match cfg.source.kind {
            SourceKind::Binance => CHART_SRC_BINANCE,
            SourceKind::TradingView => CHART_SRC_TV,
            SourceKind::Mt5 => CHART_SRC_MAIN,
        };
        {
            let mut sh = self.app.shared.write().unwrap();
            sh.chart_want.retain(|_, t| now - *t < 900.0);
            // Bar sumber alternatif dipertahankan 24 jam sejak terakhir dipakai, walau feed-nya
            // sudah dimatikan setelah 15 menit tanpa permintaan (hemat koneksi, data tetap ada).
            sh.chart_keep.retain(|_, t| now - *t < 86_400.0);
            let expired: Vec<(u8, i64)> = sh
                .chart_bars_ext
                .keys()
                .copied()
                .filter(|k| !sh.chart_keep.contains_key(k))
                .collect();
            for k in expired {
                sh.chart_bars_ext.remove(&k);
            }
        }
        let wants: HashSet<(u8, i64)> = self
            .app
            .shared
            .read()
            .unwrap()
            .chart_want
            .keys()
            .copied()
            .filter(|(k, _)| *k != primary)
            .collect();
        // Matikan feed yang sudah tidak diminta (bar-nya DIPERTAHANKAN di chart_bars_ext)
        let gone: Vec<(u8, i64)> = self.chart_feeds.keys().copied().filter(|k| !wants.contains(k)).collect();
        for k in gone {
            if let Some((fid, h)) = self.chart_feeds.remove(&k) {
                h.abort();
                self.active.remove(&fid);
            }
        }
        self.chart_cool.retain(|_, at| now < *at);
        // Nyalakan feed yang diminta
        for key in wants {
            if self.chart_feeds.contains_key(&key) || self.chart_cool.contains_key(&key) {
                continue;
            }
            let (kind, tf) = key;
            let id = self.next_id;
            self.next_id += 1;
            self.active.insert(id);
            let h = match kind {
                CHART_SRC_BINANCE => tokio::spawn(binance::run(
                    id,
                    crate::app::chart_binance_symbol(&self.symbol),
                    tf,
                    cfg.history_bars,
                    binance::Market::parse(&cfg.source.binance_market),
                    self.tx.clone(),
                )),
                _ => {
                    let sym = self.app.shared.read().map(|sh| sh.chart_tv_symbol.clone()).unwrap_or_default();
                    let sym = if sym.is_empty() { self.symbol.clone() } else { sym };
                    tokio::spawn(tradingview::run(id, sym, tf, cfg.history_bars, self.tx.clone()))
                }
            };
            self.chart_feeds.insert(key, (id, h));
        }
    }

    /// Event dari feed sumber alternatif: simpan bar terpisah + siarkan frame khusus chart.
    /// Tidak menyentuh tick harga utama — sumber alternatif hanya untuk tampilan chart.
    fn handle_chart_event(&mut self, key: (u8, i64), ev: FeedEvent) {
        let (kind, tf) = key;
        let src = chart_src_name(kind);
        match ev {
            FeedEvent::History { bars, .. } => {
                let tail: Vec<[f64; 6]> = bars.iter().rev().take(150).rev().map(|(ts, b)| [*ts as f64, b.o, b.h, b.l, b.c, b.v]).collect();
                if let Ok(mut sh) = self.app.shared.write() {
                    sh.chart_bars_ext.insert(key, bars);
                    sh.chart_keep.insert(key, now_f()); // data baru tiba: umur keep-nya diperpanjang
                }
                let frame = format!(
                    "{{\"k\":\"chart\",\"src\":\"{src}\",\"tf\":{tf},\"full\":true,\"bars\":{}}}",
                    serde_json::to_string(&tail).unwrap_or_default()
                );
                let _ = self.app.tx.send(frame);
            }
            FeedEvent::Live { bars, .. } => {
                let tail: Vec<[f64; 6]> = bars.iter().map(|(ts, b)| [*ts as f64, b.o, b.h, b.l, b.c, b.v]).collect();
                {
                    let mut sh = self.app.shared.write().unwrap();
                    let m = sh.chart_bars_ext.entry(key).or_default();
                    for (ts, b) in &bars {
                        m.insert(*ts, *b);
                    }
                    sh.chart_keep.insert(key, now_f());
                }
                let frame = format!(
                    "{{\"k\":\"chart\",\"src\":\"{src}\",\"tf\":{tf},\"full\":false,\"bars\":{}}}",
                    serde_json::to_string(&tail).unwrap_or_default()
                );
                let _ = self.app.tx.send(frame);
            }
            FeedEvent::Died { error, .. } => {
                if let Some((fid, h)) = self.chart_feeds.remove(&key) {
                    self.active.remove(&fid);
                    h.abort();
                }
                self.chart_cool.insert(key, now_f() + 10.0);
                if let Ok(mut sh) = self.app.shared.write() {
                    sh.chart_bars_ext.remove(&key);
                }
                eprintln!("[chart] feed {src} M{tf} gagal: {error}");
            }
            _ => {}
        }
    }

    fn stop_all(&mut self) {
        for (_, (_, h)) in self.tv.drain() {
            h.abort();
        }
        for (_, (fid, h)) in self.chart_feeds.drain() {
            h.abort();
            self.active.remove(&fid);
        }
        self.chart_cool.clear();
        if let Some(c) = self.mt5.take() {
            c.handle.abort();
        }
        self.active.clear();
        self.restart.clear();
        self.bars.clear();
        self.hist_done.clear();
        self.engine = None;
        self.mt5_hello = false;
        self.src_status = None;
        self.tick = None;
        self.tick_dirty = false;
        self.last_bias.clear();
        let meta = self.meta();
        let frame = snapshot_frame(&meta, None, None);
        {
            let mut sh = self.app.shared.write().unwrap();
            sh.snap = None;
            sh.snap_frame = None;
            sh.tick = None;
            sh.meta = meta;
            sh.chart_bars_ext.clear();
            sh.chart_want.clear();
            sh.chart_keep.clear();
        }
        let _ = self.app.tx.send(frame);
    }

    fn restart_feeds(&mut self) {
        let now = now_f();
        let due: Vec<i64> = self.restart.iter().filter(|(_, at)| now >= *at).map(|(tf, _)| *tf).collect();
        if due.is_empty() {
            return;
        }
        self.restart.retain(|(_, at)| now < *at);
        let Some(cfg) = self.cfg.clone() else { return };
        if cfg.source.kind == SourceKind::Mt5 {
            return;
        }
        for tf in due {
            if !self.tv.contains_key(&tf) && (self.engine.as_ref().map_or(false, |e| e.needed_tfs().contains(&tf) || cfg.atr_feed_tf == tf) || [1, 5, 15, 60, 240, 1440].contains(&tf)) {
                self.start_tv(tf, cfg.history_bars, &cfg.source);
            }
        }
    }

    // ------------------------------------------------------------ event dari sumber data
    fn set_point(&mut self, p: Option<f64>) {
        if let Some(p) = p.filter(|p| *p > 0.0) {
            self.auto_point = Some(p);
            let fixed = self.opts.pt_override > 0.0 || self.cfg.as_ref().map_or(false, |c| c.point > 0.0);
            if !fixed {
                if let Some(e) = self.engine.as_mut() {
                    e.point = p;
                }
            }
        }
    }

    fn on_price(&mut self, price: f64) {
        self.tick = Some((price, now_f()));
        self.tick_dirty = true;
        self.flush_tick();
    }

    fn handle_event(&mut self, id: u64, ev: FeedEvent) {
        if !self.active.contains(&id) {
            return; // dari feed yang sudah dihentikan
        }
        // Event dari feed sumber alternatif (chart) -> jalur terpisah, tidak menyentuh engine utama
        if let Some(&key) = self.chart_feeds.iter().find(|(_, (fid, _))| *fid == id).map(|(k, _)| k) {
            self.handle_chart_event(key, ev);
            return;
        }
        match ev {
            FeedEvent::History { tf, bars, point } => {
                self.last_data = now_f();
                self.bars.insert(tf, bars.clone());
                self.hist_done.insert(tf);
                self.set_point(point);
                self.dirty = true;
                self.force = true;
                if let Ok(mut sh) = self.app.shared.write() {
                    sh.chart_bars.insert(tf, bars);
                }
            }
            FeedEvent::Live { tf, bars } => {
                self.last_data = now_f();
                if !self.hist_done.contains(&tf) {
                    return;
                }
                let m = self.bars.entry(tf).or_default();
                let mut new_bar = false;
                for (ts, b) in &bars {
                    new_bar |= !m.contains_key(ts);
                    m.insert(*ts, *b);
                }
                self.dirty = true;
                self.force |= new_bar;
                if let Ok(mut sh) = self.app.shared.write() {
                    if let Some(cur) = self.bars.get(&tf) {
                        sh.chart_bars.insert(tf, cur.clone());
                    }
                }
                // harga = close bar terakhir dari feed timeframe terkecil (TradingView & Binance; MT5 mengirim bid langsung)
                if self.tv.keys().min() == Some(&tf) {
                    if let Some((_, b)) = bars.iter().max_by_key(|(t, _)| *t) {
                        self.on_price(b.c);
                    }
                }
            }
            FeedEvent::Price { price } => {
                self.last_data = now_f();
                self.on_price(price);
            }
            FeedEvent::Hello { symbol, point } => {
                self.last_data = now_f();
                self.mt5_hello = true;
                self.src_status = None;
                if symbol != self.symbol {
                    self.bars.clear();
                    self.hist_done.clear();
                    self.symbol = symbol;
                    self.auto_point = None;
                    self.last_bias.clear();
                    if let Some(cfg) = self.cfg.clone() {
                        if let Ok(e) = self.make_engine(&cfg, &self.symbol) {
                            self.engine = Some(e);
                        }
                    }
                }
                self.set_point(point);
                self.dirty = true;
                self.force = true;
            }
            FeedEvent::Status { text } => {
                if text.is_none() {
                    self.err = None;
                }
                self.src_status = text;
            }
            FeedEvent::Died { tf, error } => {
                self.err = Some(if tf > 0 { format!("feed M{tf} gagal: {error}") } else { error });
                self.active.remove(&id);
                if tf > 0 {
                    self.tv.remove(&tf);
                    self.restart.push((tf, now_f() + 10.0));
                } else if let Some(c) = self.mt5.take() {
                    c.handle.abort();
                }
            }
        }
    }

    // ------------------------------------------------------------ keluaran
    fn status(&self) -> String {
        if let Some(e) = &self.err {
            return e.clone();
        }
        if self.cfg.as_ref().map_or(false, |c| c.source.kind == SourceKind::Mt5) {
            if let Some(s) = &self.src_status {
                return s.clone();
            }
            if !self.mt5_hello {
                return format!("menunggu EA MetaTrader 5 di {} …", self.mt5.as_ref().map_or("?".to_string(), |c| c.listen.clone()));
            }
        }
        match &self.engine {
            Some(e) if e.ready(&self.bars) => {
                // "live" hanya bila feed utama masih mengirim data. Pasar tutup / feed terputus
                // (reconnect transient tidak mengirim Died) tidak boleh tampil sebagai "live".
                if self.last_data > 0.0 {
                    let gap = now_f() - self.last_data;
                    if gap > 45.0 {
                        return format!("menunggu data feed ({gap:.0} dtk)");
                    }
                }
                "live".into()
            }
            Some(e) => format!(
                "memuat riwayat: {}",
                e.needed_tfs().iter().map(|tf| format!("M{tf} {}", if self.hist_done.contains(tf) { "✔" } else { "…" })).collect::<Vec<_>>().join(", ")
            ),
            None => "memulai…".into(),
        }
    }

    fn meta(&self) -> Meta {
        let kind = self.cfg.as_ref().map(|c| c.source.kind);
        Meta {
            ts: now_f(),
            status: self.status(),
            config_error: self.config_error.clone(),
            build_ms: (self.build_ms * 10.0).round() / 10.0,
            feeds: self.bars.iter().map(|(tf, b)| (tf.to_string(), b.len())).collect::<BTreeMap<_, _>>(),
            source: match kind {
                Some(SourceKind::Mt5) => format!("mt5 · {}", self.symbol),
                Some(SourceKind::Binance) => {
                    let m = self.cfg.as_ref().map_or("futures", |c| c.source.binance_market.as_str());
                    format!("binance {} · {}", m, self.symbol)
                }
                _ => "tradingview".into(),
            },
        }
    }

    fn heartbeat(&mut self) {
        let now = now_f();
        let status = self.status();
        if now - self.last_meta < 5.0 && status == self.last_status {
            return;
        }
        self.last_meta = now;
        self.last_status = status;
        let meta = self.meta();
        let frame = meta_frame(&meta);
        self.app.shared.write().unwrap().meta = meta;
        let _ = self.app.tx.send(frame);
    }

    fn flush_tick(&mut self) {
        if !self.tick_dirty {
            return;
        }
        let now = now_f();
        if now - self.tick_sent < 0.05 {
            return;
        }
        let Some((p, wall)) = self.tick else { return };
        self.tick_dirty = false;
        self.tick_sent = now;
        let mut changed: Option<String> = None;
        {
            let mut sh = self.app.shared.write().unwrap();
            if let Some(s) = sh.snap.as_mut() {
                s.price = p;
                let j = serde_json::to_string(&full_bias(s, decimals_of(s.point), &ORDER)).unwrap_or_default();
                if j != self.last_bias {
                    self.last_bias = j.clone();
                    changed = Some(j);
                }
            }
            sh.tick = Some(TickState { p, wall, bias_json: if self.last_bias.is_empty() { None } else { Some(self.last_bias.clone()) } });
        }
        let _ = self.app.tx.send(tick_frame(&TickState { p, wall, bias_json: changed }));
    }

    /// Hitung ulang TPO bila perlu. Mengembalikan true bila mode --once selesai.
    fn maybe_rebuild(&mut self) -> bool {
        let now = now_f();
        let eff = self.opts.interval.max(self.build_ms / 1000.0 * 4.0); // perangkat lambat tidak dibebani terus-menerus
        let Some(engine) = self.engine.as_mut() else { return false };
        if !(self.dirty && engine.ready(&self.bars) && (self.force || now - self.last_build >= eff)) {
            return false;
        }
        self.dirty = false;
        self.force = false;
        self.last_build = now;
        let t0 = Instant::now();
        if let Err(e) = engine.rebuild(&self.bars) {
            self.err = Some(format!("engine error: {e}"));
            return false;
        }
        if let Some(name) = &self.opts.dump {
            match engine.dump(name) {
                Ok(t) => println!("{t}"),
                Err(e) => eprintln!("{e}"),
            }
        }
        let mut snap = engine.snapshot();
        self.build_ms = t0.elapsed().as_secs_f64() * 1000.0;
        self.err = None;
        if let Some((p, wall)) = self.tick {
            if now - wall < 5.0 {
                snap.price = p; // tick lebih baru daripada close bar
            }
        }
        self.publish(snap);
        self.opts.once
    }

    fn publish(&mut self, snap: Snap) {
        let full = full_bias(&snap, decimals_of(snap.point), &ORDER);
        self.last_bias = serde_json::to_string(&full).unwrap_or_default();
        let meta = self.meta();
        let frame = snapshot_frame(&meta, Some(&snap), Some(&full));
        if self.opts.text {
            println!("{}", format_text(&snap));
        }
        let chart_tpo = self.engine.as_ref().map(|e| e.chart_tpo());
        {
            let mut sh = self.app.shared.write().unwrap();
            sh.tick = self.tick.map(|(p, wall)| TickState { p, wall, bias_json: Some(self.last_bias.clone()) });
            sh.meta = meta;
            sh.snap = Some(snap);
            sh.snap_frame = Some(frame.clone());
            sh.chart_bars = self.bars.clone();
            sh.chart_tpo = chart_tpo;
        }
        self.last_meta = now_f();
        let _ = self.app.tx.send(frame);
    }
}
