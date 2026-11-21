//! Satu periode TPO (hari/sesi/minggu): huruf, POC, Value Area, status touch.
use crate::util::mql_round;

pub const MAX_ROWS: i64 = 20000;
pub const KINDS: [&str; 3] = ["POC", "VAH", "VAL"];

/// Cara memperluas Value Area dari POC.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaMethod {
    /// Bawaan (gaya CME): tiap langkah bandingkan jumlah 2 baris di atas vs 2 baris di bawah, ambil sisi yang lebih besar (seri -> atas).
    TwoRows,
    /// Satu baris per langkah: bandingkan 1 baris di atas vs 1 baris di bawah, ambil yang lebih besar (seri -> atas).
    OneRow,
}

impl VaMethod {
    pub fn parse(s: &str) -> Option<VaMethod> {
        match s.trim().to_lowercase().as_str() {
            "two_rows" | "2" => Some(VaMethod::TwoRows),
            "one_row" | "1" => Some(VaMethod::OneRow),
            _ => None,
        }
    }
}

/// Batas level harga VAH dan VAL.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaBound {
    /// Tepi luar baris (bawaan lama: pusat baris ± 0.5 tick).
    Edge,
    /// Harga pusat baris (gaya Sierra Chart / ATAS: VAH dan VAL persis pada level baris).
    Center,
}

impl VaBound {
    pub fn parse(s: &str) -> Option<VaBound> {
        match s.trim().to_lowercase().as_str() {
            "center" | "pusat" | "mid" => Some(VaBound::Center),
            "edge" | "tepi" => Some(VaBound::Edge),
            _ => None,
        }
    }
}

/// Cara menentukan Point of Control (POC) bila terjadi seri (bimodal / multiple peaks).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PocRule {
    /// Bawaan: pilih baris yang paling dekat dengan titik tengah rentang High-Low profil (midpoint).
    Mid,
    /// Pilih baris yang paling dekat dengan harga penutupan periode.
    Close,
    /// Gaya ATAS: bila bimodal/seri, pilih distribusi aktif terakhir di sesi lalu ambil baris terawal terbentuk / terendah (first-formed base level).
    Atas,
    /// Pilih harga tertinggi di antara kandidat seri.
    High,
    /// Pilih harga terendah di antara kandidat seri.
    Low,
}

impl PocRule {
    pub fn parse(s: &str) -> Option<PocRule> {
        match s.trim().to_lowercase().as_str() {
            "mid" | "center" | "middle" | "tengah" => Some(PocRule::Mid),
            "close" | "settle" | "tutup" => Some(PocRule::Close),
            "atas" | "first" | "chrono" | "orderflow" => Some(PocRule::Atas),
            "high" => Some(PocRule::High),
            "low" | "bawah" => Some(PocRule::Low),
            _ => None,
        }
    }
}

/// Kondisi penghentian ekspansi Value Area terhadap target va_pct.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaStop {
    /// Bawaan CME: minimal mencapai atau melampaui va_pct (cur_va >= ceil(total * va_pct)).
    Ceil,
    /// Gaya ATAS: berhenti sebelum va_pct terlampaui (cur_va + next > total * va_pct).
    Floor,
    /// Berhenti pada persentase paling dekat ke va_pct.
    Closest,
}

impl VaStop {
    pub fn parse(s: &str) -> Option<VaStop> {
        match s.trim().to_lowercase().as_str() {
            "ceil" | "cme" | "min" => Some(VaStop::Ceil),
            "floor" | "max" | "before" => Some(VaStop::Floor),
            "closest" | "near" | "nearest" | "dekat" => Some(VaStop::Closest),
            _ => None,
        }
    }
}

/// Aturan seri saat ekspansi Value Area 2 baris (TwoRows).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaTieBreak {
    /// Bawaan lama: bila up_sum == dn_sum, selalu ambil atas (up_sum >= dn_sum).
    Up,
    /// Standar CBOT/ATAS: bila up_sum == dn_sum, bandingkan baris tunggal terdekat (cnt[up+1] vs cnt[dn-1]).
    Cbot,
}

