# MCDash — Project Context & Agent Instructions

> **File ini otomatis dibaca oleh Antigravity setiap sesi baru.**
> Update file ini setiap ada milestone penting.

---

## Identitas Project

- **Nama**: MCDash — TPO Dashboard & Professional Trading Chart
- **Bahasa**: Rust (backend) + TypeScript (frontend), zero-dependency
- **Repo**: https://github.com/degidevops/mcdash.git
- **Branch**: `main`
- **Sumber Data**: Binance klines (futures/spot), juga support TradingView & MT5

---

## Arsitektur

```
mcdash/
├── Cargo.toml              # Workspace: crates/core + crates/server
├── config.json             # Konfigurasi runtime (simbol, timezone, profil TPO)
├── crates/
│   ├── core/               # Library: TPO engine, period, profile, bias, snapshot
│   │   ├── src/
│   │   │   ├── lib.rs      # Re-exports
│   │   │   ├── engine.rs   # TpoEngine: rebuild, snapshot, dump
│   │   │   ├── period.rs   # Period: TPO letters, POC, VA computation
│   │   │   ├── profile.rs  # Profile: multi-period management
│   │   │   ├── series.rs   # Bar OHLCV & Series (ATR)
│   │   │   ├── config.rs   # Config parsing & validation
│   │   │   ├── bias.rs     # Bias calculation (open vs VA)
│   │   │   ├── snapshot.rs # JSON snapshot structs (ts-rs → TS)
│   │   │   ├── wire.rs     # WebSocket frame types
│   │   │   ├── calendar.rs # Timezone, session boundaries
│   │   │   ├── brokertime.rs
│   │   │   ├── telegram.rs # Telegram notifier
│   │   │   └── util.rs     # Helpers
│   │   └── tests/
│   │       ├── golden.rs   # 8 golden snapshot tests
│   │       └── ts_parity.rs # TS ↔ Rust parity test
│   └── server/             # Binary: HTTP + WebSocket server (axum + tokio)
│       └── src/
│           ├── main.rs     # CLI args, startup
│           ├── app.rs      # Shared state, frame builders
│           ├── http.rs     # Routes: /, /api/*, /ws
│           ├── runner.rs   # Config → engine → feeds → snapshot loop
│           ├── notifier.rs # Telegram notifier
│           └── feed/
│               ├── mod.rs
│               ├── binance.rs    # Binance REST+WS feed
│               ├── tradingview.rs
│               └── mt5.rs
├── web/                    # Frontend TypeScript
│   ├── index.html          # Dashboard HTML (inline CSS)
│   ├── package.json        # mcdash-web, tsc/tsrs compiler
│   ├── tsconfig.json
│   ├── src/
│   │   ├── client.ts       # Dashboard logic (morph, render, WS)
│   │   ├── history.ts      # Historical analysis
│   │   ├── morph.ts        # DOM diffing
│   │   ├── types.ts        # Type helpers
│   │   └── gen/            # Auto-generated from Rust (ts-rs)
│   └── dist/               # Compiled output
└── tests/                  # Test fixtures (JSON snapshots)
```

---

## Konvensi & Aturan

- **Bahasa respons**: Selalu dalam Bahasa Indonesia
- **Sandbox**: Semua command harus pakai `BypassSandbox: true` (Termux ARM64 glibc issue)
- **Build**: `cargo build --release --bin mcdash`
- **Test**: `cargo test --release` (74 tests: 53 core + 12 server + 8 golden + 1 ts-parity)
- **File links**: Selalu gunakan `file://` markdown links
- **Git**: Credential helper `store` sudah dikonfigurasi (`~/.git-credentials`)

---

## Milestone yang Sudah Selesai

### ✅ M1: TPO Calculation Alignment (Nov 2026)
- Aligned POC/VAH/VAL calculation dengan ATAS & Sierra Chart
- Mode baru: `VaBound` (center/edge), `PocRule` (atas/mid/close/high/low), `VaTieBreak` (cbot/up), `VaStop` (floor/ceil/closest)
- Config: `poc_rule: "atas"`, `va_bound: "center"`, `va_tie_break: "cbot"`, `va_stop: "floor"`
- Hasil: POC 100% match ATAS, VAH/VAL selisih 1-7 tick (perbedaan proprietary tie resolution)
- Semua 73 test passing

### ✅ M2: Git + Backup + GitHub Push (Nov 2026)
- Git initialized, branch `main`, pushed to `origin`
- Backup: `mcdash-backup.tar.gz` (4.8 MB)

---

## Milestone Berikutnya

### 🔲 M3: Professional Trading Chart (IN PROGRESS)
- **Goal**: Halaman `/chart` — full professional trading chart bergaya ATAS/DeepChart
- **Arsitektur**: Hybrid WebGL2 + Canvas 2D, 3-layer rendering
- **Proposal**: Lihat `.agents/docs/chart-proposal.md`
- **Fase**:
  1. Phase 1: Candlestick + Volume + Zoom/Pan + Realtime (✅ Selesai)
  2. Phase 2: Crosshair + Multi-TF + Info Box ← **SELANJUTNYA**
  3. Phase 3: TPO Overlay + Level Lines
  4. Phase 4: Drawing Tools (Trendline, Fib, HLine, Rect)
  5. Phase 5: Polish (mobile, shortcuts, export)

**Fitur utama yang diminta**:
- Candlestick chart + Volume bars + TPO/Market Profile overlay (gaya ATAS)
- Multi-timeframe (1m/5m/15m/1H/4H/D)
- Drawing tools (trendline, horizontal line, fibonacci, rectangle)
- Crosshair + zoom/pan
- Dark theme ATAS-style (#131722 background)
- Halaman terpisah `/chart` dengan navigasi ↔ Dashboard
- Sumber data: Binance klines via existing feed system (Runner.bars)

**Keputusan teknis**:
- Pure TypeScript, zero dependency (konsisten dengan codebase)
- WebGL2 untuk data berat (candles, volume, TPO blocks) — instanced rendering
- Canvas 2D untuk teks, crosshair, level lines, drawing tools
- HTML/CSS untuk toolbar, tooltips, controls
- Backend: expose `Runner.bars` via `/api/chart-bars` + `/ws/chart`

---

## Data Kunci

- **Simbol utama**: XAUUSDT (Binance Futures perpetual)
- **Tick size**: 0.01 (dari exchangeInfo)
- **TPO config**: 10m letters (sessional), 15m (daily/weekly)
- **Sessions**: 6-hour blocks mulai 18:00 ET
- **Timezone**: America/New_York

---

## Tips untuk Melanjutkan

1. Baca file ini dulu untuk memahami konteks project
2. Cek `git log --oneline -5` untuk status terakhir
3. Cek `cargo test --release` untuk memastikan semuanya masih passing
4. Lanjutkan dari milestone yang belum selesai (lihat bagian "Milestone Berikutnya")
5. Semua command harus `BypassSandbox: true`
