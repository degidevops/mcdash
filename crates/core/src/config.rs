//! Pengaturan lewat config.json (port mcconfig.py). Kunci salah ketik ditolak dengan pesan jelas.
use crate::calendar::Mode;
use crate::engine::DAYS_ID;
use crate::profile::ProfileCfg;
use serde_json::{json, Map, Value};
use std::str::FromStr;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceKind {
    TradingView,
    Mt5,
    Binance,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SourceCfg {
    pub kind: SourceKind,
    pub mt5_listen: String,
    pub mt5_symbol: String,
    pub mt5_server_tz: String, // 'auto' | 'ny_close' | nama IANA (lihat brokertime.rs)
    pub binance_market: String, // 'futures' (USDⓈ-M perpetual, tempat XAUUSDT) | 'spot'
}

#[derive(Clone, Debug)]
pub struct Config {
    pub symbol: String,
    pub timezone: String,
    pub point: f64,
    pub history_bars: i64,
    pub tv_symbol: String,
    pub atr_period: usize,
    pub atr_feed_tf: i64,
    pub profiles: Vec<ProfileCfg>,
    pub source: SourceCfg,
}

pub fn defaults() -> Value {
    json!({
        "general": { "symbol": "OANDA:XAUUSD", "timezone": "America/New_York", "point": 0, "history_bars": 20000, "tv_symbol": "", "atr_period": 14, "atr_feed_tf": 0 },
        "daily": { "enable": true, "touch_letters": 2, "tpo_min": 15, "count": 5, "start_hour": 18, "start_minute": 0, "va_pct": 70, "va_method": "two_rows", "va_bound": "edge", "poc_rule": "mid", "va_tie_break": "up", "va_stop": "ceil", "ticks": 0, "rows": 80, "feed_tf": 0 },
        "sessional": { "enable": true, "touch_letters": 2, "tpo_min": 10, "count": 8, "session_hours": 6, "start_hour": 18, "start_minute": 0, "va_pct": 70, "va_method": "two_rows", "va_bound": "edge", "poc_rule": "mid", "va_tie_break": "up", "va_stop": "ceil", "ticks": 0, "rows": 80, "feed_tf": 0 },
        "micro": { "enable": true, "touch_letters": 2, "tpo_min": 10, "count": 8, "parts": 4, "va_pct": 70, "va_method": "two_rows", "va_bound": "edge", "poc_rule": "mid", "va_tie_break": "up", "va_stop": "ceil", "ticks": 0, "rows": 80, "feed_tf": 0 },
        "weekly": { "enable": true, "touch_letters": 2, "tpo_min": 15, "count": 4, "week_start_day": "sunday", "start_hour": 18, "start_minute": 0, "va_pct": 70, "va_method": "two_rows", "va_bound": "edge", "poc_rule": "mid", "va_tie_break": "up", "va_stop": "ceil", "ticks": 0, "rows": 80, "feed_tf": 0 },
        "source": { "type": "tradingview", "mt5_listen": "127.0.0.1:9899", "mt5_symbol": "", "mt5_server_tz": "auto", "binance_market": "futures" }
    })
}

fn help() -> Value {
    json!({
        "timezone": "Zona waktu IANA untuk semua batas hari/minggu/sesi, mis. America/New_York, Europe/London, Asia/Jakarta.",
        "point": "Ukuran 1 point. 0 = otomatis mengikuti info simbol dari sumber data (TradingView OANDA XAUUSD memberi 0.001; MT5 memberi point broker). Isi manual bila ingin menyamakan.",
        "history_bars": "Target jumlah bar riwayat per timeframe, boleh sampai 2.000.000. Catatan: akun anonim TradingView dibatasi (biasanya puluhan ribu bar); Binance diambil per halaman 1000 bar — riwayat sangat panjang butuh beberapa menit dan bisa kena 429 (otomatis menunggu sesuai Retry-After lalu melanjutkan, tidak mengulang dari nol); MT5 dibatasi 'Max bars in chart' terminal dan kedalaman data broker.",
        "tv_symbol": "Opsional: simbol TradingView untuk pilihan sumber data di halaman /chart (dropdown 'Sumber'), mis. OANDA:XAUUSD. Kosong = pakai general.symbol. Berguna bila general.symbol bukan format TradingView (mis. XAUUSDT) tapi Anda tetap ingin membandingkan dengan chart TradingView.",
        "atr_feed_tf": "Timeframe untuk ATR (menit). 0 = otomatis (M15 bila ada).",
        "enable": "true/false: aktifkan profil ini.",
        "touch_letters": "First touch POC/VAH/VAL: level baru dianggap tersentuh bila harga memuat level selama N huruf TPO berurutan (default 2). Sumbu 1 huruf tidak menghapus status naked. 1 = cukup satu bar menyentuh (perilaku lama).",
        "tpo_min": "Periode satu huruf TPO, menit (mis. 10, 15, 30, 60).",
        "count": "Jumlah periode (hari/sesi/minggu) selesai yang ditampilkan.",
        "start_hour/start_minute": "Jam mulai hari di zona 'timezone'. Dipakai juga sebagai awal minggu dan awal sesi.",
        "session_hours": "Panjang satu sesi dalam jam (blok dihitung dari jam mulai hari).",
        "week_start_day": "Hari mulai minggu: sunday, monday, ... (atau minggu, senin, ...).",
        "parts": "Khusus micro: satu sesi dibagi berapa bagian (6 jam / 4 = 90 menit). Jam mulai dan panjang sesi mengikuti bagian sessional.",
        "va_pct": "Persentase Value Area (mis. 70).",
        "va_method": "Cara memperluas Value Area dari POC. 'two_rows' (bawaan, gaya CME): tiap langkah bandingkan 2 baris atas vs 2 baris bawah. 'one_row': 1 baris per langkah. Ganti bila VA tidak cocok dengan platform lain; gunakan 'mcdash --dump S-1' untuk membandingkan isi profil per baris.",
        "va_bound": "Posisi level harga VAH/VAL: 'center' (harga pusat baris, gaya Sierra Chart / ATAS) atau 'edge' (bawaan lama, tepi luar baris: pusat ± ½ tick).",
        "poc_rule": "Cara memilih POC bila terjadi seri (bimodal/multiple peaks): 'mid' (bawaan: dekat tengah range High-Low), 'close' (dekat harga penutupan periode), 'atas' (gaya ATAS: distribusi aktif terakhir di sesi lalu ambil level terawal terbentuk), 'high' (harga tertinggi seri), 'low' (harga terendah seri).",
        "va_tie_break": "Aturan seri saat ekspansi Value Area 2 baris (TwoRows): 'up' (bawaan lama: selalu ambil atas bila seri), 'cbot' (gaya CBOT/ATAS: bandingkan baris tunggal terdekat).",
        "va_stop": "Kondisi penghentian ekspansi Value Area terhadap va_pct: 'ceil' (bawaan CME: minimal mencapai atau melampaui va_pct), 'floor' (gaya ATAS: berhenti sebelum va_pct terlampaui), 'closest' (persentase terdekat).",
        "ticks": "Harga per baris dalam point. 0 = otomatis dari range periode sebelumnya.",
        "rows": "Target jumlah baris untuk tick otomatis (10-300).",
        "feed_tf": "Timeframe feed (menit). 0 = otomatis (terbesar yang habis membagi tpo_min, riwayat terjauh). Boleh dipaksa lebih kecil (mis. 5) selama habis membagi tpo_min; hasilnya sama, riwayat lebih pendek.",
        "source.type": "Sumber data: 'tradingview' (feed WebSocket anonim), 'mt5' (Expert Advisor MCDashBridge di terminal MetaTrader 5 yang terhubung ke server ini), atau 'binance' (data publik Binance, tanpa API key; simbol diambil dari general.symbol, mis. XAUUSDT, BTCUSDT).",
        "source.binance_market": "Hanya untuk type = binance. 'futures' (bawaan) = USDⓈ-M perpetual; XAUUSDT/XAGUSDT hanya ada di sini. 'spot' = pasar spot (mis. BTCUSDT).",
        "source.mt5_listen": "Alamat TCP tempat server menunggu EA MT5 (hanya dipakai bila type = mt5). Gunakan 0.0.0.0:9899 bila MT5 ada di komputer lain.",
        "source.mt5_server_tz": "Zona waktu SERVER broker MT5 (waktu bar di MT5 = jam dinding server). 'auto' (bawaan) = offset server per pekan dideteksi dari data (pembukaan mingguan pasar jatuh pada jam New York yang sama), jadi riwayat melewati pergantian DST tetap akurat tanpa perlu tahu aturan broker; bila tidak terdeteksi (kripto 24/7) dipakai offset terukur saat ini. Override manual: 'ny_close' (New York+7 jam) atau nama IANA (mis. Europe/Athens, Etc/GMT-2).",
        "source.mt5_symbol": "Opsional: bila diisi, hanya EA dengan simbol ini yang diterima (mis. XAUUSD). Kosong = terima simbol apa pun."
    })
}

pub fn default_dict() -> Value {
    let mut d = defaults();
    d.as_object_mut().unwrap().insert("_help".into(), help());
    d
}

pub fn write_default(path: &str) -> std::io::Result<()> {
    std::fs::write(path, serde_json::to_string_pretty(&default_dict()).unwrap())
}

fn day_names() -> Vec<(String, i64)> {
    let mut v: Vec<(String, i64)> = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        .iter()
        .enumerate()
        .map(|(i, n)| (n.to_string(), i as i64))
        .collect();
    for (i, n) in DAYS_ID.iter().enumerate() {
        v.push((n.to_lowercase(), i as i64));
    }
    v
}

fn repr(v: &Value) -> String {
    match v {
        Value::String(s) => format!("'{}'", s),
        Value::Bool(b) => (if *b { "True" } else { "False" }).into(),
        Value::Null => "None".into(),
        other => other.to_string(),
    }
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Null => false,
        Value::Number(n) => n.as_f64().map_or(true, |x| x != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// merge dengan nilai default; kunci/bagian tak dikenal ditolak (kunci berawalan "_" diabaikan).
fn merge(user: &Value) -> Result<Map<String, Value>, String> {
    let user = user.as_object().ok_or("config: isi file harus berupa objek {...}")?;
    let dflt = defaults();
    let dflt = dflt.as_object().unwrap();
    let mut out = Map::new();
    for (sec, d) in dflt {
        let d = d.as_object().unwrap();
        let empty = Value::Object(Map::new());
        let u = user.get(sec).unwrap_or(&empty);
        let u = u.as_object().ok_or(format!("config: bagian '{sec}' harus berupa objek {{...}}"))?;
        let bad: Vec<&String> = u.keys().filter(|k| !d.contains_key(*k) && !k.starts_with('_')).collect();
        if !bad.is_empty() {
            let valid: Vec<&String> = d.keys().collect();
            return Err(format!("config: kunci tidak dikenal di '{sec}': {bad:?}. Kunci yang valid: {valid:?}"));
        }
        let mut m = d.clone();
        for (k, v) in u {
            if !k.starts_with('_') {
                m.insert(k.clone(), v.clone());
            }
        }
        out.insert(sec.clone(), Value::Object(m));
    }
    let bad: Vec<&String> = user.keys().filter(|k| !dflt.contains_key(*k) && !k.starts_with('_')).collect();
    if !bad.is_empty() {
        let valid: Vec<&String> = dflt.keys().collect();
        return Err(format!("config: bagian tidak dikenal: {bad:?}. Yang valid: {valid:?}"));
    }
    Ok(out)
}

fn to_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn to_i64(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|x| x.is_finite()).map(|x| x.trunc() as i64)),
        Value::String(s) => s.trim().parse::<i64>().ok(),
        Value::Bool(b) => Some(*b as i64),
        _ => None,
    }
}

