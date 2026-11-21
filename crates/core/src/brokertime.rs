//! Zona waktu SERVER broker MT5 -> UTC, per bar (bukan satu offset untuk seluruh riwayat).
//!
//! Waktu bar MT5 adalah "jam dinding server broker". Offset server terhadap UTC berubah saat DST,
//! jadi riwayat yang melewati pergantian DST tidak boleh dikonversi dengan offset saat ini saja.
//! Aturan yang didukung (`source.mt5_server_tz`):
//!   - `auto`     : (bawaan) offset server per pekan DIDETEKSI dari data: pembukaan mingguan pasar selalu jatuh pada jam New
//!                  York yang sama (IANA), jadi selisihnya terhadap waktu server = offset pekan itu. Tanpa perlu tahu aturan DST broker.
//!                  Bila tidak ada jeda akhir pekan (kripto 24/7) dipakai offset terukur saat ini untuk semua bar.
//!   - `ny_close` : server = New York + 7 jam (GMT+2 musim dingin / GMT+3 musim panas, DST ikut AS).
//!                  Konvensi sebagian besar broker FX/CFD (hari baru = 17:00 NY).
//!   - nama IANA  : mis. `Europe/Athens` / `Europe/Helsinki` (broker yang mengikuti DST Eropa), `Etc/GMT-2` (tetap).
use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, Offset, TimeZone};
use chrono_tz::Tz;

#[derive(Clone, Debug, PartialEq)]
pub enum ServerTz {
    Auto,
    NyClose,
    Iana(Tz),
}

const NY_TO_SERVER: i64 = 7 * 3600;

