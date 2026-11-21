#!/usr/bin/env python3
"""mcdash.py - Mesin TPO headless. Semua parameter ada di config.json (dimuat ulang otomatis).

  python mcdash.py --init-config   # buat config.json default lalu keluar
  python mcdash.py                 # tulis snapshot.json terus-menerus (dibaca dashboard web di folder web/)
  python mcdash.py --text          # sama, plus cetak ringkasan teks tiap update
  python mcdash.py --once          # cetak ringkasan sekali lalu selesai (untuk dibandingkan dengan MT5)

Biasanya tidak perlu dijalankan manual: `npm start` di folder web/ menjalankannya otomatis.
"""
import argparse
import asyncio
import json
import sys

import mcconfig
from runner import Runner
from tpo_engine import format_text


async def amain(a):
    done = asyncio.Event()

    def on_snap(snap):
        if a.text or a.once:
            print("\n" + format_text(snap), flush=True)
        if a.once:
            done.set()

    on_tick = None
    if a.stream:                                     # dibaca server web lewat stdout -> harga realtime tanpa lewat file
        def on_tick(price, bar_ts, wall):
            print("@@tick " + json.dumps({"p": price, "bar": bar_ts, "wall": wall}, separators=(",", ":")), flush=True)

    r = Runner(a.config, a.out, a.interval, on_snap, a.symbol, a.point, on_tick)
    r.reload_config(force=True)          # error konfigurasi awal -> keluar dengan pesan jelas
    print(mcconfig.describe(r.cfg), flush=True)
    task = asyncio.create_task(r.loop())
    if a.once:
        await done.wait()
        task.cancel()
        r.stop()
    else:
        await task


def main():
    ap = argparse.ArgumentParser(description="Mesin TPO headless (parameter di config.json)")
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--init-config", action="store_true")
    ap.add_argument("--out", default="snapshot.json", help="file keluaran untuk dashboard web")
    ap.add_argument("--interval", type=float, default=1.0, help="jeda minimum antar perhitungan TPO (detik); harga sendiri tidak menunggu ini")
    ap.add_argument("--stream", action="store_true", help="cetak tick harga ke stdout (dipakai server web)")
    ap.add_argument("--symbol", help="timpa general.symbol")
    ap.add_argument("--point", type=float, default=0, help="timpa general.point")
    ap.add_argument("--text", action="store_true")
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()
    if a.init_config:
        mcconfig.write_default(a.config)
        print(f"[config] {a.config} dibuat.")
        return
    try:
        asyncio.run(amain(a))
    except KeyboardInterrupt:
        print("\nselesai.")
    except SystemExit as e:
        sys.exit(e.code)


if __name__ == "__main__":
    main()
