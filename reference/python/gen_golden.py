"""Membuat kasus uji golden: engine Python (acuan) -> snapshot JSON yang harus identik dengan engine Rust.
   python gen_golden.py <folder_keluaran>
"""
import json, os, random, sys, zlib
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mcconfig
from tpo_engine import TPOEngine, format_text

NY = ZoneInfo("America/New_York")

def m1_series(start, end, price0, vol, closed=None, seed=1):
    """M1 random walk; closed(dt_ny)->True bila pasar tutup (celah akhir pekan)."""
    rnd = random.Random(seed)
    out, px, t = {}, price0, int(start.timestamp())
    end_t = int(end.timestamp())
    while t <= end_t:
        if closed is None or not closed(datetime.fromtimestamp(t, NY)):
            o = px
            c = o + rnd.gauss(0, vol)
            h = max(o, c) + abs(rnd.gauss(0, vol * .4))
            l = min(o, c) - abs(rnd.gauss(0, vol * .4))
            out[t] = (o, h, l, c, float(rnd.randint(1, 90)))
            px = c
        t += 60
    return out

def fx_closed(dt):   # Jumat 17:00 NY sampai Minggu 18:00 NY
    wd = dt.weekday()
    return (wd == 4 and dt.hour >= 17) or wd == 5 or (wd == 6 and dt.hour < 18)

def aggregate(m1, tf, last_n):
    sec, bars = tf * 60, {}
    for t, (o, h, l, c, v) in sorted(m1.items()):
        k = t - t % sec
        a = bars.get(k)
        bars[k] = (o, h, l, c, v) if a is None else (a[0], max(a[1], h), min(a[2], l), c, a[4] + v)
    keys = sorted(bars)[-last_n:]
    return {k: bars[k] for k in keys}

CASES = {
  "xau_default": dict(cfg={}, sym="OANDA:XAUUSD", point=0.001, p0=4040.0, vol=0.35, end=datetime(2026, 11, 13, 12, 7, tzinfo=NY), days=75, closed=fx_closed, n=6000),
  "jakarta_custom": dict(cfg={"general": {"timezone": "Asia/Jakarta"},
        "daily": {"tpo_min": 30, "count": 6, "start_hour": 7, "va_pct": 68.5, "rows": 120},
        "sessional": {"tpo_min": 20, "count": 6, "session_hours": 8, "start_hour": 7},
        "micro": {"tpo_min": 15, "parts": 4, "count": 6},
        "weekly": {"tpo_min": 30, "count": 3, "week_start_day": "monday", "start_hour": 7}},
        sym="MT5:XAUUSD", point=0.01, p0=4100.0, vol=0.5, end=datetime(2026, 10, 20, 9, 33, tzinfo=NY), days=70, closed=fx_closed, n=6000),
  "btc_24x7": dict(cfg={"general": {"timezone": "UTC", "atr_feed_tf": 5}, "daily": {"start_hour": 0, "ticks": 10, "tpo_min": 30},
        "sessional": {"start_hour": 0, "tpo_min": 15}, "micro": {"tpo_min": 5}, "weekly": {"start_hour": 0, "week_start_day": "monday"}},
        sym="BINANCE:BTCUSDT", point=0.1, p0=95000.0, vol=18.0, end=datetime(2026, 11, 12, 22, 41, tzinfo=NY), days=60, closed=None, n=6000),
  "dst_spring_gap": dict(cfg={"daily": {"start_hour": 2, "count": 5}, "sessional": {"start_hour": 2, "count": 5}, "weekly": {"start_hour": 2, "week_start_day": "sunday", "count": 3}},
        sym="OANDA:XAUUSD", point=0.001, p0=3900.0, vol=0.4, end=datetime(2026, 3, 12, 11, 2, tzinfo=NY), days=60, closed=fx_closed, n=6000),
  "dst_fall_ambiguous": dict(cfg={"daily": {"start_hour": 1, "count": 6}, "sessional": {"start_hour": 1, "count": 6}, "weekly": {"start_hour": 1, "count": 3}},
        sym="OANDA:XAUUSD", point=0.001, p0=4200.0, vol=0.4, end=datetime(2026, 11, 3, 15, 20, tzinfo=NY), days=60, closed=fx_closed, n=6000),
  "fx_small_point": dict(cfg={"general": {"timezone": "Europe/London"}, "daily": {"start_hour": 22, "rows": 40, "tpo_min": 60}, "sessional": {"tpo_min": 30, "session_hours": 12, "start_hour": 22},
        "micro": {"tpo_min": 30, "parts": 3}, "weekly": {"tpo_min": 60, "start_hour": 22, "va_pct": 80}},
        sym="OANDA:EURUSD", point=0.00001, p0=1.0850, vol=0.00012, end=datetime(2026, 9, 9, 16, 55, tzinfo=NY), days=80, closed=fx_closed, n=6000),
}

def main(out):
    os.makedirs(out, exist_ok=True)
    for name, c in CASES.items():
        cfg = mcconfig.parse(c["cfg"])
        m1 = m1_series(c["end"] - timedelta(days=c["days"]), c["end"], c["p0"], c["vol"], c["closed"], seed=zlib.crc32(name.encode()) % 1000)
        eng = TPOEngine(c["sym"], cfg.point or c["point"], cfg.timezone, cfg.profiles, cfg.atr_period, cfg.atr_feed_tf)
        needed = set(eng.needed_tfs()) | ({cfg.atr_feed_tf} if cfg.atr_feed_tf else set())
        bars = {tf: aggregate(m1, tf, c["n"]) for tf in sorted(needed)}
        for tf, b in bars.items():
            eng.set_bars(tf, b)
        eng.rebuild()
        snap = eng.snapshot()
        doc = {"name": name, "config": c["cfg"], "symbol": c["sym"], "point": c["point"],
               "bars": {str(tf): [[t, *b[t]] for t in sorted(b)] for tf, b in bars.items()},
               "expected": snap, "expected_text": format_text(snap)}
        with open(os.path.join(out, name + ".json"), "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        np_ = {t: (len(p["items"]), bool(p["developing"])) for t, p in snap["profiles"].items()}
        print(f"{name}: tf={sorted(bars)} bars={[len(b) for b in bars.values()]} profil(items,dev)={np_} naked={snap['context']['naked_count']}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "golden")
