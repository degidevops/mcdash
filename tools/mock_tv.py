#!/usr/bin/env python3
"""Server TradingView tiruan (protokol seperti yang dipakai tv_feed.py) untuk menguji klien tanpa internet.
   python3 tools/mock_tv.py --port 18765 [--avail 12000] [--live] [--drop-once]
   Riwayat deterministik; --live mengirim update bar berjalan; --drop-once menutup koneksi pertama tiap timeframe
   sesaat setelah riwayat selesai (menguji reconnect)."""
import argparse, asyncio, json, os, sys
from datetime import datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "reference", "python"))
import websockets
from gen_golden import m1_series, aggregate, fx_closed

NY = ZoneInfo("America/New_York")

def frame(obj):
    body = json.dumps(obj, separators=(",", ":"))
    return f"~m~{len(body)}~m~{body}"

def parse(raw):
    out, pos = [], 0
    while raw.startswith("~m~", pos):
        e = raw.index("~m~", pos + 3); n = int(raw[pos + 3:e]); out.append(raw[e + 3:e + 3 + n]); pos = e + 3 + n
    return out

M1 = None
def bars_for(tf, avail):
    global M1
    if M1 is None:
        end = datetime(2026, 11, 13, 12, 7, tzinfo=NY)
        from datetime import timedelta
        M1 = m1_series(end - timedelta(days=110), end, 4040.0, 0.35, fx_closed, seed=77)
    b = aggregate(M1, tf, avail)
    return [[t, *b[t]] for t in sorted(b)]

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18765); ap.add_argument("--avail", type=int, default=12000)
    ap.add_argument("--live", action="store_true"); ap.add_argument("--drop-once", action="store_true")
    a = ap.parse_args()
    dropped = set()

    async def handler(ws):
        tf, bars, lo, cs = None, [], 0, ""
        live_task = None
        async def live():
            c = bars[-1][4]
            while True:
                await asyncio.sleep(0.3)
                c = round(c + 0.05, 3); t, o, h, l, _, v = bars[-1]
                bars[-1] = [t, o, max(h, c), min(l, c), c, v + 1]
                await ws.send(frame({"m": "du", "p": [cs, {"sds_1": {"s": [{"i": len(bars) - 1, "v": bars[-1]}]}}]}))
        async def hb():
            n = 1
            while True:
                await asyncio.sleep(2); await ws.send(f"~m~{len(('~h~%d' % n))}~m~~h~{n}"); n += 1
        hb_task = asyncio.create_task(hb())
        try:
            async for raw in ws:
                for payload in parse(raw):
                    if payload.startswith("~h~"):
                        continue
                    d = json.loads(payload); m, p = d["m"], d["p"]
                    if m == "chart_create_session": cs = p[0]
                    elif m == "resolve_symbol":
                        await ws.send(frame({"m": "symbol_resolved", "p": [cs, "sds_sym_1", {"pricescale": 1000, "minmov": 1, "name": "XAUUSD"}]}))
                    elif m == "create_series":
                        tf = int(p[4]); first = int(p[5]); allb = bars_for(tf, a.avail)
                        bars = allb[-first:]; lo = len(allb) - len(bars); hist = allb
                        await ws.send(frame({"m": "timescale_update", "p": [cs, {"sds_1": {"s": [{"i": i, "v": v} for i, v in enumerate(bars)]}}]})
                                      + frame({"m": "series_completed", "p": [cs, "s1", "ok"]}))
                        if a.drop_once and tf not in dropped:
                            dropped.add(tf); await asyncio.sleep(0.3); await ws.close(); return
                        if a.live and live_task is None and len(bars) >= 0:
                            pass
                    elif m == "request_more_data":
                        n = int(p[2]); new = hist[max(0, lo - n):lo]; lo = max(0, lo - n); bars = new + bars
                        await ws.send(frame({"m": "timescale_update", "p": [cs, {"sds_1": {"s": [{"i": i, "v": v} for i, v in enumerate(new)]}}]})
                                      + frame({"m": "series_completed", "p": [cs, "s1", "ok"]}))
                    if a.live and live_task is None and tf is not None and m in ("create_series",):
                        live_task = asyncio.create_task(live())
        finally:
            hb_task.cancel()
            if live_task: live_task.cancel()

    async with websockets.serve(handler, "127.0.0.1", a.port, max_size=None):
        print(f"[mock_tv] ws://127.0.0.1:{a.port}", flush=True)
        await asyncio.Future()

asyncio.run(main())