impl VaTieBreak {
    pub fn parse(s: &str) -> Option<VaTieBreak> {
        match s.trim().to_lowercase().as_str() {
            "up" | "atas" => Some(VaTieBreak::Up),
            "cbot" | "atas_cbot" | "balance" | "seimbang" => Some(VaTieBreak::Cbot),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Period {
    pub start: i64,
    pub end: i64,
    pub tick: f64,
    pub lh: Vec<f64>, // high tiap huruf
    pub ll: Vec<f64>, // low tiap huruf
    cur_bucket: i64,
    pub d_high: f64,
    pub d_low: f64,
    pub min_bin: i64,
    pub n_bins: i64,
    pub valid: bool,
    pub poc: f64,
    pub vah: f64,
    pub val: f64,
    pub completed: bool,
    pub open_p: f64,
    pub has_open: bool,
    pub close_p: Option<f64>,
    pub lc: Option<f64>,   // close huruf TPO terakhir yang sudah selesai
    pub lc_t: Option<i64>, // waktu selesainya
    pub touch: [Option<(i64, i32)>; 3], // (waktu, arah +1 = dari bawah / -1 = dari atas)
    // hasil compute() yang disimpan untuk --dump (diagnosa)
    ra: Vec<i64>,  // baris terendah tiap huruf (indeks absolut baris)
    rb: Vec<i64>,  // baris tertinggi tiap huruf
    cnt: Vec<i64>, // jumlah TPO per baris (indeks relatif min_bin)
    poc_i: i64,
    va_up: i64,
    va_dn: i64,
}

impl Period {
    pub fn new(start: i64, end: i64) -> Period {
        Period {
            start,
            end,
            tick: 0.0,
            lh: vec![],
            ll: vec![],
            cur_bucket: -1,
            d_high: f64::NEG_INFINITY,
            d_low: f64::INFINITY,
            min_bin: 0,
            n_bins: 0,
            valid: false,
            poc: 0.0,
            vah: 0.0,
            val: 0.0,
            completed: false,
            open_p: 0.0,
            has_open: false,
            close_p: None,
            lc: None,
            lc_t: None,
            touch: [None; 3],
            ra: vec![],
            rb: vec![],
            cnt: vec![],
            poc_i: 0,
            va_up: 0,
            va_dn: 0,
        }
    }

    pub fn level(&self, kind: usize) -> f64 {
        [self.poc, self.vah, self.val][kind]
    }

    pub fn add_bar(&mut self, t: i64, o: f64, h: f64, l: f64, letter_sec: i64, c: Option<f64>) {
        let prev_c = self.close_p;
        if c.is_some() {
            self.close_p = c;
        }
        if !self.has_open {
            self.open_p = o;
            self.has_open = true;
        }
        self.d_high = self.d_high.max(h);
        self.d_low = self.d_low.min(l);
        let b = (t - self.start).div_euclid(letter_sec);
        if self.lh.is_empty() || b != self.cur_bucket {
            if !self.lh.is_empty() {
                if let Some(pc) = prev_c {
                    // huruf sebelumnya baru saja selesai -> close-nya
                    self.lc = Some(pc);
                    self.lc_t = Some(self.start + (self.cur_bucket + 1) * letter_sec);
                }
            }
            self.lh.push(h);
            self.ll.push(l);
            self.cur_bucket = b;
        } else {
            let n = self.lh.len() - 1;
            self.lh[n] = self.lh[n].max(h);
            self.ll[n] = self.ll[n].min(l);
        }
    }

    pub fn compute(&mut self, va_pct: f64, auto_rows: i64, point: f64, method: VaMethod, bound: VaBound, poc_rule: PocRule, tie_break: VaTieBreak, va_stop: VaStop) {
        self.valid = false;
        self.n_bins = 0;
        if self.lh.is_empty() {
            return;
        }
        if self.tick <= 0.0 {
            let rng = (self.d_high - self.d_low).max(0.0);
            self.tick = point.max(mql_round(rng / auto_rows as f64 / point) * point);
        }
        let mut a: Vec<i64> = vec![];
        let mut b: Vec<i64> = vec![];
        let (mut mn, mut mx) = (0i64, 0i64);
        for _ in 0..30 {
            // tick dilipat dua bila baris > MAX_ROWS
            a = self.ll.iter().map(|x| (x / self.tick - 0.5 - 1e-7).ceil() as i64).collect();
            b = self.lh.iter().map(|x| (x / self.tick + 0.5 + 1e-7).floor() as i64).collect();
            mn = *a.iter().min().unwrap();
            mx = *b.iter().max().unwrap();
            if mx - mn + 1 <= MAX_ROWS {
                break;
            }
            self.tick *= 2.0;
        }
        let span = mx - mn + 1;
        if span < 1 || span > MAX_ROWS {
            return;
        }
        let mut diff = vec![0i64; (span + 1) as usize];
        for (ai, bi) in a.iter().zip(b.iter()) {
            diff[(ai - mn) as usize] += 1;
            diff[(bi - mn + 1) as usize] -= 1;
        }
        let mut cnt: Vec<i64> = Vec::with_capacity(span as usize);
        let mut run = 0i64;
        for k in 0..span as usize {
            run += diff[k];
            cnt.push(run);
        }
        self.min_bin = mn;
        self.n_bins = span;
        let n = span;

        // POC: TPO terbanyak; bila seri -> evaluasi sesuai poc_rule
        let max_c = *cnt.iter().max().unwrap();
        let mid_idx = (n - 1) as f64 / 2.0;

        let mut poc_i = 0i64;
        if poc_rule == PocRule::Atas {
            let mut first_let = vec![usize::MAX; n as usize];
            let mut last_let = vec![0usize; n as usize];
            for (let_idx, (ai, bi)) in a.iter().zip(b.iter()).enumerate() {
                let start_k = (*ai - mn) as usize;
                let end_k = (*bi - mn) as usize;
                for k in start_k..=end_k {
                    if let_idx < first_let[k] { first_let[k] = let_idx; }
                    if let_idx > last_let[k] { last_let[k] = let_idx; }
                }
            }
            let mut max_last = 0;
            for i in 0..n {
                let idx = i as usize;
                if cnt[idx] == max_c && last_let[idx] > max_last {
                    max_last = last_let[idx];
                }
            }
            let mut min_first = usize::MAX;
            for i in 0..n {
                let idx = i as usize;
                if cnt[idx] == max_c && last_let[idx] == max_last && first_let[idx] < min_first {
                    min_first = first_let[idx];
                }
            }
            for i in 0..n {
                let idx = i as usize;
                if cnt[idx] == max_c && last_let[idx] == max_last && first_let[idx] == min_first {
                    poc_i = i;
                    break;
                }
            }
        } else {
            let mut best_dist = 1e10f64;
            for i in 0..n {
                if cnt[i as usize] == max_c {
                    let dd = match poc_rule {
                        PocRule::Mid => (i as f64 - mid_idx).abs(),
                        PocRule::Close => {
                            if let Some(cp) = self.close_p {
                                let price = (self.min_bin + i) as f64 * self.tick;
                                (price - cp).abs()
                            } else {
                                (i as f64 - mid_idx).abs()
                            }
                        }
                        PocRule::High => (n - 1 - i) as f64,
                        PocRule::Low => i as f64,
                        PocRule::Atas => 0.0,
                    };
                    if dd < best_dist {
                        best_dist = dd;
                        poc_i = i;
                    }
                }
            }
        }

        // Value Area: perluas dari POC sampai mencapai va_pct
        let total: i64 = cnt.iter().sum();
        let target_flt = total as f64 * (va_pct / 100.0);
        let target_ceil = target_flt.ceil() as i64;
        let (mut up, mut dn) = (poc_i, poc_i);
        let mut cur_va = cnt[poc_i as usize];
        while cur_va < target_ceil {
            if method == VaMethod::OneRow {
                let up_ok = up < n - 1;
                let dn_ok = dn > 0;
                if !up_ok && !dn_ok {
                    break;
                }
                let up_c = if up_ok { cnt[(up + 1) as usize] } else { -1 };
                let dn_c = if dn_ok { cnt[(dn - 1) as usize] } else { -1 };
                let (take_up, add) = if up_ok && dn_ok {
                    if up_c != dn_c {
                        (up_c > dn_c, if up_c > dn_c { up_c } else { dn_c })
                    } else {
                        match tie_break {
                            VaTieBreak::Up => (true, up_c),
                            VaTieBreak::Cbot => (false, dn_c),
                        }
                    }
                } else if up_ok {
                    (true, up_c)
                } else {
                    (false, dn_c)
                };

                if va_stop == VaStop::Floor && (cur_va + add) as f64 > target_flt {
                    break;
                }
                if va_stop == VaStop::Closest && (cur_va + add) as f64 > target_flt {
                    if (cur_va as f64 - target_flt).abs() < ((cur_va + add) as f64 - target_flt).abs() {
                        break;
                    }
                }

                if take_up {
                    up += 1;
                    cur_va += add;
                } else {
                    dn -= 1;
                    cur_va += add;
                }
                if va_stop == VaStop::Ceil && cur_va >= target_ceil {
                    break;
                }
                continue;
            }
            let (mut up_rows, mut up_sum) = (0i64, 0i64);
            if up < n - 1 {
                up_sum = cnt[(up + 1) as usize];
                up_rows = 1;
                if up + 2 <= n - 1 {
                    up_sum += cnt[(up + 2) as usize];
                    up_rows = 2;
                }
            }
            let (mut dn_rows, mut dn_sum) = (0i64, 0i64);
            if dn > 0 {
                dn_sum = cnt[(dn - 1) as usize];
                dn_rows = 1;
                if dn - 2 >= 0 {
                    dn_sum += cnt[(dn - 2) as usize];
                    dn_rows = 2;
                }
            }
            if up_rows == 0 && dn_rows == 0 {
                break;
            }
            let (take_up, add, rows) = if up_rows > 0 && dn_rows == 0 {
                (true, up_sum, up_rows)
            } else if dn_rows > 0 && up_rows == 0 {
                (false, dn_sum, dn_rows)
            } else if up_sum != dn_sum {
                if up_sum > dn_sum {
                    (true, up_sum, up_rows)
                } else {
                    (false, dn_sum, dn_rows)
                }
            } else {
                match tie_break {
                    VaTieBreak::Up => (true, up_sum, up_rows),
                    VaTieBreak::Cbot => {
                        let up_single = cnt[(up + 1) as usize];
                        let dn_single = cnt[(dn - 1) as usize];
                        if up_single != dn_single {
                            if up_single > dn_single {
                                (true, up_sum, up_rows)
                            } else {
                                (false, dn_sum, dn_rows)
                            }
                        } else {
                            let up_second = if up_rows > 1 { cnt[(up + 2) as usize] } else { 0 };
                            let dn_second = if dn_rows > 1 { cnt[(dn - 2) as usize] } else { 0 };
                            if up_second != dn_second {
                                if up_second > dn_second {
                                    (true, up_sum, up_rows)
                                } else {
                                    (false, dn_sum, dn_rows)
                                }
                            } else {
                                (false, dn_sum, dn_rows)
                            }
                        }
                    }
                }
            };

            if va_stop == VaStop::Floor && (cur_va + add) as f64 > target_flt {
                break;
            }
            if va_stop == VaStop::Closest && (cur_va + add) as f64 > target_flt {
                if (cur_va as f64 - target_flt).abs() < ((cur_va + add) as f64 - target_flt).abs() {
                    break;
                }
            }

            if take_up {
                up += rows;
                cur_va += add;
            } else {
                dn -= rows;
                cur_va += add;
            }

            if va_stop == VaStop::Ceil && cur_va >= target_ceil {
                break;
            }
        }
        self.ra = a;
        self.rb = b;
        self.cnt = cnt;
        self.poc_i = poc_i;
        self.va_up = up;
        self.va_dn = dn;

        let half = match bound {
            VaBound::Center => 0.0,
            VaBound::Edge => self.tick / 2.0,
        };
        self.poc = (self.min_bin + poc_i) as f64 * self.tick;
        self.vah = (self.min_bin + up) as f64 * self.tick + half;
        self.val = (self.min_bin + dn) as f64 * self.tick - half;
        self.valid = true;
    }

    /// Isi profil per baris (atas -> bawah): harga, jumlah TPO, tanda POC/VA, dan huruf-hurufnya. Untuk dibandingkan dengan platform lain.
    pub fn dump(&self) -> String {
        if !self.valid || self.cnt.is_empty() {
            return "(profil belum valid)".into();
        }
        const L: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        let dec = crate::util::decimals_of(self.tick).max(2);
        let mut out = vec![];
        for i in (0..self.n_bins).rev() {
            let row = self.min_bin + i;
            let letters: String = (0..self.ra.len()).filter(|&k| self.ra[k] <= row && row <= self.rb[k]).map(|k| L[k % L.len()] as char).collect();
            let mark = if i == self.poc_i { "POC" } else if i == self.va_up { "VAH" } else if i == self.va_dn { "VAL" } else { "   " };
            let inside = if i >= self.va_dn && i <= self.va_up { "│" } else { " " };
            out.push(format!("{:>10.*} {:>3} {} {} {}", dec, row as f64 * self.tick, self.cnt[i as usize], mark, inside, letters));
        }
        out.join("\n")
    }

    pub fn total_tpo(&self) -> i64 {
        self.cnt.iter().sum()
    }
    pub fn va_rows(&self) -> i64 {
        if self.cnt.is_empty() { 0 } else { self.va_up - self.va_dn + 1 }
    }

    /// Ekspor representasi baris-baris TPO untuk rendering overlay di chart.
    pub fn tpo_rows(&self) -> Vec<TpoRowSnap> {
        if !self.valid || self.cnt.is_empty() {
            return vec![];
        }
        const L: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        let mut out = Vec::with_capacity(self.n_bins as usize);
        for i in 0..self.n_bins {
            let row = self.min_bin + i;
            let price = row as f64 * self.tick;
            let count = self.cnt[i as usize];
            let letters: String = (0..self.ra.len())
                .filter(|&k| self.ra[k] <= row && row <= self.rb[k])
                .map(|k| L[k % L.len()] as char)
                .collect();
            out.push(TpoRowSnap {
                price,
                count,
                letters,
                is_poc: i == self.poc_i,
                is_vah: i == self.va_up,
                is_val: i == self.va_dn,
                in_va: i >= self.va_dn && i <= self.va_up,
            });
        }
        out
    }
}

/// Data satu baris harga pada histogram TPO untuk chart overlay.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct TpoRowSnap {
    pub price: f64,
    pub count: i64,
    pub letters: String,
    pub is_poc: bool,
    pub is_vah: bool,
    pub is_val: bool,
    pub in_va: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_va_bound() {
        assert_eq!(VaBound::parse("center"), Some(VaBound::Center));
        assert_eq!(VaBound::parse("pusat"), Some(VaBound::Center));
        assert_eq!(VaBound::parse("mid"), Some(VaBound::Center));
        assert_eq!(VaBound::parse("edge"), Some(VaBound::Edge));
        assert_eq!(VaBound::parse("tepi"), Some(VaBound::Edge));
        assert_eq!(VaBound::parse("invalid"), None);
    }

    #[test]
    fn parse_poc_rule() {
        assert_eq!(PocRule::parse("mid"), Some(PocRule::Mid));
        assert_eq!(PocRule::parse("close"), Some(PocRule::Close));
        assert_eq!(PocRule::parse("atas"), Some(PocRule::Atas));
        assert_eq!(PocRule::parse("high"), Some(PocRule::High));
        assert_eq!(PocRule::parse("low"), Some(PocRule::Low));
        assert_eq!(PocRule::parse("unknown"), None);
    }

    #[test]
    fn parse_va_tie_break() {
        assert_eq!(VaTieBreak::parse("up"), Some(VaTieBreak::Up));
        assert_eq!(VaTieBreak::parse("cbot"), Some(VaTieBreak::Cbot));
        assert_eq!(VaTieBreak::parse("balance"), Some(VaTieBreak::Cbot));
        assert_eq!(VaTieBreak::parse("unknown"), None);
    }

    #[test]
    fn parse_va_stop() {
        assert_eq!(VaStop::parse("ceil"), Some(VaStop::Ceil));
        assert_eq!(VaStop::parse("cme"), Some(VaStop::Ceil));
        assert_eq!(VaStop::parse("floor"), Some(VaStop::Floor));
        assert_eq!(VaStop::parse("closest"), Some(VaStop::Closest),);
        assert_eq!(VaStop::parse("unknown"), None);
    }

    #[test]
    fn va_tie_break_cbot_favors_single_row() {
        let mut p = Period::new(0, 3600);
        p.tick = 1.0;
        p.add_bar(0, 5.0, 5.0, 5.0, 60, Some(5.0));
        let mut p_up = p.clone();
        p_up.compute(70.0, 80, 0.01, VaMethod::TwoRows, VaBound::Center, PocRule::Mid, VaTieBreak::Up, VaStop::Ceil);
        let mut p_cbot = p.clone();
        p_cbot.compute(70.0, 80, 0.01, VaMethod::TwoRows, VaBound::Center, PocRule::Mid, VaTieBreak::Cbot, VaStop::Ceil);
        assert!(p_up.valid && p_cbot.valid);
    }

    #[test]
    fn va_bound_center_vs_edge() {
        let mut p_edge = Period::new(0, 3600);
        p_edge.tick = 1.0;
        p_edge.add_bar(0, 100.0, 102.0, 100.0, 1800, Some(101.0));
        p_edge.compute(70.0, 80, 0.01, VaMethod::TwoRows, VaBound::Edge, PocRule::Mid, VaTieBreak::Up, VaStop::Ceil);

        let mut p_center = Period::new(0, 3600);
        p_center.tick = 1.0;
        p_center.add_bar(0, 100.0, 102.0, 100.0, 1800, Some(101.0));
        p_center.compute(70.0, 80, 0.01, VaMethod::TwoRows, VaBound::Center, PocRule::Mid, VaTieBreak::Up, VaStop::Ceil);

        assert!(p_edge.valid && p_center.valid);
        assert_eq!(p_edge.poc, p_center.poc);
        assert_eq!(p_edge.vah, p_center.vah + 0.5);
        assert_eq!(p_edge.val, p_center.val - 0.5);
    }

    #[test]
    fn poc_rule_close_selects_closest_to_close() {
        let mut p = Period::new(0, 3600);
        p.tick = 1.0;
        p.add_bar(0, 100.0, 101.0, 100.0, 1800, Some(100.5));
        p.add_bar(1800, 110.0, 111.0, 110.0, 1800, Some(111.0));

        let mut p_mid = p.clone();
        p_mid.compute(70.0, 80, 0.01, VaMethod::TwoRows, VaBound::Center, PocRule::Mid, VaTieBreak::Up, VaStop::Ceil);

        let mut p_close = p.clone();
        p_close.compute(70.0, 80, 0.01, VaMethod::TwoRows, VaBound::Center, PocRule::Close, VaTieBreak::Up, VaStop::Ceil);

        assert!(p_mid.valid && p_close.valid);
        assert_eq!(p_mid.poc, 101.0);
        assert_eq!(p_close.poc, 111.0);
    }

    #[test]
    fn poc_rule_atas_picks_latest_first_formed() {
        let mut p = Period::new(0, 3600);
        p.tick = 1.0;
        // Huruf A (0): [100, 101]
        p.add_bar(0, 100.0, 101.0, 100.0, 1200, Some(101.0));
        // Huruf B (1200): [110, 111]
        p.add_bar(1200, 110.0, 111.0, 110.0, 1200, Some(111.0));
        // Huruf C (2400): [110, 110]
        p.add_bar(2400, 110.0, 110.0, 110.0, 1200, Some(110.0));

        let mut p_atas = p.clone();
        p_atas.compute(70.0, 80, 0.01, VaMethod::TwoRows, VaBound::Center, PocRule::Atas, VaTieBreak::Up, VaStop::Ceil);

        assert!(p_atas.valid);
        // Huruf C aktif di 110, maka 110 adalah baris aktif terakhir
        assert_eq!(p_atas.poc, 110.0);
    }

    #[test]
    fn tpo_rows_returns_valid_structure() {
        let mut p = Period::new(0, 3600);
        p.tick = 1.0;
        p.add_bar(0, 100.0, 102.0, 100.0, 1800, Some(101.0));
        p.add_bar(1800, 101.0, 103.0, 101.0, 1800, Some(102.0));
        p.compute(70.0, 80, 0.01, VaMethod::TwoRows, VaBound::Center, PocRule::Mid, VaTieBreak::Up, VaStop::Ceil);

        let rows = p.tpo_rows();
        assert!(!rows.is_empty());
        assert!(rows.iter().any(|r| r.is_poc));
        assert!(rows.iter().any(|r| r.in_va));
        for r in &rows {
            assert!(r.count > 0);
            assert!(!r.letters.is_empty());
        }
    }
}
