#!/usr/bin/env python3
"""tv_feed.py - Feed WebSocket TradingView (anonim, tanpa akun) - Tahap 1.

Tujuan: uji koneksi, tarik riwayat bar, terima update live, tampilkan waktu
dalam America/New_York. Modul ini sengaja dipisah supaya engine TPO nanti
hanya perlu callback on_history / on_live.

Install : pip install websockets tzdata
Jalankan: python tv_feed.py --symbol OANDA:XAUUSD --tf 1 --bars 20000
          python tv_feed.py --csv xauusd_m1.csv   (simpan riwayat ke CSV)

Catatan: protokol TradingView tidak resmi dan bisa berubah sewaktu-waktu.
"""
import argparse
import asyncio
import csv
import json
import random
import re
import string
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import websockets

WS_URL = "wss://data.tradingview.com/socket.io/websocket"
ORIGIN = "https://www.tradingview.com"
NY = ZoneInfo("America/New_York")
FRAME_RE = re.compile(r"~m~(\d+)~m~")
CHUNK = 5000  # bar per permintaan (batas umum akun anonim)
FATAL = ("critical_error", "protocol_error", "symbol_error", "series_error")


def rand_id(prefix, n=12):
    return prefix + "".join(random.choices(string.ascii_lowercase, k=n))


def frame(method, params):
    body = json.dumps({"m": method, "p": params}, separators=(",", ":"))
    return f"~m~{len(body)}~m~{body}"


def parse_frames(raw):
    """Pecah satu pesan WebSocket menjadi daftar payload."""
    out, pos = [], 0
    while pos < len(raw):
        m = FRAME_RE.match(raw, pos)
        if not m:
            break
        start = m.end()
        n = int(m.group(1))
        out.append(raw[start:start + n])
        pos = start + n
    return out


def fmt_ny(ts):
    return datetime.fromtimestamp(ts, NY).strftime("%Y-%m-%d %H:%M %Z")


class TVFeed:
    """bars: {ts_utc_detik: (open, high, low, close, volume)}"""

    def __init__(self, symbol, tf="1", bars=20000, on_history=None, on_live=None):
        self.symbol, self.tf, self.target = symbol, str(tf), bars
        self.on_history, self.on_live = on_history, on_live
        self.bars = {}
        self.history_done = False
        self._cs = None
        self._count_before = 0
        self._got_data = False
        self.point = None  # ukuran 1 point (minmov / pricescale) dari info simbol

    # ---------- koneksi ----------
    async def run(self):
        backoff = 1
        while True:
            try:
                await self._session()
            except (OSError, websockets.ConnectionClosed, asyncio.TimeoutError) as e:
                print(f"\n[feed] terputus ({type(e).__name__}), reconnect {backoff}s", file=sys.stderr)
            if self._got_data:
                backoff, self._got_data = 1, False
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

    async def _session(self):
        async with websockets.connect(WS_URL, origin=ORIGIN, max_size=None,
                                      ping_interval=None) as ws:
            self._cs = rand_id("cs_")
            send = lambda m, p: ws.send(frame(m, p))
            await send("set_auth_token", ["unauthorized_user_token"])
            await send("chart_create_session", [self._cs, ""])
            await send("switch_timezone", [self._cs, "Etc/UTC"])
            await send("resolve_symbol", [self._cs, "sds_sym_1", "=" + json.dumps(
                {"symbol": self.symbol, "adjustment": "splits"})])
            first = self.target if self.history_done else min(self.target, CHUNK)
            await send("create_series", [self._cs, "sds_1", "s1", "sds_sym_1", self.tf, first, ""])
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=60)
                for msg in parse_frames(raw):
                    await self._handle(ws, msg)

    # ---------- pesan ----------
    async def _handle(self, ws, msg):
        if msg.startswith("~h~"):  # heartbeat: balas persis sama
            await ws.send(f"~m~{len(msg)}~m~{msg}")
            return
        try:
            d = json.loads(msg)
        except ValueError:
            return
        m = d.get("m")
        if m in FATAL:
            raise RuntimeError(f"TradingView: {m} {d.get('p')}")
        if m in ("timescale_update", "du"):
            self._got_data = True
            series = d["p"][1].get("sds_1", {}).get("s", [])
            for it in series:
                v = it["v"]
                ts = int(v[0])
                bar = tuple(float(x) for x in v[1:6]) + (0.0,) * (5 - len(v[1:6]))
                is_new = ts not in self.bars
                self.bars[ts] = bar
                if self.history_done and self.on_live:
                    self.on_live(ts, bar, is_new)
        elif m == "symbol_resolved":
            info = d["p"][2]
            if info.get("pricescale"):
                self.point = float(info.get("minmov", 1)) / float(info["pricescale"])
        elif m == "series_completed" and not self.history_done:
            await self._after_chunk(ws)

    async def _after_chunk(self, ws):
        n = len(self.bars)
        grew = n > self._count_before
        if n < self.target and grew:  # minta riwayat lebih lama
            self._count_before = n
            await ws.send(frame("request_more_data", [self._cs, "sds_1", CHUNK]))
            return
        self.history_done = True
        if self.on_history:
            self.on_history(self.bars)


# ---------- demo ----------
def show_history(bars):
    ts = sorted(bars)
    print(f"[history] {len(ts)} bar | {fmt_ny(ts[0])}  ->  {fmt_ny(ts[-1])}")
    gaps = [(ts[i], ts[i + 1]) for i in range(len(ts) - 1) if ts[i + 1] - ts[i] > 1800]
    print("[history] 5 jeda terakhir > 30 menit (cek batas 17:00-18:00 NY & weekend):")
    for a, b in gaps[-5:]:
        print(f"   {fmt_ny(a)}  ->  {fmt_ny(b)}  ({(b - a) // 60} mnt)")


def make_live_printer():
    state = {"last": 0.0}

    def on_live(ts, bar, is_new):
        o, h, l, c, v = bar
        now = asyncio.get_event_loop().time()
        if is_new:
            print(f"\n[bar baru] {fmt_ny(ts)}  O{o} H{h} L{l} C{c}")
        elif now - state["last"] > 3:
            state["last"] = now
            sys.stdout.write(f"\r[live] {fmt_ny(ts)}  C={c}   ")
            sys.stdout.flush()
    return on_live


def save_csv(path, bars):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ts_utc", "ts_ny", "open", "high", "low", "close", "volume"])
        for ts in sorted(bars):
            w.writerow([ts, fmt_ny(ts), *bars[ts]])
    print(f"[csv] tersimpan: {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="OANDA:XAUUSD")
    ap.add_argument("--tf", default="1", help="1, 5, 15, 60, ...")
    ap.add_argument("--bars", type=int, default=20000, help="target jumlah bar riwayat")
    ap.add_argument("--csv", help="simpan riwayat ke file CSV")
    a = ap.parse_args()

    def on_history(bars):
        show_history(bars)
        if a.csv:
            save_csv(a.csv, bars)

    feed = TVFeed(a.symbol, a.tf, a.bars, on_history, make_live_printer())
    try:
        asyncio.run(feed.run())
    except KeyboardInterrupt:
        print("\nselesai.")


if __name__ == "__main__":
    main()
