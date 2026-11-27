//! Perhitungan hanya memakai jendela bar yang dibutuhkan; hasilnya harus persis sama dengan memakai seluruh riwayat.
use mcdash_core::{default_profiles, Bar, Bars, Series, TpoEngine};
use std::collections::{BTreeMap, HashMap};

fn walk(tf: i64, n: i64) -> Bars {
    let end = 1_790_000_000i64 / (tf * 60) * (tf * 60);
    let mut seed = 12345u64 + tf as u64;
    let mut rnd = move || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) as f64 / (1u64 << 31) as f64 - 0.5
    };
    let mut px = 4000.0;
    (0..n)
        .map(|i| {
            let o = px;
            let c = o + rnd() * 4.0;
            px = c;
            (end - (n - i) * tf * 60, Bar { o, h: o.max(c) + rnd().abs() * 2.0, l: o.min(c) - rnd().abs() * 2.0, c, v: 1.0 })
        })
        .collect()
}

#[test]
fn jendela_bar_memberi_hasil_sama_dengan_seluruh_riwayat() {
    for ticks in [0, 10] {
        let mut cfgs = default_profiles();
        for c in &mut cfgs {
            c.count = 6;
            c.ticks = ticks;
            c.touch_letters = 2;
        }
        let bars: HashMap<i64, Bars> = [1, 5, 15, 60].into_iter().map(|tf| (tf, walk(tf, 60_000))).collect();
        let mut trimmed = TpoEngine::new("X", 0.01, "America/New_York", cfgs.clone(), 14, 0).unwrap();
        let series = trimmed.prepare_series(&bars).unwrap();
        for (tf, s) in &series {
            assert!(s.len() < bars[tf].len(), "M{tf} tidak dipangkas");
        }
        assert!(!series.contains_key(&60), "tf yang tidak dipakai tidak perlu disalin");
        trimmed.rebuild_series(&series).unwrap();

        let full: BTreeMap<i64, Series> = bars.iter().map(|(tf, b)| (*tf, Series::new(*tf, b))).collect();
        let mut whole = TpoEngine::new("X", 0.01, "America/New_York", cfgs, 14, 0).unwrap();
        whole.rebuild_series(&full).unwrap();

        assert_eq!(serde_json::to_string(&trimmed.snapshot()).unwrap(), serde_json::to_string(&whole.snapshot()).unwrap());
        assert_eq!(serde_json::to_string(&trimmed.chart_tpo()).unwrap(), serde_json::to_string(&whole.chart_tpo()).unwrap());
    }
}

#[test]
fn view_since_hanya_mengirim_baris_terbaru() {
    let cfgs = default_profiles();
    let bars: HashMap<i64, Bars> = [5, 15].into_iter().map(|tf| (tf, walk(tf, 20_000))).collect();
    let mut e = TpoEngine::new("X", 0.01, "America/New_York", cfgs, 14, 0).unwrap();
    e.rebuild(&bars).unwrap();
    let all = e.chart_tpo();
    let s = &all.profiles["S"].periods;
    let since = s.iter().rev().find(|p| !p.developing).unwrap().start;
    let view = all.view(Some("S"), Some(since));
    assert_eq!(view.profiles.len(), 1);
    for p in &view.profiles["S"].periods {
        assert_eq!(p.rows.is_some(), p.developing || p.start >= since, "{}", p.name);
    }
    // level yang sudah tersentuh membawa waktu candle penyentuhnya, setelah periode selesai
    assert!(s.iter().any(|p| p.touch_poc.map_or(false, |t| t > p.end)));
}
