//! Tes golden: snapshot Rust harus identik dengan snapshot engine Python acuan (reference/python).
use mcdash_core::config;
use mcdash_core::{format_text, Bar, Bars, TpoEngine};
use serde_json::Value;
use std::collections::HashMap;

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * (1.0 + a.abs().max(b.abs()))
}

fn diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            for k in keys {
                let (va, vb) = (x.get(k).unwrap_or(&Value::Null), y.get(k).unwrap_or(&Value::Null)); // kunci hilang == null
                diff(&format!("{path}.{k}"), va, vb, out);
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{path}: panjang {} != {}", x.len(), y.len()));
                return;
            }
            for (i, (va, vb)) in x.iter().zip(y).enumerate() {
                diff(&format!("{path}[{i}]"), va, vb, out);
            }
        }
        (Value::Number(x), Value::Number(y)) => {
            if !close(x.as_f64().unwrap(), y.as_f64().unwrap()) {
                out.push(format!("{path}: {x} != {y}"));
            }
        }
        _ => {
            if a != b {
                out.push(format!("{path}: {a} != {b}"));
            }
        }
    }
}

fn run_case(name: &str) {
    let path = format!("{}/tests/golden/{}.json", env!("CARGO_MANIFEST_DIR"), name);
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    // engine Python acuan memakai first touch "satu bar"; paksa touch_letters=1 agar perbandingan tetap setara
    let mut conf = doc["config"].clone();
    for sec in ["daily", "sessional", "micro", "weekly"] {
        let o = conf.as_object_mut().unwrap().entry(sec).or_insert_with(|| serde_json::json!({}));
        o.as_object_mut().unwrap().insert("touch_letters".into(), serde_json::json!(1));
    }
    let cfg = config::parse(&conf).unwrap_or_else(|e| panic!("{name}: config ditolak: {e}"));
    let fixture_point = doc["point"].as_f64().unwrap();
    let point = if cfg.point > 0.0 { cfg.point } else { fixture_point };
    let mut bars: HashMap<i64, Bars> = HashMap::new();
    for (tf, rows) in doc["bars"].as_object().unwrap() {
        let mut m = Bars::new();
        for r in rows.as_array().unwrap() {
            let f = |i: usize| r[i].as_f64().unwrap();
            m.insert(r[0].as_i64().unwrap(), Bar { o: f(1), h: f(2), l: f(3), c: f(4), v: f(5) });
        }
        bars.insert(tf.parse().unwrap(), m);
    }
    let mut eng = TpoEngine::new(doc["symbol"].as_str().unwrap(), point, &cfg.timezone, cfg.profiles.clone(), cfg.atr_period, cfg.atr_feed_tf).unwrap();
    assert!(eng.ready(&bars), "{name}: bar belum lengkap");
    eng.rebuild(&bars).unwrap();
    let snap = eng.snapshot();
    let got = serde_json::to_value(&snap).unwrap();
    let mut d = vec![];
    diff("", &doc["expected"], &got, &mut d);
    assert!(d.is_empty(), "{name}: {} selisih snapshot, mis.:\n{}", d.len(), d.iter().take(12).cloned().collect::<Vec<_>>().join("\n"));
    let text = format_text(&snap);
    let want = doc["expected_text"].as_str().unwrap();
    if text != want {
        let (a, b): (Vec<&str>, Vec<&str>) = (want.lines().collect(), text.lines().collect());
        let first = a.iter().zip(b.iter()).enumerate().find(|(_, (x, y))| x != y);
        panic!("{name}: format_text berbeda. baris pertama yang beda: {:?}", first);
    }
}

#[test] fn xau_default() { run_case("xau_default"); }
#[test] fn jakarta_custom() { run_case("jakarta_custom"); }
#[test] fn btc_24x7() { run_case("btc_24x7"); }
#[test] fn dst_spring_gap() { run_case("dst_spring_gap"); }
#[test] fn dst_fall_ambiguous() { run_case("dst_fall_ambiguous"); }
#[test] fn fx_small_point() { run_case("fx_small_point"); }

/// config.json milik pengguna (format lama, tanpa bagian "source") harus tetap valid dan bermakna sama.
#[test]
fn config_lama_pengguna_tetap_valid() {
    let p = format!("{}/tests/golden/user_config.json", env!("CARGO_MANIFEST_DIR"));
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    let cfg = config::parse(&v).expect("config lama harus valid");
    assert_eq!(cfg.source.kind, config::SourceKind::TradingView, "tanpa 'source' = TradingView seperti sebelumnya");
    assert!(!cfg.profiles.is_empty());
    println!("{}", config::describe(&cfg));
}

/// Pengukuran waktu rebuild+snapshot dengan config lama pengguna (count 200) pada data golden.
#[test]
fn ukur_waktu_config_pengguna() {
    let dir = env!("CARGO_MANIFEST_DIR");
    let cfgv: Value = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/tests/golden/user_config.json")).unwrap()).unwrap();
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/tests/golden/xau_default.json")).unwrap()).unwrap();
    let cfg = config::parse(&cfgv).unwrap();
    let mut bars: HashMap<i64, Bars> = HashMap::new();
    for (tf, rows) in doc["bars"].as_object().unwrap() {
        let mut m = Bars::new();
        for r in rows.as_array().unwrap() {
            let f = |i: usize| r[i].as_f64().unwrap();
            m.insert(r[0].as_i64().unwrap(), Bar { o: f(1), h: f(2), l: f(3), c: f(4), v: f(5) });
        }
        bars.insert(tf.parse().unwrap(), m);
    }
    let mut eng = TpoEngine::new("X", 0.001, &cfg.timezone, cfg.profiles.clone(), cfg.atr_period, cfg.atr_feed_tf).unwrap();
    let mut ts = vec![];
    for _ in 0..7 {
        let t0 = std::time::Instant::now();
        eng.rebuild(&bars).unwrap();
        let _ = serde_json::to_string(&eng.snapshot()).unwrap();
        ts.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    ts.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("RUST rebuild+snapshot+JSON (config pengguna): median {:.2} ms, min {:.2} ms", ts[3], ts[0]);
}
