#!/usr/bin/env python3
"""Server Binance tiruan (REST klines/exchangeInfo + WebSocket kline) untuk menguji feed tanpa internet.
   python3 tools/mock_binance.py --rest-port 18780 --ws-port 18781 [--symbol XAUUSDT] [--drop-once]
   Jalankan mcdash dengan MCDASH_BINANCE_REST=http://127.0.0.1:18780 MCDASH_BINANCE_WS=ws://127.0.0.1:18781
   --drop-once menutup koneksi WebSocket pertama tiap interval (menguji reconnect + backfill)."""
import argparse, asyncio, json, random, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import websockets

IV = {"1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60}
DAYS = 40
A = None

def build_m1():
    now = int(time.time()) // 60 * 60
    rnd = random.Random(7); p = 4000.0; out = {}
    for t in range(now - DAYS * 1440 * 60, now + 60, 60):
        o = p; p = round(p + rnd.gauss(0, 0.6), 2)
        out[t] = [o, max(o, p) + abs(rnd.gauss(0, .2)), min(o, p) - abs(rnd.gauss(0, .2)), p, round(rnd.uniform(1, 20), 3)]
    return out

M1 = build_m1()

def agg(k):
    step = k * 60; b = {}
    for t in sorted(M1):
        s = t // step * step; o, h, l, c, v = M1[t]
        if s not in b: b[s] = [o, h, l, c, v]
        else: x = b[s]; x[1] = max(x[1], h); x[2] = min(x[2], l); x[3] = c; x[4] += v
    return b

def row(t, x):
    return [t * 1000, f"{x[0]:.2f}", f"{x[1]:.2f}", f"{x[2]:.2f}", f"{x[3]:.2f}", f"{x[4]:.3f}", t * 1000 + 59999, "0", 0, "0", "0", "0"]

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path.endswith("exchangeInfo"):
            return self.send(200, {"symbols": [{"symbol": A.symbol, "status": "TRADING", "filters": [{"filterType": "PRICE_FILTER", "tickSize": "0.01000000"}]}]})
        if u.path.endswith("klines"):
            if q.get("symbol") != A.symbol: return self.send(400, {"code": -1121, "msg": "Invalid symbol."})
            if q.get("interval") not in IV: return self.send(400, {"code": -1120, "msg": "Invalid interval."})
            b = agg(IV[q["interval"]]); ts = sorted(b); lim = int(q.get("limit", 500))
            if "startTime" in q: sel = [t for t in ts if t * 1000 >= int(q["startTime"])][:lim]
            else:
                end = int(q.get("endTime", 1 << 62)); sel = [t for t in ts if t * 1000 <= end][-lim:]
            return self.send(200, [row(t, b[t]) for t in sel])
        self.send(404, {"code": -1, "msg": "?"})

async def ws_handler(ws):
    path = ws.request.path.lstrip("/"); sym, _, iv = path.partition("@kline_")
    if sym.upper() != A.symbol or iv not in IV:
        await ws.close(); return
    first = iv not in A.dropped
    k = IV[iv]; step = k * 60
    try:
        n = 0
        while True:
            await asyncio.sleep(0.3); n += 1
            now = int(time.time()); t = now // step * step; b = agg(k) if False else None
            m = [x for s, x in M1.items() if t <= s < t + step]
            if not m: continue
            o, c = m[0][0], m[-1][3]
            c = round(c + 0.05 * n, 2)
            msg = {"e": "kline", "E": now * 1000, "s": A.symbol, "k": {"t": t * 1000, "T": t * 1000 + step * 1000 - 1, "s": A.symbol, "i": iv,
                   "o": f"{o:.2f}", "c": f"{c:.2f}", "h": f"{max(o, c):.2f}", "l": f"{min(o, c):.2f}", "v": "5.0", "x": False}}
            await ws.send(json.dumps(msg))
            if A.drop_once and first and n == 5:
                A.dropped.add(iv); print("drop", iv, flush=True); await ws.close(); return
    except websockets.ConnectionClosed:
        pass

async def main():
    global A
    ap = argparse.ArgumentParser(); ap.add_argument("--rest-port", type=int, default=18780); ap.add_argument("--ws-port", type=int, default=18781)
    ap.add_argument("--symbol", default="XAUUSDT"); ap.add_argument("--drop-once", action="store_true")
    A = ap.parse_args(); A.dropped = set()
    srv = ThreadingHTTPServer(("127.0.0.1", A.rest_port), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    async with websockets.serve(ws_handler, "127.0.0.1", A.ws_port):
        print("mock binance siap", flush=True); await asyncio.Future()

asyncio.run(main())