fn num_i(sec: &str, key: &str, v: &Value, lo: i64, hi: i64) -> Result<i64, String> {
    let x = to_i64(v).ok_or(format!("config: '{sec}.{key}' harus berupa angka (nilai: {})", repr(v)))?;
    if x < lo || x > hi {
        return Err(format!("config: '{sec}.{key}' harus {lo}-{hi} (nilai: {x})"));
    }
    Ok(x)
}

fn num_f(sec: &str, key: &str, v: &Value, lo: f64, hi: f64) -> Result<f64, String> {
    let x = to_f64(v).ok_or(format!("config: '{sec}.{key}' harus berupa angka (nilai: {})", repr(v)))?;
    if x < lo || x > hi {
        return Err(format!("config: '{sec}.{key}' harus {lo}-{hi} (nilai: {x})"));
    }
    Ok(x)
}

fn pystr(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => (if *b { "True" } else { "False" }).into(),
        Value::Null => "None".into(),
        other => other.to_string(),
    }
}

pub fn parse(user: &Value) -> Result<Config, String> {
    let m = merge(user)?;
    let g = m["general"].as_object().unwrap();
    let tz = pystr(&g["timezone"]);
    if chrono_tz::Tz::from_str(&tz).is_err() {
        return Err(format!("config: timezone '{tz}' bukan zona IANA yang dikenal (contoh: America/New_York)"));
    }
    let tags = [("daily", "D", Mode::Daily), ("sessional", "S", Mode::Session), ("micro", "M", Mode::Micro), ("weekly", "W", Mode::Weekly)];
    let mut profiles = vec![];
    for (sec, tag, mode) in tags {
        let c = m[sec].as_object().unwrap();
        if !truthy(&c["enable"]) {
            continue;
        }
        let wd: i64 = if mode == Mode::Weekly {
            let name = pystr(&c["week_start_day"]);
            day_names().iter().find(|(n, _)| *n == name.to_lowercase()).map(|(_, i)| *i)
                .ok_or(format!("config: '{sec}.week_start_day' tidak dikenal: {} (contoh: sunday, monday)", repr(&c["week_start_day"])))?
        } else {
            6
        };
        let (src, ssec) = if mode == Mode::Micro { (m["sessional"].as_object().unwrap(), "sessional") } else { (c, sec) };
        let six = Value::from(6);
        let four = Value::from(4);
        let mut cfg = ProfileCfg::new(mode, tag, 0, 0);
        cfg.tpo_min = num_i(sec, "tpo_min", &c["tpo_min"], 1, 1440)?;
        cfg.count = num_i(sec, "count", &c["count"], 1, 200)? as usize;
        cfg.feed_tf = num_i(sec, "feed_tf", &c["feed_tf"], 0, 1440)?;
        cfg.touch_letters = num_i(sec, "touch_letters", &c["touch_letters"], 1, 20)? as usize;
        cfg.start_h = num_i(ssec, "start_hour", &src["start_hour"], 0, 23)? as u32;
        cfg.start_m = num_i(ssec, "start_minute", &src["start_minute"], 0, 59)? as u32;
        cfg.week_start = wd;
        cfg.sess_hours = num_i(ssec, "session_hours", src.get("session_hours").unwrap_or(&six), 1, 24)?;
        cfg.parts = num_i(sec, "parts", c.get("parts").unwrap_or(&four), 2, 24)?;
        cfg.va_pct = num_f(sec, "va_pct", &c["va_pct"], 1.0, 100.0)?;
        cfg.va_method = crate::period::VaMethod::parse(&pystr(&c["va_method"]))
            .ok_or(format!("config: '{sec}.va_method' harus 'two_rows' atau 'one_row' (nilai: {})", repr(&c["va_method"])))?;
        cfg.va_bound = crate::period::VaBound::parse(&pystr(&c["va_bound"]))
            .ok_or(format!("config: '{sec}.va_bound' harus 'center' atau 'edge' (nilai: {})", repr(&c["va_bound"])))?;
        cfg.poc_rule = crate::period::PocRule::parse(&pystr(&c["poc_rule"]))
            .ok_or(format!("config: '{sec}.poc_rule' harus 'mid', 'close', 'atas', 'high', atau 'low' (nilai: {})", repr(&c["poc_rule"])))?;
        cfg.va_tie_break = crate::period::VaTieBreak::parse(&pystr(&c["va_tie_break"]))
            .ok_or(format!("config: '{sec}.va_tie_break' harus 'up' atau 'cbot' (nilai: {})", repr(&c["va_tie_break"])))?;
        cfg.va_stop = crate::period::VaStop::parse(&pystr(&c["va_stop"]))
            .ok_or(format!("config: '{sec}.va_stop' harus 'ceil', 'floor', atau 'closest' (nilai: {})", repr(&c["va_stop"])))?;
        cfg.ticks = num_i(sec, "ticks", &c["ticks"], 0, 100000)?;
        cfg.rows = num_i(sec, "rows", &c["rows"], 10, 300)?;
        cfg.resolve_feed_tf()?; // validasi feed_tf vs tpo_min
        if mode == Mode::Micro {
            if (cfg.sess_hours * 3600) % cfg.parts != 0 {
                return Err(format!("config: sessional.session_hours={} tidak habis dibagi micro.parts={}", cfg.sess_hours, cfg.parts));
            }
            if cfg.sess_hours * 60 / cfg.parts < cfg.tpo_min {
                return Err(format!("config: micro.tpo_min={} lebih besar dari panjang micro ({} menit)", cfg.tpo_min, cfg.sess_hours * 60 / cfg.parts));
            }
        }
        profiles.push(cfg);
    }
    if profiles.is_empty() {
        return Err("config: minimal satu profil (daily/sessional/weekly) harus enable=true".into());
    }
    let s = m["source"].as_object().unwrap();
    let kind = match pystr(&s["type"]).to_lowercase().as_str() {
        "tradingview" => SourceKind::TradingView,
        "mt5" => SourceKind::Mt5,
        "binance" => SourceKind::Binance,
        _ => return Err(format!("config: 'source.type' harus 'tradingview', 'mt5', atau 'binance' (nilai: {})", repr(&s["type"]))),
    };
    let binance_market = pystr(&s["binance_market"]).trim().to_lowercase();
    if binance_market != "futures" && binance_market != "spot" {
        return Err(format!("config: 'source.binance_market' harus 'futures' atau 'spot' (nilai: {})", repr(&s["binance_market"])));
    }
    let listen = pystr(&s["mt5_listen"]);
    if listen.parse::<std::net::SocketAddr>().is_err() {
        return Err(format!("config: 'source.mt5_listen' harus berupa alamat:port, mis. 127.0.0.1:9899 (nilai: '{listen}')"));
    }
    let server_tz = pystr(&s["mt5_server_tz"]);
    crate::brokertime::ServerTz::parse(&server_tz)?;
    Ok(Config {
        symbol: pystr(&g["symbol"]),
        timezone: tz,
        point: num_f("general", "point", &g["point"], 0.0, 1000.0)?,
        history_bars: num_i("general", "history_bars", &g["history_bars"], 100, 2_000_000)?,
        tv_symbol: pystr(&g["tv_symbol"]).trim().to_string(),
        atr_period: num_i("general", "atr_period", &g["atr_period"], 1, 500)? as usize,
        atr_feed_tf: num_i("general", "atr_feed_tf", &g["atr_feed_tf"], 0, 1440)?,
        profiles,
        source: SourceCfg { kind, mt5_listen: listen, mt5_symbol: pystr(&s["mt5_symbol"]), mt5_server_tz: server_tz, binance_market },
    })
}

