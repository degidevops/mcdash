"""tpo_engine.py - Port engine MCSMPTPOv2.mq5 ke Python (tanpa gambar/panel/alert).

Yang dibawa dari indikator MQ5:
  - profil Daily / Sessional / Weekly (CPeriod / CProfile)
  - huruf TPO, POC (seri -> paling dekat tengah profil), Value Area 2-baris
  - tick otomatis dari range periode sebelumnya (meniru Pine)
  - status naked (first touch POC/VAH/VAL), nLevel terdekat, Open vs VA, last touch
Perubahan utama: batas hari/minggu/sesi dihitung di zona waktu IANA
(default America/New_York, mulai 18:00), bukan jam server broker.
Belum dibawa: naked sebagai zona, alert (tahap berikutnya).
"""
from __future__ import annotations

import bisect
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

MAX_ROWS = 20000


def _round(x: float) -> float:
    """MathRound MQL5: setengah menjauhi nol (round() Python = banker's)."""
    return math.floor(x + 0.5) if x >= 0 else -math.floor(-x + 0.5)


# ---------------------------------------------------------------- waktu
class Calendar:
    """Batas periode di zona waktu IANA (DST ditangani zoneinfo)."""

    def __init__(self, tz="America/New_York", start_h=18, start_m=0,
                 week_start=6, sess_hours=6, parts=4):
        self.tz = ZoneInfo(tz)
        self.h, self.m = start_h, start_m
        self.week_start = week_start      # weekday() Python: Senin=0 ... Minggu=6
        self.sess_hours = sess_hours
        self.parts = parts                # micro = sesi dibagi 'parts'

    def _day_start(self, t: int) -> datetime:
        dt = datetime.fromtimestamp(t, self.tz)
        ds = dt.replace(hour=self.h, minute=self.m, second=0, microsecond=0)
        if ds > dt:
            ds -= timedelta(days=1)       # aritmatika jam dinding (bukan 24 jam tetap)
        return ds

    def bounds(self, mode: str, t: int) -> tuple[int, int]:
        ds = self._day_start(t)
        if mode == "weekly":
            ws = ds - timedelta(days=(ds.weekday() - self.week_start) % 7)
            return int(ws.timestamp()), int((ws + timedelta(days=7)).timestamp()) - 1
        s0 = int(ds.timestamp())
        de = int((ds + timedelta(days=1)).timestamp())
        if mode == "daily":
            return s0, de - 1
        # session: blok sess_hours dari awal hari; micro: sesi dibagi 'parts'; dipotong akhir hari
        sl = self.sess_hours * 3600 if mode == "session" else self.sess_hours * 3600 // self.parts
        s = s0 + ((t - s0) // sl) * sl
        return s, min(s + sl, de) - 1

    def fmt(self, ts: int, with_year=False) -> str:
        return datetime.fromtimestamp(ts, self.tz).strftime("%Y-%m-%d %H:%M" if with_year else "%m/%d %H:%M")


# ---------------------------------------------------------------- data
class Series:
    """Bar OHLC terurut naik. t = waktu buka bar (epoch UTC, detik)."""

    def __init__(self, tf_min: int, bars: dict):
        self.tf_min = tf_min
        ts = sorted(bars)
        self.t = ts
        self.o = [bars[k][0] for k in ts]
        self.h = [bars[k][1] for k in ts]
        self.l = [bars[k][2] for k in ts]
        self.c = [bars[k][3] for k in ts]

    def __len__(self):
        return len(self.t)

    def lower_bound(self, t: int) -> int:
        return bisect.bisect_left(self.t, t)

    def atr(self, n=14) -> float:
        """ATR gaya MT5 (SMA dari True Range, bar berjalan ikut)."""
        if len(self.t) < 2:
            return 0.0
        trs = []
        for i in range(max(1, len(self.t) - n), len(self.t)):
            pc = self.c[i - 1]
            trs.append(max(self.h[i] - self.l[i], abs(self.h[i] - pc), abs(self.l[i] - pc)))
        return sum(trs) / len(trs)


# ---------------------------------------------------------------- periode
class Period:
    def __init__(self, start: int, end: int):
        self.start, self.end = start, end
        self.tick = 0.0
        self.lh: list[float] = []
        self.ll: list[float] = []
        self.cur_bucket = -1
        self.d_high, self.d_low = -math.inf, math.inf
        self.min_bin, self.n_bins, self.cnt = 0, 0, []
        self.valid = False
        self.poc = self.vah = self.val = 0.0
        self.completed = False
        self.open_p, self.has_open = 0.0, False
        self.close_p = None            # close bar terakhir periode (= harga berjalan bila periode belum selesai)
        self.lc, self.lc_t = None, None  # close huruf TPO terakhir yang SUDAH SELESAI + waktu selesainya (epoch)
        self.touch = {"POC": None, "VAH": None, "VAL": None}   # (waktu, arah) atau None

    def level(self, kind: str) -> float:
        return {"POC": self.poc, "VAH": self.vah, "VAL": self.val}[kind]

    def add_bar(self, t, o, h, l, letter_sec, c=None):
        prev_c = self.close_p
        if c is not None:
            self.close_p = c
        if not self.has_open:
            self.open_p, self.has_open = o, True
        self.d_high = max(self.d_high, h)
        self.d_low = min(self.d_low, l)
        b = (t - self.start) // letter_sec
        if not self.lh or b != self.cur_bucket:
            if self.lh and prev_c is not None:     # huruf sebelumnya baru saja selesai -> close-nya
                self.lc, self.lc_t = prev_c, self.start + (self.cur_bucket + 1) * letter_sec
            self.lh.append(h)
            self.ll.append(l)
            self.cur_bucket = b
        else:
            self.lh[-1] = max(self.lh[-1], h)
            self.ll[-1] = min(self.ll[-1], l)

    def compute(self, va_pct: float, auto_rows: int, point: float):
        self.valid = False
        self.n_bins = 0
        if not self.lh:
            return
        if self.tick <= 0.0:
            rng = max(0.0, self.d_high - self.d_low)
            self.tick = max(point, _round(rng / auto_rows / point) * point)

        for _ in range(30):                       # tick dilipat dua bila baris > MAX_ROWS
            a = [math.ceil(x / self.tick - 0.5 - 1e-7) for x in self.ll]
            b = [math.floor(x / self.tick + 0.5 + 1e-7) for x in self.lh]
            mn, mx = min(a), max(b)
            if mx - mn + 1 <= MAX_ROWS:
                break
            self.tick *= 2.0
        span = mx - mn + 1
        if span < 1 or span > MAX_ROWS:
            return

        diff = [0] * (span + 1)
        for ai, bi in zip(a, b):
            diff[ai - mn] += 1
            diff[bi - mn + 1] -= 1
        cnt, run = [], 0
        for k in range(span):
            run += diff[k]
            cnt.append(run)
        self.cnt, self.min_bin, self.n_bins = cnt, mn, span
        n = span

        # POC: TPO terbanyak; seri -> paling dekat tengah profil (yang pertama bila sama dekat)
        max_c = max(cnt)
        mid, best, poc_i = (n - 1) / 2.0, 1e10, 0
        for i in range(n):
            if cnt[i] == max_c:
                dd = abs(i - mid)
                if dd < best:
                    best, poc_i = dd, i

        # Value Area: bandingkan 2 baris atas vs 2 baris bawah, ambil yang lebih besar
        total = sum(cnt)
        target = math.ceil(total * (va_pct / 100.0))
        up = dn = poc_i
        cur_va = cnt[poc_i]
        while cur_va < target:
            up_rows = up_sum = 0
            if up < n - 1:
                up_sum, up_rows = cnt[up + 1], 1
                if up + 2 <= n - 1:
                    up_sum += cnt[up + 2]
                    up_rows = 2
            dn_rows = dn_sum = 0
            if dn > 0:
                dn_sum, dn_rows = cnt[dn - 1], 1
                if dn - 2 >= 0:
                    dn_sum += cnt[dn - 2]
                    dn_rows = 2
            if up_rows == 0 and dn_rows == 0:
                break
            if up_rows > 0 and up_sum >= dn_sum:
                up += up_rows
                cur_va += up_sum
            else:
                dn -= dn_rows
                cur_va += dn_sum

        half = self.tick / 2.0
        self.poc = (self.min_bin + poc_i) * self.tick
        self.vah = (self.min_bin + up) * self.tick + half
        self.val = (self.min_bin + dn) * self.tick - half
        self.valid = True


# ---------------------------------------------------------------- profil
FEED_TFS = (60, 30, 15, 5, 3, 1)   # timeframe TradingView yang dipakai untuk feed (menit)


def auto_feed_tf(tpo_min: int) -> int:
    """Timeframe feed terbesar yang habis membagi periode TPO (riwayat lebih jauh, hasil tetap persis)."""
    for tf in FEED_TFS:
        if tpo_min % tf == 0:
            return tf
    return 1


@dataclass
class ProfileCfg:
    mode: str              # "daily" | "session" | "micro" | "weekly"
    tag: str               # D / S / W
    tpo_min: int           # periode huruf TPO (menit)
    count: int             # jumlah periode selesai yang dipertahankan
    feed_tf: int = 0       # 0 = otomatis (auto_feed_tf); atau paksa mis. 5
    start_h: int = 18      # jam mulai hari (zona waktu IANA)
    start_m: int = 0
    week_start: int = 6    # hari mulai minggu, weekday() Python: Senin=0 ... Minggu=6
    sess_hours: int = 6    # panjang sesi (jam), hanya mode session
    va_pct: float = 70.0
    ticks: int = 0         # 0 = otomatis
    rows: int = 80         # target baris untuk tick otomatis
    parts: int = 4         # hanya mode micro: satu sesi dibagi berapa bagian

    def resolve_feed_tf(self) -> int:
        if not self.feed_tf:
            return auto_feed_tf(self.tpo_min)
        if self.tpo_min % self.feed_tf:
            raise ValueError(f"profil {self.tag}: feed_tf={self.feed_tf} harus habis membagi tpo_min={self.tpo_min}")
        return self.feed_tf


class Profile:
    def __init__(self, cfg: ProfileCfg, tz: str, ser: Series, point: float):
        self.cfg, self.ser, self.point = cfg, ser, point
        self.cal = Calendar(tz, cfg.start_h, cfg.start_m, cfg.week_start, cfg.sess_hours, cfg.parts)
        self.items: list[Period] = []
        self.cur: Period | None = None

    def dur(self) -> int:
        return {"weekly": 604800, "session": self.cfg.sess_hours * 3600,
                "micro": self.cfg.sess_hours * 3600 // self.cfg.parts, "daily": 86400}[self.cfg.mode]

    def _first_ps(self, last_t: int) -> int:
        mult = 1.1 if self.cfg.mode == "weekly" else 1.5
        look = int((self.cfg.count + 1) * self.dur() * mult) + 2 * 86400
        return self.cal.bounds(self.cfg.mode, last_t - look)[0]

    def _initial_tick(self, ps: int) -> float:
        """Tick otomatis dari range bar sebelum periode mulai (setara lb bar M1 di MQ5)."""
        if self.cfg.ticks > 0:
            return self.cfg.ticks * self.point
        lb_min = max(20, min(self.dur() // 60, 20000))
        lb = max(2, round(lb_min / self.ser.tf_min))
        i1 = self.ser.lower_bound(ps)
        i0 = max(0, i1 - lb)
        if i1 - i0 < 2:
            return 0.0
        hi, lo = max(self.ser.h[i0:i1]), min(self.ser.l[i0:i1])
        if hi <= lo:
            return 0.0
        return max(self.point, _round((hi - lo) / self.cfg.rows / self.point) * self.point)

    def build(self):
        self.items, self.cur = [], None
        s = self.ser
        if len(s) == 0:
            return
        i0 = s.lower_bound(self._first_ps(s.t[-1]))
        letter_sec = self.cfg.tpo_min * 60
        for i in range(i0, len(s)):
            bt = s.t[i]
            if self.cur is None or bt < self.cur.start or bt > self.cur.end:
                if self.cur is not None:
                    self._finalize(self.cur)
                ps, pe = self.cal.bounds(self.cfg.mode, bt)
                self.cur = Period(ps, pe)
                self.cur.tick = self._initial_tick(ps)
            self.cur.add_bar(bt, s.o[i], s.h[i], s.l[i], letter_sec, s.c[i])
        if self.cur is not None:
            self.cur.compute(self.cfg.va_pct, self.cfg.rows, self.point)
        for p in self.items:
            self._scan_touch(p)

    def _finalize(self, p: Period):
        p.compute(self.cfg.va_pct, self.cfg.rows, self.point)
        p.completed = True
        self.items.append(p)
        del self.items[:-self.cfg.count]

    def _scan_touch(self, p: Period):
        """First touch POC/VAH/VAL oleh bar setelah periode selesai (mode Line)."""
        if not p.valid:
            return
        s = self.ser
        i = s.lower_bound(p.end + 1)
        while i < len(s) and not all(p.touch.values()):
            h, l, t = s.h[i], s.l[i], s.t[i]
            pc = s.c[i - 1] if i > 0 else s.o[i]
            for kind in ("POC", "VAH", "VAL"):
                lv = p.level(kind)
                if p.touch[kind] is None and h >= lv >= l:
                    p.touch[kind] = (t, 1 if pc < lv else -1)
            i += 1

    # ---- konteks
    def name(self, idx: int) -> str:
        return f"{self.cfg.tag}-{len(self.items) - idx}"

    def naked_levels(self):
        out = []
        for i, p in enumerate(self.items):
            if not p.valid:
                continue
            for kind in ("POC", "VAH", "VAL"):
                if p.touch[kind] is None:
                    out.append({"name": f"n{kind} {self.name(i)}", "price": p.level(kind)})
        return out

    def open_vs_va(self):
        if not self.items or self.cur is None or not self.cur.has_open:
            return {"state": "n/a"}
        pv = self.items[-1]
        if not pv.valid:
            return {"state": "n/a"}
        o = self.cur.open_p
        if o > pv.vah:
            return {"state": "Above VAH", "dist": o - pv.vah}
        if o < pv.val:
            return {"state": "Below VAL", "dist": pv.val - o}
        return {"state": "Inside VA", "poc_side": "atas" if o >= pv.poc else "bawah"}

    def last_touch(self):
        best = None
        for i, p in enumerate(self.items):
            for kind in ("POC", "VAH", "VAL"):
                tc = p.touch[kind]
                if tc and (best is None or tc[0] >= best["t"]):
                    best = {"name": f"n{kind} {self.name(i)}", "t": tc[0],
                            "dir": "bawah" if tc[1] > 0 else "atas"}
        return best


# ---------------------------------------------------------------- engine
DAYS_ID = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]


def default_profiles() -> dict[str, ProfileCfg]:
    return {
        "D": ProfileCfg("daily", "D", tpo_min=15, count=5),
        "S": ProfileCfg("session", "S", tpo_min=10, count=8),
        "M": ProfileCfg("micro", "M", tpo_min=10, count=8),
        "W": ProfileCfg("weekly", "W", tpo_min=15, count=4),
    }


class TPOEngine:
    def __init__(self, symbol: str, point: float, tz="America/New_York",
                 profiles: dict[str, ProfileCfg] | None = None,
                 atr_period=14, atr_feed_tf=0):
        self.symbol, self.point, self.tz = symbol, point, tz
        self.cal = Calendar(tz)                # hanya untuk format waktu
        self.cfgs = profiles or default_profiles()
        self.feed_tf = {tag: c.resolve_feed_tf() for tag, c in self.cfgs.items()}
        self.atr_period, self.atr_feed_tf = atr_period, atr_feed_tf
        self.bars: dict[int, dict] = {}        # tf_min -> {ts: (o,h,l,c,v)} (rujukan ke feed.bars)
        self.profiles: dict[str, Profile] = {}
        self.price = self.atr = 0.0
        self.asof = 0

    def needed_tfs(self) -> list[int]:
        return sorted(set(self.feed_tf.values()), reverse=True)

    def set_bars(self, tf_min: int, bars: dict):
        self.bars[tf_min] = bars

    def ready(self) -> bool:
        return all(self.bars.get(tf) for tf in self.needed_tfs())

    def rebuild(self):
        series = {tf: Series(tf, b) for tf, b in self.bars.items() if b}
        self.profiles = {}
        for tag, cfg in self.cfgs.items():
            ser = series.get(self.feed_tf[tag])
            if ser is not None:
                pf = Profile(cfg, self.tz, ser, self.point)
                pf.build()
                self.profiles[tag] = pf
        fine = series[min(series)]
        self.price, self.asof = fine.c[-1], fine.t[-1]
        ref = series.get(self.atr_feed_tf) or series.get(15) or fine
        self.atr = ref.atr(self.atr_period)

    # ---- keluaran
    def _period_dict(self, p: Period, name: str) -> dict:
        cal = self.cal
        d = {"name": name, "start": p.start, "end": p.end,
             "start_ny": cal.fmt(p.start), "end_ny": cal.fmt(p.end + 1),
             "valid": p.valid, "letters": len(p.lh), "tick": p.tick,
             "high": p.d_high if p.lh else None, "low": p.d_low if p.lh else None,
             "open": p.open_p if p.has_open else None,
             "close": p.close_p}
        if p.valid:
            d.update(poc=p.poc, vah=p.vah, val=p.val)
        d["touch"] = {}
        for kind, tc in p.touch.items():
            d["touch"][kind] = None if tc is None else {
                "t": tc[0], "t_ny": cal.fmt(tc[0]), "dir": "bawah" if tc[1] > 0 else "atas"}
        return d

    def _dev_dict(self, p: Period, tag: str) -> dict:
        d = self._period_dict(p, f"{tag}-now")
        d["lc"] = p.lc                                   # close huruf TPO terakhir yang sudah selesai
        d["lc_ny"] = self.cal.fmt(p.lc_t) if p.lc_t else None
        return d

    def snapshot(self) -> dict:
        price, pt = self.price, self.point
        naked, ctx_open, last, profs = [], {}, {}, {}
        for tag, pf in self.profiles.items():
            c = pf.cfg
            profs[tag] = {
                "tag": tag, "mode": c.mode, "tpo_min": c.tpo_min, "tf_min": pf.ser.tf_min,
                "settings": {"count": c.count, "start": f"{c.start_h:02d}:{c.start_m:02d}",
                             "week_start": DAYS_ID[c.week_start] if c.mode == "weekly" else None,
                             "session_hours": c.sess_hours if c.mode == "session" else None,
                             "micro_min": c.sess_hours * 60 // c.parts if c.mode == "micro" else None,
                             "va_pct": c.va_pct, "ticks": c.ticks, "rows": c.rows},
                "items": [self._period_dict(p, pf.name(i)) for i, p in enumerate(pf.items)],
                "developing": self._dev_dict(pf.cur, tag) if pf.cur else None,
            }
            naked += pf.naked_levels()
            ctx_open[tag] = pf.open_vs_va()
            lt = pf.last_touch()
            if lt:
                lt["t_ny"] = self.cal.fmt(lt["t"])
            last[tag] = lt
        up = min((n for n in naked if n["price"] > price), key=lambda n: n["price"] - price, default=None)
        dn = min((n for n in naked if n["price"] < price), key=lambda n: price - n["price"], default=None)
        return {
            "symbol": self.symbol, "tz": self.tz, "point": pt, "price": price,
            "asof": self.asof, "asof_ny": self.cal.fmt(self.asof, with_year=True),
            "atr": self.atr, "profiles": profs,
            "context": {"naked_count": len(naked), "open_vs_va": ctx_open,
                        "n_up": up and {**up, "dist": up["price"] - price},
                        "n_down": dn and {**dn, "dist": price - dn["price"]},
                        "last_touch": last},
        }


# ---------------------------------------------------------------- teks
def format_text(s: dict) -> str:
    pt = s["point"]
    dec = next((n for n in range(9) if abs(pt * 10 ** n - round(pt * 10 ** n)) < 1e-9), 8) if pt > 0 else 2
    dist = lambda d: f"{d / pt:,.0f}pt ({d:.{dec}f})"
    f = lambda x: "-" if x is None else f"{x:.{dec}f}"
    tags = [t for t in ("W", "D", "S", "M") if t in s["profiles"]]
    L = [f"=== {s['symbol']} | {s['asof_ny']} {s['tz']} | harga {s['price']:.{dec}f} "
         f"| ATR {s['atr']:.{dec}f} | point {pt} ==="]
    c = s["context"]
    L.append(f"[Context] naked {c['naked_count']} level")
    for tag in ("D", "S", "M", "W"):
        o = c["open_vs_va"].get(tag)
        if not o:
            continue
        txt = o["state"]
        if "dist" in o:
            txt += f" {dist(o['dist'])}"
        if "poc_side" in o:
            txt += f" ({o['poc_side']} POC)"
        L.append(f"  Open {tag} vs VA : {txt}")
    for key, arrow in (("n_up", "▲"), ("n_down", "▼")):
        n = c[key]
        L.append(f"  nLevel {arrow}      : " + (f"{n['name']}  {n['price']:.{dec}f}  ({dist(n['dist'])})" if n else "-"))
    for tag in tags:
        lt = c["last_touch"].get(tag)
        L.append(f"  Last touch {tag}  : " + (f"{lt['name']} | dari {lt['dir']} | {lt['t_ny']}" if lt else "-"))
    names = {"W": "Weekly", "D": "Daily", "S": "Sessional", "M": "Micro"}
    for tag in tags:
        pf = s["profiles"][tag]
        st = pf["settings"]
        extra = f", minggu mulai {st['week_start']}" if st["week_start"] else (f", sesi {st['session_hours']} jam" if st["session_hours"] else (f", micro {st['micro_min']} menit" if st["micro_min"] else ""))
        L.append(f"\n[{names[tag]}] TPO {pf['tpo_min']}m | feed M{pf['tf_min']} | hari mulai {st['start']}{extra} | "
                 f"VA {st['va_pct']:g}% | tick {'auto' if not st['ticks'] else st['ticks']} (rows {st['rows']}) | {st['count']} periode")
        rows = pf["items"] + ([pf["developing"]] if pf["developing"] else [])
        for p in rows:
            if not p.get("valid"):
                L.append(f"  {p['name']:<5} {p['start_ny']} -> {p['end_ny']}  (tidak valid)")
                continue
            nk = " ".join(f"{k}{'✔' if p['touch'][k] else '○'}" for k in ("POC", "VAH", "VAL")) \
                if p["name"] != f"{tag}-now" else "developing"
            L.append(f"  {p['name']:<5} {p['start_ny']} -> {p['end_ny']} | "
                     f"POC {f(p['poc'])}  VAH {f(p['vah'])}  VAL {f(p['val'])} | "
                     f"H {f(p['high'])} L {f(p['low'])} tick {p['tick']:g} | {nk}")
    return "\n".join(L)
