//! Batas periode (hari/minggu/sesi) di zona waktu IANA. Meniru aritmatika "jam dinding" zoneinfo Python.
use chrono::{Datelike, Duration, LocalResult, NaiveDateTime, NaiveTime, Offset, TimeZone, Timelike};
use chrono_tz::Tz;

#[derive(Clone, Debug)]
pub struct Calendar {
    pub tz: Tz,
    h: u32,
    m: u32,
    week_start: i64, // Senin=0 ... Minggu=6
    sess_hours: i64,
    parts: i64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Daily,
    Session,
    Micro,
    Weekly,
}

impl Mode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::Daily => "daily",
            Mode::Session => "session",
            Mode::Micro => "micro",
            Mode::Weekly => "weekly",
        }
    }
}

impl Calendar {
    pub fn new(tz: &str, h: u32, m: u32, week_start: i64, sess_hours: i64, parts: i64) -> Result<Self, String> {
        let tz: Tz = tz.parse().map_err(|_| format!("zona waktu tidak dikenal: {tz}"))?;
        Ok(Calendar { tz, h, m, week_start, sess_hours, parts })
    }

    pub fn default_ny() -> Self {
        Calendar::new("America/New_York", 18, 0, 6, 6, 4).unwrap()
    }

    fn local(&self, t: i64) -> NaiveDateTime {
        self.tz.timestamp_opt(t, 0).single().map(|d| d.naive_local()).unwrap_or_else(|| {
            chrono::DateTime::from_timestamp(t, 0).unwrap().naive_utc()
        })
    }

    /// Waktu dinding lokal -> epoch. Ambigu: kemunculan pertama (fold=0); celah DST: offset sebelum transisi (seperti Python).
    fn to_ts(&self, n: NaiveDateTime) -> i64 {
        match self.tz.from_local_datetime(&n) {
            LocalResult::Single(d) => d.timestamp(),
            LocalResult::Ambiguous(a, _) => a.timestamp(),
            LocalResult::None => {
                let probe = n - Duration::hours(3);
                let off = match self.tz.from_local_datetime(&probe) {
                    LocalResult::Single(d) | LocalResult::Ambiguous(d, _) => d.offset().fix().local_minus_utc() as i64,
                    LocalResult::None => 0,
                };
                n.and_utc().timestamp() - off
            }
        }
    }

    fn day_start(&self, t: i64) -> NaiveDateTime {
        let dt = self.local(t);
        let mut ds = dt.date().and_time(NaiveTime::from_hms_opt(self.h, self.m, 0).unwrap());
        if ds > dt {
            ds -= Duration::days(1);
        }
        ds
    }

    /// (awal, akhir_inklusif) periode yang memuat waktu t.
    pub fn bounds(&self, mode: Mode, t: i64) -> (i64, i64) {
        let ds = self.day_start(t);
        if mode == Mode::Weekly {
            let wd = ds.date().weekday().num_days_from_monday() as i64;
            let ws = ds - Duration::days((wd - self.week_start).rem_euclid(7));
            return (self.to_ts(ws), self.to_ts(ws + Duration::days(7)) - 1);
        }
        let s0 = self.to_ts(ds);
        let de = self.to_ts(ds + Duration::days(1));
        if mode == Mode::Daily {
            return (s0, de - 1);
        }
        let sl = if mode == Mode::Session { self.sess_hours * 3600 } else { self.sess_hours * 3600 / self.parts };
        let s = s0 + (t - s0).div_euclid(sl) * sl;
        (s, (s + sl).min(de) - 1)
    }

    pub fn fmt(&self, ts: i64, with_year: bool) -> String {
        let d = self.local(ts);
        if with_year {
            format!("{:04}-{:02}-{:02} {:02}:{:02}", d.year(), d.month(), d.day(), d.hour(), d.minute())
        } else {
            format!("{:02}/{:02} {:02}:{:02}", d.month(), d.day(), d.hour(), d.minute())
        }
    }
}
