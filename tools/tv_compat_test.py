#!/usr/bin/env python3
"""Uji kesetaraan: klien TradingView Python (acuan) vs klien Rust terhadap server tiruan yang sama.
   Keduanya harus menghasilkan bar & snapshot TPO yang identik.  python3 tools/tv_compat_test.py <mcdash_bin> <web_dist>"""
import asyncio, json, os, subprocess, sys, time, urllib.request
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "reference", "python"))
import tv_feed, mcconfig
from tpo_engine import TPOEngine

PORT, HTTP = 18765, 18099
tv_feed.WS_URL = f"ws://127.0.0.1:{PORT}"

def close(a, b): return abs(a - b) <= 1e-9 * (1 + max(abs(a), abs(b)))
def diff(path, a, b, out):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)): diff(f"{path}.{k}", a.get(k), b.get(k), out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b): out.append(f"{path}: panjang {len(a)} != {len(b)}"); return
        for i, (x, y) in enumerate(zip(a, b)): diff(f"{path}[{i}]", x, y, out)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        if not close(a, b): out.append(f"{path}: {a} != {b}")
    elif a != b: out.append(f"{path}: {a!r} != {b!r}")

async def python_side(cfg):
    got = {}
    eng = TPOEngine("MOCK:XAUUSD", 0.0, cfg.timezone, cfg.profiles, cfg.atr_period, cfg.atr_feed_tf)
    feeds = {}
    for tf in eng.needed_tfs():
        done = asyncio.Event()
        f = tv_feed.TVFeed("MOCK:XAUUSD", str(tf), cfg.history_bars, lambda b, tf=tf, d=done: (got.__setitem__(tf, dict(b)), d.set()), None)
        feeds[tf] = (f, done, asyncio.create_task(f.run()))
    for tf, (f, done, t) in feeds.items():
        await asyncio.wait_for(done.wait(), 60)
    point = next(iter(feeds.values()))[0].point
    for tf, (f, done, t) in feeds.items(): t.cancel()
    eng.point = point
    for tf, b in got.items(): eng.set_bars(tf, b)
    eng.rebuild()
    return eng.snapshot(), {tf: len(b) for tf, b in got.items()}, point

def start_mock(port, drop):
    args = [sys.executable, os.path.join(ROOT, "tools", "mock_tv.py"), "--port", str(port)] + (["--drop-once"] if drop else [])
    m = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    m.stdout.readline()
    return m

def run_scenario(binp, web, cfg, cfgp, tmp, drop, port_py, port_rs, http):
    name = "putus di tengah riwayat" if drop else "tanpa putus"
    print(f"\n=== skenario: {name} ===")
    m1 = start_mock(port_py, drop)
    tv_feed.WS_URL = f"ws://127.0.0.1:{port_py}"
    expected, counts, point = asyncio.run(python_side(cfg))
    m1.terminate()
    print(f"Python: bar per tf = {counts}, point = {point}")
    m2 = start_mock(port_rs, drop)
    env = dict(os.environ, MCDASH_TV_URL=f"ws://127.0.0.1:{port_rs}")
    srv = subprocess.Popen([binp, "--config", cfgp, "--host", "127.0.0.1", "--port", str(http), "--web", web, "--telegram", f"{tmp}/tg.json"], env=env, stdout=open(f"{tmp}/server_{int(drop)}.log", "w"), stderr=subprocess.STDOUT)
    try:
        d = None
        for _ in range(120):
            time.sleep(0.5)
            try:
                d = json.load(urllib.request.urlopen(f"http://127.0.0.1:{http}/api/snapshot", timeout=2))
                if d["data"] and d["meta"]["status"] == "live": break
            except Exception: pass
        assert d and d["data"], "Rust tidak menghasilkan snapshot: " + open(f"{tmp}/server_{int(drop)}.log").read()[-800:]
        print(f"Rust  : bar per tf = {d['meta']['feeds']}, status = {d['meta']['status']}, point = {d['data']['point']}")
        errs = []
        diff("", expected, d["data"], errs)
        same_counts = {str(k): v for k, v in counts.items()} == d["meta"]["feeds"]
        print(f"selisih snapshot: {len(errs)} | jumlah bar sama: {same_counts}"); [print("  ", e) for e in errs[:10]]
        return not errs and same_counts
    finally:
        srv.terminate(); m2.terminate()

def main():
    binp, web = sys.argv[1], sys.argv[2]
    tmp = "/tmp/tvcompat"; os.makedirs(tmp, exist_ok=True)
    cfgp = f"{tmp}/config.json"
    json.dump({"general": {"symbol": "MOCK:XAUUSD"}}, open(cfgp, "w"))
    cfg = mcconfig.load(cfgp)
    ok1 = run_scenario(binp, web, cfg, cfgp, tmp, False, 18765, 18766, 18099)
    ok2 = run_scenario(binp, web, cfg, cfgp, tmp, True, 18767, 18768, 18098)
    print("\nHASIL:", "IDENTIK di kedua skenario ✔" if ok1 and ok2 else "ADA PERBEDAAN ✘")
    sys.exit(0 if ok1 and ok2 else 1)

if __name__ == "__main__":
    main()
