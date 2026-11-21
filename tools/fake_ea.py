#!/usr/bin/env python3
"""Simulator EA MetaTrader 5 (protokol MCB1) untuk menguji server tanpa terminal MT5.
   python3 tools/fake_ea.py [--host 127.0.0.1] [--port 9899] [--symbol XAUUSD] [--point 0.001] [--encode-time]
   --encode-time : harga live = 4040 + (waktu mod 100)/12.5, supaya jeda ujung-ke-ujung bisa diukur di browser.
"""
import argparse, json, random, socket, threading, time

def m1_history(days, p0, vol, seed=1):
    rnd, px, out = random.Random(seed), p0, {}
    end = int(time.time()) // 60 * 60
    for i in range(days * 1440):
        t = end - (days * 1440 - i) * 60
        o = px; c = o + rnd.gauss(0, vol)
        h = max(o, c) + abs(rnd.gauss(0, vol * .4)); l = min(o, c) - abs(rnd.gauss(0, vol * .4))
        out[t] = (o, h, l, c, rnd.randint(1, 90)); px = c
    return out

def aggregate(m1, tf, last_n):
    sec, bars = tf * 60, {}
    for t, (o, h, l, c, v) in sorted(m1.items()):
        k = t - t % sec; a = bars.get(k)
        bars[k] = (o, h, l, c, v) if a is None else (a[0], max(a[1], h), min(a[2], l), c, a[4] + v)
    keys = sorted(bars)[-last_n:]
    return {k: bars[k] for k in keys}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1"); ap.add_argument("--port", type=int, default=9899)
    ap.add_argument("--symbol", default="XAUUSD"); ap.add_argument("--point", type=float, default=0.001)
    ap.add_argument("--encode-time", action="store_true"); ap.add_argument("--days", type=int, default=40)
    ap.add_argument("--no-hello", action="store_true")
    a = ap.parse_args()
    m1 = m1_history(a.days, 4040.0, 0.35)
    s = socket.create_connection((a.host, a.port)); s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    lock = threading.Lock()
    def send(o):
        with lock: s.sendall((json.dumps(o, separators=(",", ":")) + "\n").encode())
    send({"t": "hello", "v": 1, "symbol": a.symbol, "digits": 3, "point": a.point})
    tfs, bars_now = [], {}
    def rx():
        buf = b""
        while True:
            d = s.recv(65536)
            if not d: print("[fake_ea] server menutup koneksi"); import os; os._exit(0)
            buf += d
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                m = json.loads(line)
                print("[fake_ea] <-", line.decode()[:100])
                if m["t"] == "need":
                    tf, n = m["tf"], m["count"]
                    b = aggregate(m1, tf, n); bars_now[tf] = b
                    if tf not in tfs: tfs.append(tf)
                    items = [[t, *v] for t, v in sorted(b.items())]
                    for i in range(0, len(items), 2000):
                        send({"t": "bars", "tf": tf, "b": items[i:i + 2000], "last": i + 2000 >= len(items)})
                elif m["t"] == "reject": print("[fake_ea] ditolak:", m.get("why")); import os; os._exit(1)
    threading.Thread(target=rx, daemon=True).start()
    px = list(m1.values())[-1][3]; rnd = random.Random(5); last_hb = 0
    while True:
        time.sleep(0.2)
        now = time.time()
        px = round(4040 + (now % 100) / 12.5, 3) if a.encode_time else round(px + rnd.gauss(0, 0.2), 3)
        ups = []
        for tf in tfs:
            sec = tf * 60; k = int(now) // sec * sec; b = bars_now[tf]
            if k not in b: b[k] = (px, px, px, px, 1)
            o, h, l, c, v = b[k]; b[k] = (o, max(h, px), min(l, px), px, v + 1)
            u = {"tf": tf, "b": [k, *b[k]]}
            if k - sec in b: u["p"] = [k - sec, *b[k - sec]]
            ups.append(u)
        send({"t": "live", "bid": px, "u": ups})
        if now - last_hb > 5: last_hb = now; send({"t": "hb"})

if __name__ == "__main__":
    main()
