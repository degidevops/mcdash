"""mcconfig.py - Pengaturan parameter TPO lewat file config.json (setara input indikator MQ5).

  python mcdash.py --init-config     # membuat config.json berisi nilai default
  (edit config.json, lalu jalankan lagi python mcdash.py)

Kunci yang salah ketik akan ditolak dengan pesan jelas, jadi pengaturan tidak diam-diam diabaikan.
"""
import json
import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from tpo_engine import DAYS_ID, ProfileCfg

DAY_NAMES = {n.lower(): i for i, n in enumerate(
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])}
DAY_NAMES.update({n.lower(): i for i, n in enumerate(DAYS_ID)})

DEFAULTS = {
    "general": {
        "symbol": "OANDA:XAUUSD",
        "timezone": "America/New_York",
        "point": 0,
        "history_bars": 20000,
        "atr_period": 14,
        "atr_feed_tf": 0,
    },
    "daily": {
        "enable": True, "tpo_min": 15, "count": 5, "start_hour": 18, "start_minute": 0,
        "va_pct": 70, "ticks": 0, "rows": 80, "feed_tf": 0,
    },
    "sessional": {
        "enable": True, "tpo_min": 10, "count": 8, "session_hours": 6,
        "start_hour": 18, "start_minute": 0, "va_pct": 70, "ticks": 0, "rows": 80, "feed_tf": 0,
    },
    "micro": {
        "enable": True, "tpo_min": 10, "count": 8, "parts": 4,
        "va_pct": 70, "ticks": 0, "rows": 80, "feed_tf": 0,
    },
    "weekly": {
        "enable": True, "tpo_min": 15, "count": 4, "week_start_day": "sunday",
        "start_hour": 18, "start_minute": 0, "va_pct": 70, "ticks": 0, "rows": 80, "feed_tf": 0,
    },
}

HELP = {
    "timezone": "Zona waktu IANA untuk semua batas hari/minggu/sesi, mis. America/New_York, Europe/London, Asia/Jakarta.",
    "point": "Ukuran 1 point. 0 = otomatis mengikuti info simbol TradingView (OANDA XAUUSD memberi 0.001, jadi jarak 'pt' 10x lebih besar daripada broker MT5 dengan point 0.01). Isi manual bila ingin sama dengan MT5.",
    "history_bars": "Target jumlah bar riwayat per timeframe (akun anonim dibatasi oleh TradingView).",
    "atr_feed_tf": "Timeframe untuk ATR (menit). 0 = otomatis (M15 bila ada).",
    "enable": "true/false: aktifkan profil ini.",
    "tpo_min": "Periode satu huruf TPO, menit (mis. 10, 15, 30, 60).",
    "count": "Jumlah periode (hari/sesi/minggu) selesai yang ditampilkan.",
    "start_hour/start_minute": "Jam mulai hari di zona 'timezone'. Dipakai juga sebagai awal minggu dan awal sesi.",
    "session_hours": "Panjang satu sesi dalam jam (blok dihitung dari jam mulai hari).",
    "week_start_day": "Hari mulai minggu: sunday, monday, ... (atau minggu, senin, ...).",
    "parts": "Khusus micro: satu sesi dibagi berapa bagian (6 jam / 4 = 90 menit). Jam mulai dan panjang sesi mengikuti bagian sessional.",
    "va_pct": "Persentase Value Area (mis. 70).",
    "ticks": "Harga per baris dalam point. 0 = otomatis dari range periode sebelumnya.",
    "rows": "Target jumlah baris untuk tick otomatis (10-300).",
    "feed_tf": "Timeframe feed (menit). 0 = otomatis (terbesar yang habis membagi tpo_min, riwayat terjauh). "
               "Boleh dipaksa lebih kecil (mis. 5) selama habis membagi tpo_min; hasilnya sama, riwayat lebih pendek.",
}

TAGS = {"daily": ("D", "daily"), "sessional": ("S", "session"), "micro": ("M", "micro"), "weekly": ("W", "weekly")}


@dataclass
class Config:
    symbol: str
    timezone: str
    point: float
    history_bars: int
    atr_period: int
    atr_feed_tf: int
    profiles: dict


def default_dict() -> dict:
    d = json.loads(json.dumps(DEFAULTS))
    d["_help"] = HELP
    return d


def write_default(path: str):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(default_dict(), f, ensure_ascii=False, indent=2)


def _merge(user: dict) -> dict:
    out = {}
    for sec, dflt in DEFAULTS.items():
        u = user.get(sec, {})
        if not isinstance(u, dict):
            raise ValueError(f"config: bagian '{sec}' harus berupa objek {{...}}")
        bad = [k for k in u if k not in dflt and not k.startswith("_")]
        if bad:
            raise ValueError(f"config: kunci tidak dikenal di '{sec}': {bad}. Kunci yang valid: {list(dflt)}")
        out[sec] = {**dflt, **{k: v for k, v in u.items() if not k.startswith("_")}}
    bad = [k for k in user if k not in DEFAULTS and not k.startswith("_")]
    if bad:
        raise ValueError(f"config: bagian tidak dikenal: {bad}. Yang valid: {list(DEFAULTS)}")
    return out