impl ServerTz {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim() {
            "" | "auto" => Ok(ServerTz::Auto),
            "ny_close" => Ok(ServerTz::NyClose),
            other => other
                .parse::<Tz>()
                .map(ServerTz::Iana)
                .map_err(|_| format!("source.mt5_server_tz '{other}' tidak dikenal: pakai 'auto', 'ny_close', atau nama IANA (mis. Europe/Athens)")),
        }
    }

    pub fn is_auto(&self) -> bool {
        matches!(self, ServerTz::Auto)
    }

    fn wall_to_utc(tz: Tz, wall: NaiveDateTime) -> i64 {
        match tz.from_local_datetime(&wall) {
            LocalResult::Single(d) => d.timestamp(),
            LocalResult::Ambiguous(a, _) => a.timestamp(), // lipat jatuh: kemunculan pertama (pasar tutup saat transisi)
            LocalResult::None => {
                // celah musim semi: pakai offset sebelum transisi
                let off = match tz.from_local_datetime(&(wall - Duration::hours(3))) {
                    LocalResult::Single(d) | LocalResult::Ambiguous(d, _) => d.offset().fix().local_minus_utc() as i64,
                    LocalResult::None => 0,
                };
                wall.and_utc().timestamp() - off
            }
        }
    }

    /// `raw` = waktu bar MT5 apa adanya (detik, jam dinding server dibaca seolah-olah UTC). Mengembalikan epoch UTC sebenarnya.
    /// Untuk `Auto` tidak ada aturan, jadi `None` (pemanggil memakai nilai yang sudah dikonversi EA).
    pub fn to_utc(&self, raw: i64) -> Option<i64> {
        let wall = DateTime::from_timestamp(raw, 0)?.naive_utc();
        match self {
            ServerTz::Auto => None,
            ServerTz::NyClose => Some(Self::wall_to_utc(chrono_tz::America::New_York, wall - Duration::seconds(NY_TO_SERVER))),
            ServerTz::Iana(tz) => Some(Self::wall_to_utc(*tz, wall)),
        }
    }

    /// Offset server terhadap UTC (detik) pada instan UTC `utc` menurut aturan ini. Dipakai untuk memeriksa terhadap offset yang diukur EA.
    pub fn offset_at(&self, utc: i64) -> Option<i64> {
        match self {
            ServerTz::Auto => None,
            ServerTz::NyClose => Some(chrono_tz::America::New_York.timestamp_opt(utc, 0).single()?.offset().fix().local_minus_utc() as i64 + NY_TO_SERVER),
            ServerTz::Iana(tz) => Some(tz.timestamp_opt(utc, 0).single()?.offset().fix().local_minus_utc() as i64),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> i64 {
        chrono::NaiveDate::from_ymd_opt(y, mo, d).unwrap().and_hms_opt(h, mi, 0).unwrap().and_utc().timestamp()
    }

    #[test]
    fn ny_close_winter_is_gmt2_summer_is_gmt3() {
        let r = ServerTz::NyClose;
        // 15 Jan 2026 10:00 waktu server = 08:00 UTC
        assert_eq!(r.to_utc(ts(2026, 1, 15, 10, 0)), Some(ts(2026, 1, 15, 8, 0)));
        // 15 Jul 2026 10:00 waktu server = 07:00 UTC
        assert_eq!(r.to_utc(ts(2026, 7, 15, 10, 0)), Some(ts(2026, 7, 15, 7, 0)));
        assert_eq!(r.offset_at(ts(2026, 1, 15, 8, 0)), Some(2 * 3600));
        assert_eq!(r.offset_at(ts(2026, 7, 15, 7, 0)), Some(3 * 3600));
    }

    #[test]
    fn ny_close_dst_follows_us_dates_not_eu() {
        let r = ServerTz::NyClose;
        // AS mulai DST 8 Mar 2026, Eropa baru 29 Mar. Pada 16 Mar server sudah GMT+3 (NY_close), Athens masih GMT+2.
        let utc = ts(2026, 3, 16, 12, 0);
        assert_eq!(r.offset_at(utc), Some(3 * 3600));
        assert_eq!(ServerTz::parse("Europe/Athens").unwrap().offset_at(utc), Some(2 * 3600));
    }

    #[test]
    fn history_across_dst_uses_per_bar_offset() {
        let r = ServerTz::NyClose;
        // bar 2 Mar (GMT+2) dan 16 Mar (GMT+3), keduanya 10:00 server
        assert_eq!(r.to_utc(ts(2026, 3, 2, 10, 0)), Some(ts(2026, 3, 2, 8, 0)));
        assert_eq!(r.to_utc(ts(2026, 3, 16, 10, 0)), Some(ts(2026, 3, 16, 7, 0)));
    }

    #[test]
    fn parse_rules() {
        assert!(ServerTz::parse("auto").unwrap().is_auto());
        assert_eq!(ServerTz::parse("ny_close").unwrap(), ServerTz::NyClose);
        assert!(ServerTz::parse("Europe/Athens").is_ok());
        assert!(ServerTz::parse("Nowhere/Land").is_err());
    }
}

/// Peta offset server -> UTC per pekan, hasil deteksi dari data.
#[derive(Clone, Debug, PartialEq)]
pub struct OffsetMap {
    opens: Vec<(i64, i64)>, // (waktu mentah pembukaan mingguan, offset detik) terurut
    first: i64,
}

impl OffsetMap {
    pub fn offset_for(&self, raw: i64) -> i64 {
        match self.opens.partition_point(|(t, _)| *t <= raw) {
            0 => self.first,
            i => self.opens[i - 1].1,
        }
    }
    /// Waktu server mentah -> epoch UTC sebenarnya.
    pub fn to_utc(&self, raw: i64) -> i64 {
        raw - self.offset_for(raw)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AutoReport {
    pub anchor: String,                  // jam buka mingguan (waktu New York) yang dipakai, mis. "Sun 17:00"
    pub weeks: usize,                    // pembukaan mingguan yang dipakai
    pub discarded: usize,                // jeda yang bukan pembukaan mingguan standar (libur/lubang data)
    pub segments: Vec<(i64, i64, usize)>, // (epoch UTC awal segmen, offset detik, jumlah pekan)
    pub anomalies: usize,                // pekan dengan pembukaan tertunda yang disaring (bukan pergantian DST)
}

const MIN_SOLID_WEEKS: usize = 3;

/// Hasil evaluasi satu kandidat jam buka standar.
struct Eval {
    pts: Vec<(i64, i64)>, // (waktu mentah pembukaan, offset terhitung)
    vals: Vec<i64>,       // offset setelah gangguan (libur/jam buka tertunda) disaring
    discarded: usize,
    anomalies: usize,
    changes: usize,
}

fn evaluate(cand: &[i64], wd: u32, am: i64, measured_off: i64) -> Option<Eval> {
    use chrono::Datelike;
    let ny = chrono_tz::America::New_York;
    let mut pts: Vec<(i64, i64)> = vec![];
    for &o in cand {
        let guess = o - measured_off;
        let Some(l) = ny.timestamp_opt(guess, 0).single() else { continue };
        let mut best: Option<i64> = None;
        for dd in -1..=1 {
            let date = l.date_naive() + Duration::days(dd);
            if date.weekday().num_days_from_monday() != wd {
                continue;
            }
            let u = ServerTz::wall_to_utc(ny, date.and_hms_opt(0, 0, 0)? + Duration::minutes(am));
            if best.map_or(true, |b| (u - guess).abs() < (b - guess).abs()) {
                best = Some(u);
            }
        }
        let Some(u) = best else { continue };
        if (u - guess).abs() > 6 * 3600 {
            continue; // bukan pembukaan standar
        }
        pts.push((o, (((o - u) as f64 / 900.0).round() as i64) * 900));
    }
    let discarded = cand.len() - pts.len();
    if pts.len() < MIN_SOLID_WEEKS {
        return None;
    }
    // run berurutan dengan offset sama; run < 3 pekan = gangguan, kecuali run terakhir yang sama dengan offset terukur
    // dan run awal riwayat sepanjang >= 2 pekan (riwayat pendek yang dimulai sebelum pergantian DST)
    let mut runs: Vec<(usize, usize, i64)> = vec![]; // (awal, panjang, offset)
    for (i, &(_, off)) in pts.iter().enumerate() {
        match runs.last_mut() {
            Some(r) if r.2 == off => r.1 += 1,
            _ => runs.push((i, 1, off)),
        }
    }
    let last = runs.len() - 1;
    let solid: Vec<bool> = runs.iter().enumerate().map(|(i, r)| r.1 >= MIN_SOLID_WEEKS || (i == 0 && r.1 >= 2) || (i == last && r.2 == measured_off)).collect();
    let first_solid = runs.iter().zip(&solid).find(|(_, s)| **s).map(|(r, _)| r.2)?;
    let mut vals: Vec<i64> = pts.iter().map(|p| p.1).collect();
    let mut prev: Option<i64> = None;
    let mut anomalies = 0;
    for (i, r) in runs.iter().enumerate() {
        if solid[i] {
            prev = Some(r.2);
        } else {
            let fill = prev.unwrap_or(first_solid);
            vals[r.0..r.0 + r.1].iter_mut().for_each(|v| *v = fill);
            anomalies += r.1;
        }
    }
    if *vals.last().unwrap() != measured_off {
        return None; // pekan terakhir harus cocok dengan offset yang diukur EA sekarang
    }
    let changes = vals.windows(2).filter(|w| w[0] != w[1]).count();
    Some(Eval { pts, vals, discarded, anomalies, changes })
}

/// Deteksi offset server per pekan dari pembukaan mingguan. `raw` = waktu bar server mentah (detik), `measured_off` = offset
/// terukur EA SAAT INI. Jam buka standar instrumen (mis. Minggu 17:00 New York) tidak diketahui sebelumnya; tiap kandidat dari
/// 12 pembukaan terakhir dicoba, dan dipilih yang membuat pekan terakhir == offset terukur dengan gangguan+perubahan paling sedikit.
/// `None` bila tidak ada cukup pembukaan mingguan (kripto 24/7) atau tidak ada kandidat yang konsisten dengan offset terukur
/// (mis. jam/zona waktu PC salah).
///
/// Keterbatasan: bila EA tersambung dalam seminggu setelah pergantian DST broker, data tidak bisa membedakannya dari satu
/// pembukaan yang tertunda 1 jam. Imbang semacam itu dimenangkan jam buka standar FX (Minggu 17:00 NY); sembuh sendiri
/// setelah >= 2 pekan, dan jam buka yang dipakai selalu tercetak di laporan.
pub fn detect_offsets(raw: &[i64], measured_off: i64) -> Option<(OffsetMap, AutoReport)> {
    use chrono::{Datelike, Timelike};
    let ny = chrono_tz::America::New_York;
    let mut r: Vec<i64> = raw.to_vec();
    r.sort_unstable();
    r.dedup();
    let cand: Vec<i64> = r.windows(2).filter(|w| w[1] - w[0] >= 40 * 3600).map(|w| w[1]).collect();
    if cand.len() < 3 {
        return None;
    }
    let mut keys: std::collections::BTreeSet<(u32, i64)> = Default::default();
    let mut latest: std::collections::BTreeMap<(u32, i64), i64> = Default::default();
    for &o in cand.iter().rev().take(12) {
        let l = ny.timestamp_opt(o - measured_off, 0).single()?;
        let mins = (l.hour() * 60 + l.minute()) as i64;
        let k = (l.weekday().num_days_from_monday(), ((mins + 7) / 15) * 15);
        keys.insert(k);
        let e = latest.entry(k).or_insert(0);
        *e = (*e).max(o);
    }
    let mut best: Option<((u32, i64), Eval)> = None;
    for &k in &keys {
        let Some(ev) = evaluate(&cand, k.0, k.1, measured_off) else { continue };
        let score = |k: (u32, i64), e: &Eval| (e.anomalies + e.changes, if k == (6, 17 * 60) { 0 } else { 1 }, -latest[&k]);
        if best.as_ref().map_or(true, |(bk, be)| score(k, &ev) < score(*bk, be)) {
            best = Some((k, ev));
        }
    }
    let ((wd, am), ev) = best?;
    let mut segments: Vec<(i64, i64, usize)> = vec![];
    for (i, &v) in ev.vals.iter().enumerate() {
        match segments.last_mut() {
            Some(sg) if sg.1 == v => sg.2 += 1,
            _ => segments.push((ev.pts[i].0 - v, v, 1)),
        }
    }
    let map = OffsetMap { opens: ev.pts.iter().zip(&ev.vals).map(|(p, v)| (p.0, *v)).collect(), first: ev.vals[0] };
    let anchor = format!("{} {:02}:{:02}", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][wd as usize], am / 60, am % 60);
    Some((map, AutoReport { anchor, weeks: ev.pts.len(), discarded: ev.discarded, anomalies: ev.anomalies, segments }))
}

pub fn auto_report_lines(rep: &AutoReport) -> Vec<String> {
    let g = |off: i64| format!("GMT{:+}", off as f64 / 3600.0);
    let mut lines = vec![format!(
        "[mt5] zona waktu server: TERDETEKSI OTOMATIS dari {} pembukaan mingguan (jam buka {} New York; {} jeda non-standar diabaikan)",
        rep.weeks, rep.anchor, rep.discarded
    )];
    for (i, (start, off, n)) in rep.segments.iter().enumerate() {
        let d = DateTime::from_timestamp(*start, 0).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default();
        lines.push(format!("[mt5]   {} mulai {}  {} pekan{}", g(*off), d, n, if i == 0 { " (awal riwayat)" } else { "" }));
    }
    if rep.anomalies > 0 {
        lines.push(format!("[mt5]   {} pekan dengan jam buka tertunda/tidak biasa (libur?) disaring dan memakai offset pekan tetangga", rep.anomalies));
    }
    lines
}

/// Hasil uji satu aturan terhadap riwayat bar.
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub name: String,        // nilai yang dipakai di source.mt5_server_tz
    pub weeks: usize,        // jumlah pembukaan mingguan yang ditemukan
    pub consistent: usize,   // yang jatuh pada jam buka New York paling umum
    pub ny_open: String,     // jam buka mingguan (waktu New York) paling umum, mis. "Sun 17:00"
    pub odd: Vec<String>,    // contoh minggu yang menyimpang (tanggal UTC hasil konversi)
}

impl Candidate {
    pub fn ratio(&self) -> f64 {
        if self.weeks == 0 { 0.0 } else { self.consistent as f64 / self.weeks as f64 }
    }
}

/// Diagnostik aturan zona server dari data bar sendiri. Pasar FX/emas selalu buka kembali pada jam New York yang sama
/// (Minggu 17:00/18:00 NY), jadi aturan yang BENAR membuat jam buka mingguan, bila dikonversi ke waktu New York, konstan
/// sepanjang riwayat (termasuk melewati pergantian DST). `raw` = waktu bar server mentah (detik), `measured_off` = offset terukur EA.
pub fn diagnose(raw: &[i64], measured_off: i64) -> Vec<Candidate> {
    use chrono::{Datelike, Timelike};
    let mut r: Vec<i64> = raw.to_vec();
    r.sort_unstable();
    r.dedup();
    let opens: Vec<i64> = r.windows(2).filter(|w| w[1] - w[0] >= 40 * 3600).map(|w| w[1]).collect();
    let ny = chrono_tz::America::New_York;
    let rules: Vec<(String, Box<dyn Fn(i64) -> Option<i64>>)> = vec![
        ("ny_close".into(), Box::new(|t| ServerTz::NyClose.to_utc(t))),
        ("Europe/Athens".into(), Box::new(|t| ServerTz::Iana("Europe/Athens".parse().unwrap()).to_utc(t))),
        (format!("auto (zona tetap GMT{:+})", measured_off as f64 / 3600.0), Box::new(move |t| Some(t - measured_off))),
    ];
    let mut out = vec![];
    for (name, f) in rules {
        let mut keys: Vec<(String, i64)> = vec![];
        for &o in &opens {
            if let Some(utc) = f(o) {
                let l = ny.timestamp_opt(utc, 0).single();
                if let Some(l) = l {
                    keys.push((format!("{} {:02}:{:02}", l.weekday(), l.hour(), l.minute()), utc));
                }
            }
        }
        let mut counts: std::collections::BTreeMap<&str, usize> = Default::default();
        for (k, _) in &keys {
            *counts.entry(k.as_str()).or_default() += 1;
        }
        let (mode, cnt) = counts.iter().max_by_key(|(_, c)| **c).map(|(k, c)| (k.to_string(), *c)).unwrap_or_default();
        let odd = keys
            .iter()
            .filter(|(k, _)| *k != mode)
            .take(3)
            .map(|(k, u)| format!("{} ({})", DateTime::from_timestamp(*u, 0).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default(), k))
            .collect();
        out.push(Candidate { name, weeks: keys.len(), consistent: cnt, ny_open: mode, odd });
    }
    out
}

/// Ringkasan dalam teks (baris-baris log) + saran.
pub fn diagnose_report(c: &[Candidate], configured: &str) -> Vec<String> {
    let weeks = c.iter().map(|x| x.weeks).max().unwrap_or(0);
    let mut lines = vec![format!("[mt5] diagnostik zona server: {weeks} pembukaan mingguan ditemukan di riwayat (setting sekarang: {configured})")];
    if weeks < 4 {
        lines.push("[mt5]   riwayat terlalu pendek / tanpa jeda akhir pekan (mis. kripto 24/7) — aturan tidak bisa disimpulkan dari data".into());
        return lines;
    }
    for x in c {
        lines.push(format!(
            "[mt5]   {:<28} {}/{} minggu buka di {}{}",
            x.name,
            x.consistent,
            x.weeks,
            x.ny_open,
            if x.odd.is_empty() { String::new() } else { format!("  | menyimpang: {}", x.odd.join(", ")) }
        ));
    }
    // Libur panjang menggeser jam buka untuk SEMUA aturan sama rata; yang membedakan aturan hanyalah minggu-minggu
    // di sekitar pergantian DST. Jadi bandingkan secara relatif: pemenang harus unggul >= 2 minggu dari aturan berikutnya.
    let best = c.iter().map(|x| x.consistent).max().unwrap_or(0);
    let leaders: Vec<&Candidate> = c.iter().filter(|x| x.consistent == best).collect();
    let second = c.iter().filter(|x| x.consistent < best).map(|x| x.consistent).max().unwrap_or(0);
    let best_ratio = best as f64 / weeks as f64;
    if best_ratio < 0.75 {
        lines.push("[mt5]   KESIMPULAN: tidak ada aturan yang konsisten — mungkin zona lain (fixed GMT+x berbeda, atau jam buka instrumen tidak standar). Kirim log ini.".into());
    } else if leaders.len() == 1 && best >= second + 2 {
        let g = leaders[0];
        let key = if g.name.starts_with("auto") { "auto" } else { g.name.as_str() };
        if key == configured.trim() || (configured.trim().is_empty() && key == "auto") {
            lines.push(format!("[mt5]   KESIMPULAN: setting '{configured}' sudah sesuai dengan data."));
        } else {
            lines.push(format!("[mt5]   KESIMPULAN: aturan yang cocok dengan data adalah '{key}' — set source.mt5_server_tz = \"{key}\" (sekarang: \"{configured}\")."));
        }
    } else if leaders.len() == 1 && best == second + 1 {
        let g = leaders[0];
        let key = if g.name.starts_with("auto") { "auto" } else { g.name.as_str() };
        lines.push(format!(
            "[mt5]   INDIKASI LEMAH: '{key}' paling cocok, tetapi riwayat hanya memuat 1 minggu yang membedakan aturan (pergantian DST). Untuk memastikan, perpanjang riwayat sampai melewati Maret (aturan AS vs Eropa berbeda 3 minggu di sana). Setting sekarang: \"{configured}\"."
        ));
    } else {
        lines.push(format!(
            "[mt5]   KESIMPULAN: tidak konklusif — {} hampir/sama-sama cocok; riwayat belum melewati cukup minggu di sekitar pergantian DST yang membedakan aturan. Perpanjang riwayat (naikkan general.bars / count) lalu sambungkan ulang EA.",
            leaders.iter().map(|x| x.name.as_str()).collect::<Vec<_>>().join(" & ")
        ));
    }
    lines
}

#[cfg(test)]
mod diag_tests {
    use super::*;
    use chrono::NaiveDate;

    // Bangun waktu-waktu bar mentah untuk broker dengan aturan `truth`: tiap minggu: Minggu 17:00 NY buka sampai Jumat tutup
    fn raw_weeks(truth: &ServerTz, start: (i32, u32, u32), weeks: i64) -> Vec<i64> {
        let ny = chrono_tz::America::New_York;
        let mut out = vec![];
        let first_sun = NaiveDate::from_ymd_opt(start.0, start.1, start.2).unwrap();
        for w in 0..weeks {
            let sun = first_sun + Duration::days(7 * w);
            let open_utc = ny.from_local_datetime(&sun.and_hms_opt(17, 0, 0).unwrap()).single().unwrap().timestamp();
            // Minggu buka, bar harian Sen-Kam (jeda < 40 jam), lalu Jumat tutup 16:45 NY
            let mut day_bars: Vec<i64> = (0..5).map(|k| open_utc + k * 86400).collect();
            day_bars.push(open_utc + 5 * 86400 - 15 * 60);
            for u in day_bars {
                let off = truth.offset_at(u).unwrap();
                out.push(u + off);
            }
        }
        out
    }

    #[test]
    fn ny_close_broker_is_identified() {
        let raw = raw_weeks(&ServerTz::NyClose, (2026, 1, 4), 46); // Jan-Nov 2026, melewati Mar & Okt/Nov
        let c = diagnose(&raw, 2 * 3600);
        let by = |n: &str| c.iter().find(|x| x.name.starts_with(n)).unwrap().clone();
        assert_eq!(by("ny_close").consistent, by("ny_close").weeks);
        assert!(by("Europe/Athens").consistent + 2 <= by("ny_close").consistent);
        assert!(by("auto").consistent + 2 <= by("ny_close").consistent);
        assert!(diagnose_report(&c, "auto").iter().any(|l| l.contains("set source.mt5_server_tz = \"ny_close\"")));
    }

    #[test]
    fn eu_dst_broker_is_identified_and_ny_close_flagged() {
        let athens = ServerTz::parse("Europe/Athens").unwrap();
        let raw = raw_weeks(&athens, (2026, 1, 4), 46);
        let c = diagnose(&raw, 2 * 3600);
        let by = |n: &str| c.iter().find(|x| x.name.starts_with(n)).unwrap().clone();
        assert_eq!(by("Europe/Athens").consistent, by("Europe/Athens").weeks);
        assert!(by("ny_close").consistent + 2 <= by("Europe/Athens").consistent); // minggu-minggu beda jadwal DST menyimpang
        assert!(!by("ny_close").odd.is_empty());
        let rep = diagnose_report(&c, "ny_close");
        assert!(rep.iter().any(|l| l.contains("set source.mt5_server_tz = \"Europe/Athens\"")), "{rep:?}");
    }

    #[test]
    fn fixed_offset_broker_points_to_auto() {
        let fixed = ServerTz::parse("Etc/GMT-3").unwrap();
        let raw = raw_weeks(&fixed, (2026, 1, 4), 46);
        let c = diagnose(&raw, 3 * 3600);
        let a = c.iter().find(|x| x.name.starts_with("auto")).unwrap();
        assert_eq!(a.consistent, a.weeks);
        assert!(c.iter().find(|x| x.name == "ny_close").unwrap().consistent + 2 <= a.consistent);
        assert!(diagnose_report(&c, "ny_close").iter().any(|l| l.contains("set source.mt5_server_tz = \"auto\"")));
    }

    #[test]
    fn one_distinguishing_week_is_weak_indication() {
        // Okt-Des: hanya minggu 25 Okt yang membedakan ny_close dari Eropa
        let raw = raw_weeks(&ServerTz::NyClose, (2026, 10, 4), 12);
        let rep = diagnose_report(&diagnose(&raw, 2 * 3600), "auto");
        assert!(rep.iter().any(|l| l.contains("INDIKASI LEMAH") && l.contains("'ny_close'")), "{rep:?}");
    }

    #[test]
    fn short_history_is_inconclusive() {
        let raw = raw_weeks(&ServerTz::NyClose, (2026, 10, 4), 3);
        let rep = diagnose_report(&diagnose(&raw, 3 * 3600), "ny_close");
        assert!(rep.iter().any(|l| l.contains("terlalu pendek")));
    }

    #[test]
    fn short_winter_history_does_not_discriminate() {
        // hanya Nov-Des: ny_close dan Athens sama-sama konsisten -> tidak konklusif
        let raw = raw_weeks(&ServerTz::NyClose, (2026, 11, 8), 6);
        let rep = diagnose_report(&diagnose(&raw, 2 * 3600), "ny_close");
        assert!(rep.iter().any(|l| l.contains("tidak konklusif")), "{rep:?}");
    }
}

#[cfg(test)]
mod auto_tests {
    use super::*;
    use chrono::NaiveDate;

    /// (utc sebenarnya, waktu server mentah) untuk broker dengan aturan `truth`; `delay_week` menunda pembukaan pekan itu 1 jam (libur).
    fn gen(truth: &ServerTz, start: (i32, u32, u32), weeks: i64, delay_week: Option<i64>) -> Vec<(i64, i64)> {
        let ny = chrono_tz::America::New_York;
        let first_sun = NaiveDate::from_ymd_opt(start.0, start.1, start.2).unwrap();
        let mut out = vec![];
        for w in 0..weeks {
            let sun = first_sun + Duration::days(7 * w);
            let open_utc = ny.from_local_datetime(&sun.and_hms_opt(17, 0, 0).unwrap()).single().unwrap().timestamp();
            let delay = if Some(w) == delay_week { 3600 } else { 0 };
            let mut bars: Vec<i64> = (0..5).map(|k| open_utc + k * 86400 + delay).collect();
            bars.push(open_utc + 5 * 86400 - 15 * 60);
            for u in bars {
                out.push((u, u + truth.offset_at(u).unwrap()));
            }
        }
        out
    }

    fn check(truth: ServerTz, start: (i32, u32, u32), weeks: i64, delay: Option<i64>) -> AutoReport {
        let data = gen(&truth, start, weeks, delay);
        let raws: Vec<i64> = data.iter().map(|d| d.1).collect();
        let measured = truth.offset_at(data.last().unwrap().0).unwrap();
        let (map, rep) = detect_offsets(&raws, measured).expect("terdeteksi");
        for (utc, raw) in &data {
            assert_eq!(map.to_utc(*raw), *utc, "raw {raw} salah: {rep:?}");
        }
        rep
    }

    #[test]
    fn ny_close_broker_full_year_exact() {
        let rep = check(ServerTz::NyClose, (2026, 1, 4), 46, None);
        assert_eq!(rep.segments.iter().map(|s| s.1 / 3600).collect::<Vec<_>>(), vec![2, 3, 2]);
        assert_eq!(rep.anchor, "Sun 17:00");
    }

    #[test]
    fn eu_dst_broker_full_year_exact() {
        check(ServerTz::parse("Europe/Athens").unwrap(), (2026, 1, 4), 46, None);
    }

    #[test]
    fn fixed_offset_broker_exact() {
        let rep = check(ServerTz::parse("Etc/GMT-3").unwrap(), (2026, 1, 4), 46, None);
        assert_eq!(rep.segments.len(), 1);
    }

    #[test]
    fn delayed_holiday_open_does_not_shift_neighbours() {
        // pekan ke-20 buka telat 1 jam: tidak boleh dianggap pergantian DST
        let data = gen(&ServerTz::NyClose, (2026, 1, 4), 46, Some(20));
        let raws: Vec<i64> = data.iter().map(|d| d.1).collect();
        let (map, rep) = detect_offsets(&raws, 2 * 3600).unwrap();
        assert_eq!(rep.segments.iter().map(|s| s.1 / 3600).collect::<Vec<_>>(), vec![2, 3, 2]);
        // bar di luar pekan telat benar persis; pekan telat itu sendiri memakai offset tetangga (benar)
        for (i, (utc, raw)) in data.iter().enumerate() {
            let week = i / 6;
            if week as i64 != 20 {
                assert_eq!(map.to_utc(*raw), *utc);
            } else {
                // bar pekan telat memakai offset tetangga -> utc = benar (offset sebenarnya yg dipakai server tidak berubah)
                assert_eq!(map.to_utc(*raw), *utc);
            }
        }
    }

    #[test]
    fn recent_dst_change_with_short_tail_is_kept() {
        // riwayat Okt-Nov: perubahan 1 Nov baru 2 pekan; offset terukur +2 menjaga run terakhir
        let rep = check(ServerTz::NyClose, (2026, 10, 11), 5, None);
        assert_eq!(rep.segments.iter().map(|s| s.1 / 3600).collect::<Vec<_>>(), vec![3, 2]);
    }

    #[test]
    fn no_weekend_gap_returns_none() {
        let raws: Vec<i64> = (0..2000).map(|i| 1_700_000_000 + i * 900).collect();
        assert!(detect_offsets(&raws, 0).is_none());
    }
}
