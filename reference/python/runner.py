"""runner.py - Mesin headless: feed TradingView -> engine TPO -> snapshot.json (dibaca web TypeScript).

Tanpa web server. Konfigurasi (config.json) dimuat ulang otomatis saat file berubah; bila isinya
salah, konfigurasi lama tetap dipakai dan pesan error dikirim ke dashboard lewat meta.config_error.
"""
import asyncio
import json
import os
import time

import mcconfig
from tpo_engine import TPOEngine
from tv_feed import TVFeed


class Runner:
    def __init__(self, cfg_path, out=None, interval=1.0, on_snapshot=None, symbol=None, point=0.0, on_tick=None):
        self.cfg_path, self.out, self.interval, self.on_snapshot = cfg_path, out, interval, on_snapshot
        self.on_tick = on_tick                       # on_tick(price, bar_ts, wall): dipanggil tiap harga berubah, tanpa menunggu rebuild
        self.force = False                           # bar baru -> hitung ulang segera (abaikan jeda interval)
        self._tick = None                            # (price, bar_ts, wall) terakhir yang diterima feed TF terkecil
        self._tick_sent = 0.0
        self._tick_dirty = False
        self.sym_override, self.pt_override = symbol, point
        self.cfg = self.engine = self.snapshot = None
        self.symbol = None
        self.feeds, self.tasks = {}, {}
        self.dirty, self.auto_point = False, None
        self.config_error, self.err, self.build_ms = None, None, 0.0
        self._mt = None

    # ---- konfigurasi
    def reload_config(self, force=False):
        try:
            mt = os.path.getmtime(self.cfg_path)
        except OSError:
            mt = None
        if not force and mt == self._mt:
            return
        try:
            cfg = mcconfig.load(self.cfg_path)
        except ValueError as e:
            if self.cfg is None:
                raise SystemExit(str(e))
            self.config_error = str(e)      # pertahankan konfigurasi lama
            self._mt = mt
            return
        self.config_error = None
        self.apply(cfg)
        try:
            self._mt = os.path.getmtime(self.cfg_path)
        except OSError:
            self._mt = None

    def apply(self, cfg):
        symbol = self.sym_override or cfg.symbol
        if self.cfg is None or symbol != self.symbol or cfg.history_bars != self.cfg.history_bars:
            for tf in list(self.feeds):
                self._stop(tf)
        self.cfg, self.symbol = cfg, symbol
        self.engine = TPOEngine(symbol, self.pt_override or cfg.point or self.auto_point or 0.01,
                                cfg.timezone, cfg.profiles, cfg.atr_period, cfg.atr_feed_tf)
        needed = set(self.engine.needed_tfs()) | ({cfg.atr_feed_tf} if cfg.atr_feed_tf else set())
        for tf in list(self.feeds):
            if tf not in needed:
                self._stop(tf)
        for tf in sorted(needed, reverse=True):
            if tf not in self.feeds:
                self._start(tf)
            elif self.feeds[tf].history_done:
                self.engine.set_bars(tf, self.feeds[tf].bars)
        self.snapshot = None
        self.dirty = True

    # ---- feed
    def _stop(self, tf):
        self.feeds.pop(tf, None)
        t = self.tasks.pop(tf, None)
        if t:
            t.cancel()

    def _start(self, tf):
        def on_history(bars):
            if self.feeds.get(tf) is not feed:
                return
            self.engine.set_bars(tf, bars)
            if feed.point:
                self.auto_point = feed.point
                if not (self.pt_override or self.cfg.point):
                    self.engine.point = feed.point
            self.err, self.dirty = None, True

        def on_live(ts, bar, is_new):
            self.dirty = True
            if is_new:
                self.force = True
            if self.feeds and tf == min(self.feeds):         # sumber harga = feed TF terkecil
                self._tick = (bar[3], ts, time.time())
                self._tick_dirty = True
                self._flush_tick()

        def on_done(task):
            if task.cancelled() or self.feeds.get(tf) is not feed:
                return
            self.err = f"feed M{tf} berhenti ({task.exception()}); mencoba lagi 10 dtk"
            asyncio.get_running_loop().call_later(10, lambda: self.feeds.get(tf) is feed and (self._stop(tf), self._start(tf)))

        feed = TVFeed(self.symbol, str(tf), self.cfg.history_bars, on_history, on_live)
        self.feeds[tf] = feed
        task = asyncio.create_task(feed.run())
        task.add_done_callback(on_done)
        self.tasks[tf] = task

    def stop(self):
        for tf in list(self.feeds):
            self._stop(tf)

    def _flush_tick(self, now=None):
        """Kirim tick terbaru segera (maks ~20x/detik); sisanya dikirim loop beberapa puluh ms kemudian."""
        if not (self._tick_dirty and self.on_tick and self._tick):
            return
        now = now or time.time()
        if now - self._tick_sent < 0.05:
            return
        self._tick_dirty, self._tick_sent = False, now
        self.on_tick(*self._tick)

    # ---- keluaran
    def _status(self):
        if self.err:
            return self.err
        if self.snapshot is None:
            return "memuat riwayat: " + ", ".join(
                f"M{tf} {'✔' if f.history_done else '…'}" for tf, f in sorted(self.feeds.items(), reverse=True))
        return "live"

    def _write(self):
        if not self.out:
            return
        doc = {"meta": {"ts": time.time(), "status": self._status(), "config_error": self.config_error,
                        "build_ms": round(self.build_ms, 1),
                        "feeds": {str(tf): len(f.bars) for tf, f in self.feeds.items()}},
               "data": self.snapshot}
        tmp = self.out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        for _ in range(10):                  # Windows: replace bisa gagal sesaat bila file sedang dibaca
            try:
                os.replace(tmp, self.out)
                return
            except PermissionError:
                time.sleep(0.05)

    async def loop(self):
        last_build = last_write = 0.0
        while True:
            await asyncio.sleep(0.05)
            self._flush_tick()
            self.reload_config()
            now, built = time.time(), False
            # jeda efektif menyesuaikan beban: perangkat lambat tidak dibebani rebuild terus-menerus
            eff = max(self.interval, self.build_ms / 1000 * 4)
            if self.dirty and self.engine and self.engine.ready() and (self.force or now - last_build >= eff):
                self.dirty = self.force = False
                last_build = now
                try:
                    t0 = time.perf_counter()
                    self.engine.rebuild()
                    self.snapshot = self.engine.snapshot()
                    self.build_ms = (time.perf_counter() - t0) * 1000
                    built = True
                    if self.on_snapshot:
                        self.on_snapshot(self.snapshot)
                except Exception as e:       # satu error perhitungan tidak boleh mematikan proses
                    self.err = f"engine error: {e!r}"
            if built or now - last_write >= 5:   # heartbeat tiap 5 dtk agar web tahu engine hidup
                self._write()
                last_write = now
