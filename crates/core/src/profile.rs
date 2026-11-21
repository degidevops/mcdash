//! Profil (Daily/Sessional/Micro/Weekly): membangun deret periode dari bar.
use crate::calendar::{Calendar, Mode};
use crate::period::{Period, PocRule, VaBound, VaMethod, VaStop, VaTieBreak, KINDS};
use crate::series::Series;
use crate::util::{mql_round, py_round};

/// Timeframe feed (menit) yang dipertimbangkan, dari terbesar.
pub const FEED_TFS: [i64; 6] = [60, 30, 15, 5, 3, 1];

/// Timeframe feed terbesar yang habis membagi periode TPO (riwayat lebih jauh, hasil tetap persis).
pub fn auto_feed_tf(tpo_min: i64) -> i64 {
    for tf in FEED_TFS {
        if tpo_min % tf == 0 {
            return tf;
        }
    }
    1
}

#[derive(Clone, Debug)]
pub struct ProfileCfg {
    pub mode: Mode,
    pub tag: String,
    pub tpo_min: i64,
    pub count: usize,
    pub feed_tf: i64, // 0 = otomatis
    pub start_h: u32,
    pub start_m: u32,
    pub week_start: i64, // Senin=0 ... Minggu=6
    pub sess_hours: i64,
    pub va_pct: f64,
    pub va_method: VaMethod,
    pub va_bound: VaBound,
    pub poc_rule: PocRule,
    pub va_tie_break: VaTieBreak,
    pub va_stop: VaStop,
    pub ticks: i64, // 0 = otomatis
    pub rows: i64,
    pub parts: i64,
    pub touch_letters: usize, // first touch sah bila harga memuat level selama N huruf TPO berurutan (1 = cukup satu bar menyentuh)
}

impl ProfileCfg {
    pub fn new(mode: Mode, tag: &str, tpo_min: i64, count: usize) -> ProfileCfg {
        ProfileCfg {
            mode,
            tag: tag.to_string(),
            tpo_min,
            count,
            feed_tf: 0,
            start_h: 18,
            start_m: 0,
            week_start: 6,
            sess_hours: 6,
            va_pct: 70.0,
            va_method: VaMethod::TwoRows,
            va_bound: VaBound::Edge,
            poc_rule: PocRule::Mid,
            va_tie_break: VaTieBreak::Up,
            va_stop: VaStop::Ceil,
            ticks: 0,
            rows: 80,
            parts: 4,
            touch_letters: 1,
        }
    }

    pub fn resolve_feed_tf(&self) -> Result<i64, String> {
        if self.feed_tf == 0 {
            return Ok(auto_feed_tf(self.tpo_min));
        }
        if self.tpo_min % self.feed_tf != 0 {
            return Err(format!("profil {}: feed_tf={} harus habis membagi tpo_min={}", self.tag, self.feed_tf, self.tpo_min));
        }
        Ok(self.feed_tf)
    }
}

pub fn default_profiles() -> Vec<ProfileCfg> {
    vec![
        ProfileCfg::new(Mode::Daily, "D", 15, 5),
        ProfileCfg::new(Mode::Session, "S", 10, 8),
        ProfileCfg::new(Mode::Micro, "M", 10, 8),
        ProfileCfg::new(Mode::Weekly, "W", 15, 4),
    ]
}

pub struct Profile {
    pub cfg: ProfileCfg,
    pub tf_min: i64,
    point: f64,
    cal: Calendar,
    pub items: Vec<Period>,
    pub cur: Option<Period>,
}

impl Profile {
    pub fn new(cfg: ProfileCfg, tz: &str, tf_min: i64, point: f64) -> Result<Profile, String> {
        let cal = Calendar::new(tz, cfg.start_h, cfg.start_m, cfg.week_start, cfg.sess_hours, cfg.parts)?;
        Ok(Profile { cfg, tf_min, point, cal, items: vec![], cur: None })
    }

    fn dur(&self) -> i64 {
        match self.cfg.mode {
            Mode::Weekly => 604800,
            Mode::Session => self.cfg.sess_hours * 3600,
            Mode::Micro => self.cfg.sess_hours * 3600 / self.cfg.parts,
            Mode::Daily => 86400,
        }
    }

    fn first_ps(&self, last_t: i64) -> i64 {
        let mult = if self.cfg.mode == Mode::Weekly { 1.1 } else { 1.5 };
        let look = (((self.cfg.count as i64 + 1) * self.dur()) as f64 * mult) as i64 + 2 * 86400;
        self.cal.bounds(self.cfg.mode, last_t - look).0
    }

