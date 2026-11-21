//! Bar OHLC dan deret terurut.
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bar {
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub v: f64,
}

/// ts (epoch UTC detik, waktu buka bar) -> bar
pub type Bars = BTreeMap<i64, Bar>;

pub struct Series {
    pub tf_min: i64,
    pub t: Vec<i64>,
    pub o: Vec<f64>,
    pub h: Vec<f64>,
    pub l: Vec<f64>,
    pub c: Vec<f64>,
}

impl Series {
    pub fn new(tf_min: i64, bars: &Bars) -> Series {
        let n = bars.len();
        let mut s = Series { tf_min, t: Vec::with_capacity(n), o: Vec::with_capacity(n), h: Vec::with_capacity(n), l: Vec::with_capacity(n), c: Vec::with_capacity(n) };
        for (k, b) in bars {
            s.t.push(*k);
            s.o.push(b.o);
            s.h.push(b.h);
            s.l.push(b.l);
            s.c.push(b.c);
        }
        s
    }
    pub fn len(&self) -> usize {
        self.t.len()
    }
    pub fn is_empty(&self) -> bool {
        self.t.is_empty()
    }
    /// indeks pertama dengan t >= x (bisect_left)
    pub fn lower_bound(&self, x: i64) -> usize {
        self.t.partition_point(|&v| v < x)
    }
    /// ATR gaya MT5: SMA True Range, bar berjalan ikut.
    pub fn atr(&self, n: usize) -> f64 {
        if self.t.len() < 2 {
            return 0.0;
        }
        let mut sum = 0.0;
        let mut cnt = 0usize;
        let from = std::cmp::max(1, self.t.len().saturating_sub(n));
        for i in from..self.t.len() {
            let pc = self.c[i - 1];
            let tr = (self.h[i] - self.l[i]).max((self.h[i] - pc).abs()).max((self.l[i] - pc).abs());
            sum += tr;
            cnt += 1;
        }
        sum / cnt as f64
    }
}
