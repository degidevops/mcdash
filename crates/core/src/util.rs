//! Fungsi kecil yang meniru perilaku Python/MQL5/JS agar hasil identik dengan engine acuan.

/// MathRound MQL5: setengah menjauhi nol (bukan pembulatan banker).
pub fn mql_round(x: f64) -> f64 {
    if x >= 0.0 { (x + 0.5).floor() } else { -((-x + 0.5).floor()) }
}

/// round() Python 3: setengah ke genap.
pub fn py_round(x: f64) -> i64 {
    x.round_ties_even() as i64
}

/// Jumlah desimal harga dari ukuran point (0.001 -> 3). Sama dengan decimalsOf() di sisi TS.
pub fn decimals_of(point: f64) -> usize {
    if !(point > 0.0) {
        return 2;
    }
    for n in 0..=8 {
        let scaled = point * 10f64.powi(n);
        if (scaled - scaled.round()).abs() < 1e-9 {
            return n as usize;
        }
    }
    8
}

/// Setara Number.prototype.toFixed di JS: tie persis dibulatkan menjauhi nol (Rust membulatkan tie ke genap).
pub fn to_fixed(x: f64, dec: usize) -> String {
    if !x.is_finite() {
        return "NaN".into();
    }
    let x = if x == 0.0 { 0.0 } else { x };
    let exact = format!("{:.*}", dec + 60, x.abs()); // ekspansi desimal eksak (cukup panjang)
    let (ip, fp) = exact.split_once('.').unwrap_or((exact.as_str(), ""));
    let (keep, rest) = fp.split_at(dec.min(fp.len()));
    let tie = rest.starts_with('5') && rest[1..].bytes().all(|b| b == b'0');
    if !tie {
        return format!("{:.*}", dec, x);
    }
    let mut digits: Vec<u8> = format!("{}{}", ip, keep).into_bytes();
    let mut i = digits.len();
    let mut carry = true;
    while carry && i > 0 {
        i -= 1;
        if digits[i] == b'9' {
            digits[i] = b'0';
        } else {
            digits[i] += 1;
            carry = false;
        }
    }
    let mut s = String::from_utf8(digits).unwrap();
    if carry {
        s.insert(0, '1');
    }
    let int_len = s.len() - dec;
    let body = if dec > 0 { format!("{}.{}", &s[..int_len], &s[int_len..]) } else { s };
    if x < 0.0 { format!("-{}", body) } else { body }
}

/// Seperti Python format spec `:g` (6 digit signifikan, buang nol di belakang).
pub fn fmt_g(x: f64) -> String {
    if x == 0.0 {
        return "0".into();
    }
    let exp = x.abs().log10().floor() as i32;
    if exp < -4 || exp >= 6 {
        let s = format!("{:.5e}", x);
        let (m, e) = s.split_once('e').unwrap();
        let m = if m.contains('.') { m.trim_end_matches('0').trim_end_matches('.') } else { m };
        let ev: i32 = e.parse().unwrap();
        return format!("{}e{}{:02}", m, if ev < 0 { '-' } else { '+' }, ev.abs());
    }
    let decimals = (5 - exp).max(0) as usize;
    let s = format!("{:.*}", decimals, x);
    if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.').to_string() } else { s }
}

/// Ribuan dengan koma, tanpa desimal (Python `f"{x:,.0f}"`).
pub fn fmt_thousands0(x: f64) -> String {
    let s = format!("{:.0}", x.abs());
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    if x < 0.0 { format!("-{}", out) } else { out }
}

/// Format desimal gaya Python (`f"{x:.3f}"`): tie persis dibulatkan ke genap, sama dengan format! Rust.
pub fn fmt_f(x: f64, dec: usize) -> String {
    format!("{:.*}", dec, x)
}