    /// Tick otomatis dari range bar sebelum periode mulai (setara lb bar M1 di MQ5).
    fn initial_tick(&self, ps: i64, ser: &Series) -> f64 {
        if self.cfg.ticks > 0 {
            return self.cfg.ticks as f64 * self.point;
        }
        let lb_min = std::cmp::max(20, std::cmp::min(self.dur() / 60, 20000));
        let lb = std::cmp::max(2, py_round(lb_min as f64 / ser.tf_min as f64)) as usize;
        let i1 = ser.lower_bound(ps);
        let i0 = i1.saturating_sub(lb);
        if i1 - i0 < 2 {
            return 0.0;
        }
        let hi = ser.h[i0..i1].iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let lo = ser.l[i0..i1].iter().cloned().fold(f64::INFINITY, f64::min);
        if hi <= lo {
            return 0.0;
        }
        self.point.max(mql_round((hi - lo) / self.cfg.rows as f64 / self.point) * self.point)
    }

    pub fn build(&mut self, ser: &Series) {
        self.items.clear();
        self.cur = None;
        if ser.is_empty() {
            return;
        }
        let i0 = ser.lower_bound(self.first_ps(*ser.t.last().unwrap()));
        let letter_sec = self.cfg.tpo_min * 60;
        for i in i0..ser.len() {
            let bt = ser.t[i];
            let need_new = match &self.cur {
                None => true,
                Some(c) => bt < c.start || bt > c.end,
            };
            if need_new {
                if let Some(mut c) = self.cur.take() {
                    c.compute(
                        self.cfg.va_pct,
                        self.cfg.rows,
                        self.point,
                        self.cfg.va_method,
                        self.cfg.va_bound,
                        self.cfg.poc_rule,
                        self.cfg.va_tie_break,
                        self.cfg.va_stop,
                    );
                    c.completed = true;
                    self.items.push(c);
                    if self.items.len() > self.cfg.count {
                        let drop = self.items.len() - self.cfg.count;
                        self.items.drain(0..drop);
                    }
                }
                let (ps, pe) = self.cal.bounds(self.cfg.mode, bt);
                let mut p = Period::new(ps, pe);
                p.tick = self.initial_tick(ps, ser);
                self.cur = Some(p);
            }
            self.cur.as_mut().unwrap().add_bar(bt, ser.o[i], ser.h[i], ser.l[i], letter_sec, Some(ser.c[i]));
        }
        if let Some(c) = self.cur.as_mut() {
            c.compute(
                self.cfg.va_pct,
                self.cfg.rows,
                self.point,
                self.cfg.va_method,
                self.cfg.va_bound,
                self.cfg.poc_rule,
                self.cfg.va_tie_break,
                self.cfg.va_stop,
            );
        }
        for p in self.items.iter_mut() {
            scan_touch(p, ser, self.cfg.tpo_min * 60, self.cfg.touch_letters);
        }
    }

    pub fn name(&self, idx: usize) -> String {
        format!("{}-{}", self.cfg.tag, self.items.len() - idx)
    }

    pub fn naked_levels(&self) -> Vec<(String, f64)> {
        let mut out = vec![];
        for (i, p) in self.items.iter().enumerate() {
            if !p.valid {
                continue;
            }
            for (k, kind) in KINDS.iter().enumerate() {
                if p.touch[k].is_none() {
                    out.push((format!("n{} {}", kind, self.name(i)), p.level(k)));
                }
            }
        }
        out
    }

    pub fn cal(&self) -> &Calendar {
        &self.cal
    }
}

/// First touch POC/VAH/VAL setelah periode selesai.
/// `letters` <= 1: satu bar yang memuat level sudah cukup (perilaku lama).
/// `letters` >= 2: level baru dianggap tersentuh bila harga memuat level (high >= level >= low) pada `letters` huruf TPO
/// BERURUTAN (satu huruf = `letter_sec` detik, dihitung dari awal periode berikutnya, sama dengan grid huruf profil).
/// Sumbu yang hanya 1 huruf lalu menjauh tidak menghapus status naked dan hitungan mulai dari nol.
/// Waktu & arah dicatat dari bar pertama huruf pertama dalam rangkaian (arah = pendekatan awal); level baru terisi
/// begitu huruf ke-N mulai memuat level (tidak menunggu huruf itu selesai).
fn scan_touch(p: &mut Period, ser: &Series, letter_sec: i64, letters: usize) {
    if !p.valid {
        return;
    }
    let need = letters.max(1);
    let origin = p.end + 1;
    // per level: (jumlah huruf berurutan, huruf terakhir yang dihitung, (waktu, arah) bar pertama rangkaian)
    let mut run: [(usize, i64, Option<(i64, i32)>); 3] = [(0, i64::MIN, None); 3];
    let mut i = ser.lower_bound(origin);
    while i < ser.len() && !p.touch.iter().all(|t| t.is_some()) {
        let (h, l, t) = (ser.h[i], ser.l[i], ser.t[i]);
        let pc = if i > 0 { ser.c[i - 1] } else { ser.o[i] };
        let bucket = (t - origin).div_euclid(letter_sec.max(1));
        for k in 0..3 {
            let lv = p.level(k);
            if p.touch[k].is_some() || !(h >= lv && lv >= l) {
                continue;
            }
            let dir = if pc < lv { 1 } else { -1 };
            if need <= 1 {
                p.touch[k] = Some((t, dir));
                continue;
            }
            let r = &mut run[k];
            if bucket == r.1 {
                continue; // huruf ini sudah dihitung
            }
            if bucket == r.1 + 1 && r.0 > 0 {
                r.0 += 1;
            } else {
                *r = (1, bucket, Some((t, dir))); // rangkaian baru
            }
            r.1 = bucket;
            if r.0 >= need {
                p.touch[k] = r.2;
            }
        }
        i += 1;
    }
}