/// Baca config.json; bila belum ada, dibuat dari nilai default.
pub fn load(path: &str) -> Result<Config, String> {
    if !std::path::Path::new(path).exists() {
        write_default(path).map_err(|e| format!("config: tidak bisa menulis {path}: {e}"))?;
        println!("[config] {path} belum ada -> dibuat dengan nilai default. Edit file ini untuk mengubah parameter.");
    }
    let raw = std::fs::read_to_string(path).map_err(|e| format!("config: tidak bisa membaca {path}: {e}"))?;
    let user: Value = serde_json::from_str(&raw).map_err(|e| format!("config: {path} bukan JSON yang valid: {e}"))?;
    parse(&user)
}

pub fn describe(cfg: &Config) -> String {
    let names = |t: &str| match t { "D" => "Daily", "S" => "Sessional", "M" => "Micro", _ => "Weekly" };
    let pt = if cfg.point == 0.0 { "auto".to_string() } else { crate::util::fmt_g(cfg.point) };
    let src = match cfg.source.kind {
        SourceKind::TradingView => "TradingView".to_string(),
        SourceKind::Mt5 => format!("MetaTrader 5 (EA -> {})", cfg.source.mt5_listen),
        SourceKind::Binance => format!("Binance {}", cfg.source.binance_market),
    };
    let mut l = vec![format!("[config] {} | sumber {} | zona {} | point {}", cfg.symbol, src, cfg.timezone, pt)];
    for c in &cfg.profiles {
        let extra = match c.mode {
            Mode::Session => format!(" | sesi {}j", c.sess_hours),
            Mode::Micro => format!(" | micro {}m (sesi/{})", c.sess_hours * 60 / c.parts, c.parts),
            Mode::Weekly => format!(" | minggu mulai {}", DAYS_ID[c.week_start as usize]),
            Mode::Daily => String::new(),
        };
        l.push(format!(
            "  {:<9} TPO {}m | feed M{} | mulai {:02}:{:02}{} | {} periode | VA {}% | tick {} | rows {}",
            names(&c.tag), c.tpo_min, c.resolve_feed_tf().unwrap_or(0), c.start_h, c.start_m, extra, c.count,
            crate::util::fmt_g(c.va_pct), if c.ticks == 0 { "auto".to_string() } else { c.ticks.to_string() }, c.rows
        ));
    }
    l.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_cfg(history_bars: Value) -> Value {
        json!({
            "general": { "symbol": "OANDA:XAUUSD", "timezone": "America/New_York", "history_bars": history_bars },
            "daily": { "enable": true }
        })
    }

    /// history_bars besar (kebutuhan analisis history sangat panjang) harus diterima, bukan ditolak.
    #[test]
    fn history_bars_sampai_2_juta_diterima() {
        let cfg = parse(&base_cfg(json!(2_000_000))).expect("2.000.000 harus valid");
        assert_eq!(cfg.history_bars, 2_000_000);
        let cfg = parse(&base_cfg(json!(200_000))).expect("200.000 tetap valid");
        assert_eq!(cfg.history_bars, 200_000);
    }

    #[test]
    fn history_bars_di_luar_batas_ditolak() {
        assert!(parse(&base_cfg(json!(99))).is_err()); // di bawah minimum 100
        assert!(parse(&base_cfg(json!(2_000_001))).is_err()); // di atas maksimum
    }
}
