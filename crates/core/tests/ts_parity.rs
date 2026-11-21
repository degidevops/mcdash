//! Paritas dengan implementasi TS lama: bias dan pesan Telegram harus sama persis (byte-per-byte).
use mcdash_core::bias::{full_bias, ORDER};
use mcdash_core::telegram::{build_messages, TgSettings};
use mcdash_core::util::decimals_of;
use mcdash_core::Snap;
use serde_json::Value;

const MODES: [&str; 6] = ["mid", "above", "below", "above_high", "below_low", "none"];
const DELTAS: [f64; 8] = [-40.0, -10.0, -3.0, 0.0, 3.0, 10.0, 40.0, 200.0];

fn load(case: &str) -> Snap {
    let p = format!("{}/tests/golden/{}.json", env!("CARGO_MANIFEST_DIR"), case);
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    serde_json::from_value(v["expected"].clone()).unwrap()
}

#[test]
fn bias_dan_telegram_sama_dengan_ts() {
    let p = format!("{}/tests/golden/ts_parity.json", env!("CARGO_MANIFEST_DIR"));
    let entries: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    assert!(entries.len() >= 40);
    let mut checked = 0;
    for e in &entries {
        let case = e["case"].as_str().unwrap();
        let k = e["k"].as_u64().unwrap() as usize;
        let mut s = load(case);
        s.price += DELTAS[k] * (s.atr / 10.0);
        for (pi, (_, p)) in s.profiles.iter_mut().enumerate() {
            let Some(pv) = p.items.last().cloned() else { continue };
            if p.developing.is_none() || !pv.valid { continue; }
            let mode = MODES[(k + pi) % MODES.len()];
            let (vah, val) = (pv.vah.unwrap(), pv.val.unwrap());
            let lc = match mode {
                "mid" => Some((vah + val) / 2.0),
                "above" => Some(vah + 1.0),
                "below" => Some(val - 1.0),
                "above_high" => Some(pv.high.unwrap_or(vah) + 1.0),
                "below_low" => Some(pv.low.unwrap_or(val) - 1.0),
                _ => None,
            };
            let d = p.developing.as_mut().unwrap();
            d.lc = lc;
            d.lc_ny = if lc.is_none() { None } else { Some(d.lc_ny.clone().unwrap_or("11/13 16:15".into())) };
        }
        assert!((s.price - e["price"].as_f64().unwrap()).abs() < 1e-9, "{case}#{k}: harga");
        let full = serde_json::to_value(full_bias(&s, decimals_of(s.point), &ORDER)).unwrap();
        assert_eq!(full, e["full"], "{case}#{k}: full_bias berbeda");
        let msgs = build_messages(&s, &TgSettings::default(), &["Manual".to_string()]);
        let want: Vec<String> = e["msgs"].as_array().unwrap().iter().map(|m| m.as_str().unwrap().to_string()).collect();
        assert_eq!(msgs.len(), want.len(), "{case}#{k}: jumlah pesan");
        for (a, b) in msgs.iter().zip(&want) {
            if a != b {
                let (la, lb): (Vec<&str>, Vec<&str>) = (a.lines().collect(), b.lines().collect());
                let first = la.iter().zip(lb.iter()).enumerate().find(|(_, (x, y))| x != y);
                panic!("{case}#{k}: pesan berbeda. rust vs ts pada baris: {:?}", first);
            }
        }
        checked += 1;
    }
    println!("{checked} kombinasi identik");
}