#[cfg(test)]
mod touch_tests {
    use super::*;
    use crate::series::{Bar, Bars};

    // periode selesai di t=999 (huruf 600 dtk): bucket n = [1000+600n, 1000+600(n+1))
    fn period() -> Period {
        let mut p = Period::new(0, 999);
        p.valid = true;
        p.poc = 100.0;
        p.vah = 110.0;
        p.val = 90.0;
        p
    }
    fn bars(rows: &[(i64, f64, f64, f64, f64)]) -> Series {
        let mut b = Bars::new();
        for &(t, o, h, l, c) in rows {
            b.insert(t, Bar { o, h, l, c, v: 0.0 });
        }
        Series::new(5, &b)
    }
    // bar yang tidak memuat level mana pun (101-105 di antara POC 100 dan VAH 110)
    const FAR: (f64, f64, f64) = (103.0, 105.0, 101.0);

    #[test]
    fn one_bar_old_behaviour() {
        let ser = bars(&[(1000, 103.0, 103.0, 99.0, 99.5), (1300, 99.5, 105.0, 101.0, 103.0)]);
        let mut p = period();
        scan_touch(&mut p, &ser, 600, 1);
        assert_eq!(p.touch[0], Some((1000, -1))); // satu bar cukup; open 103 di atas level 100 -> datang dari atas
    }

    #[test]
    fn single_letter_poke_is_not_a_touch() {
        // huruf 0 menyentuh POC=100, huruf 1 menjauh, huruf 2 menyentuh lagi (sendiri) -> tetap naked
        let ser = bars(&[
            (1000, 103.0, 103.0, 99.0, 102.0), // huruf 0: sentuh 100
            (1300, 102.0, FAR.1, FAR.2, FAR.0), // huruf 0 (bucket 0) tetap
            (1600, 103.0, 105.0, 101.0, 103.0), // huruf 1: tidak sentuh
            (2200, 103.0, 103.0, 99.0, 102.0), // huruf 2: sentuh
        ]);
        let mut p = period();
        scan_touch(&mut p, &ser, 600, 2);
        assert_eq!(p.touch[0], None);
    }

    #[test]
    fn two_consecutive_letters_touch_with_first_letter_time_and_dir() {
        let ser = bars(&[
            (900 + 100, 102.0, 103.0, 99.0, 101.0), // bucket 0 @1000: sentuh, datang dari atas (pc = open 102 > 100)
            (1600, 101.0, 102.0, 99.5, 101.0),      // bucket 1 @1600: sentuh lagi -> terkonfirmasi
        ]);
        let mut p = period();
        scan_touch(&mut p, &ser, 600, 2);
        assert_eq!(p.touch[0], Some((1000, -1)));
        assert_eq!(p.touch[1], None);
    }

    #[test]
    fn gap_letter_resets_count() {
        let ser = bars(&[
            (1000, 102.0, 103.0, 99.0, 101.0), // bucket 0 sentuh
            (1600, 101.0, 105.0, 101.0, 104.0), // bucket 1 tidak
            (2200, 104.0, 105.0, 99.0, 100.0), // bucket 2 sentuh (mulai baru)
            (2800, 100.0, 101.0, 99.0, 100.0), // bucket 3 sentuh -> terkonfirmasi dari bucket 2
        ]);
        let mut p = period();
        scan_touch(&mut p, &ser, 600, 2);
        assert_eq!(p.touch[0].map(|x| x.0), Some(2200));
    }

    #[test]
    fn many_bars_in_same_letter_count_once() {
        let ser = bars(&[(1000, 102.0, 103.0, 99.0, 101.0), (1300, 101.0, 102.0, 99.0, 100.0)]); // keduanya bucket 0
        let mut p = period();
        scan_touch(&mut p, &ser, 600, 2);
        assert_eq!(p.touch[0], None);
    }
}