def _num(sec, key, v, lo, hi, integer=True):
    try:
        v = int(v) if integer else float(v)
    except (TypeError, ValueError):
        raise ValueError(f"config: '{sec}.{key}' harus berupa angka (nilai: {v!r})")
    if not lo <= v <= hi:
        raise ValueError(f"config: '{sec}.{key}' harus {lo}-{hi} (nilai: {v})")
    return v


def parse(user: dict) -> Config:
    m = _merge(user)
    g = m["general"]
    try:
        ZoneInfo(g["timezone"])
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise ValueError(f"config: timezone '{g['timezone']}' bukan zona IANA yang dikenal "
                         f"(contoh: America/New_York). Di Windows jalankan: pip install tzdata")
    profiles = {}
    for sec, (tag, mode) in TAGS.items():
        c = m[sec]
        if not c["enable"]:
            continue
        wd = c.get("week_start_day", "sunday")
        if mode == "weekly":
            if str(wd).lower() not in DAY_NAMES:
                raise ValueError(f"config: '{sec}.week_start_day' tidak dikenal: {wd!r} (contoh: sunday, monday)")
            wd = DAY_NAMES[str(wd).lower()]
        else:
            wd = 6
        src, ssec = (m["sessional"], "sessional") if mode == "micro" else (c, sec)   # micro mewarisi sesi
        cfg = ProfileCfg(
            mode=mode, tag=tag,
            tpo_min=_num(sec, "tpo_min", c["tpo_min"], 1, 1440),
            count=_num(sec, "count", c["count"], 1, 200),
            feed_tf=_num(sec, "feed_tf", c["feed_tf"], 0, 1440),
            start_h=_num(ssec, "start_hour", src["start_hour"], 0, 23),
            start_m=_num(ssec, "start_minute", src["start_minute"], 0, 59),
            week_start=wd,
            sess_hours=_num(ssec, "session_hours", src.get("session_hours", 6), 1, 24),
            parts=_num(sec, "parts", c.get("parts", 4), 2, 24),
            va_pct=_num(sec, "va_pct", c["va_pct"], 1, 100, integer=False),
            ticks=_num(sec, "ticks", c["ticks"], 0, 100000),
            rows=_num(sec, "rows", c["rows"], 10, 300),
        )
        cfg.resolve_feed_tf()          # validasi feed_tf vs tpo_min
        if mode == "micro":
            if (cfg.sess_hours * 3600) % cfg.parts:
                raise ValueError(f"config: sessional.session_hours={cfg.sess_hours} tidak habis dibagi micro.parts={cfg.parts}")
            if cfg.sess_hours * 60 // cfg.parts < cfg.tpo_min:
                raise ValueError(f"config: micro.tpo_min={cfg.tpo_min} lebih besar dari panjang micro ({cfg.sess_hours * 60 // cfg.parts} menit)")
        profiles[tag] = cfg
    if not profiles:
        raise ValueError("config: minimal satu profil (daily/sessional/weekly) harus enable=true")
    return Config(
        symbol=str(g["symbol"]), timezone=g["timezone"],
        point=_num("general", "point", g["point"], 0, 1000, integer=False),
        history_bars=_num("general", "history_bars", g["history_bars"], 100, 200000),
        atr_period=_num("general", "atr_period", g["atr_period"], 1, 500),
        atr_feed_tf=_num("general", "atr_feed_tf", g["atr_feed_tf"], 0, 1440),
        profiles=profiles,
    )


def load(path: str) -> Config:
    """Baca config.json; bila belum ada, dibuat dari nilai default."""
    if not os.path.exists(path):
        write_default(path)
        print(f"[config] {path} belum ada -> dibuat dengan nilai default. Edit file ini untuk mengubah parameter.")
    with open(path, encoding="utf-8") as f:
        try:
            user = json.load(f)
        except json.JSONDecodeError as e:
            raise ValueError(f"config: {path} bukan JSON yang valid: {e}")
    return parse(user)


def describe(cfg: Config) -> str:
    names = {"D": "Daily", "S": "Sessional", "M": "Micro", "W": "Weekly"}
    L = [f"[config] {cfg.symbol} | zona {cfg.timezone} | point {cfg.point or 'auto'}"]
    for tag, c in cfg.profiles.items():
        extra = f" | sesi {c.sess_hours}j" if c.mode == "session" else (
            f" | micro {c.sess_hours * 60 // c.parts}m (sesi/{c.parts})" if c.mode == "micro" else (
            f" | minggu mulai {DAYS_ID[c.week_start]}" if c.mode == "weekly" else ""))
        L.append(f"  {names[tag]:<9} TPO {c.tpo_min}m | feed M{c.resolve_feed_tf()} | mulai {c.start_h:02d}:{c.start_m:02d}"
                 f"{extra} | {c.count} periode | VA {c.va_pct:g}% | tick {c.ticks or 'auto'} | rows {c.rows}")
    return "\n".join(L)
