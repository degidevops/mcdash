# MCDash — Project Context for AI Agents

> **File ini berisi konteks lengkap project MCDash.**
> Untuk AI agent mana pun yang membaca file ini: ikuti instruksi di bawah.

---

## Instruksi Umum

- **Bahasa respons**: Selalu dalam Bahasa Indonesia
- **Build**: `cargo build --release --bin mcdash`
- **Test**: `cargo test --release` (76 tests harus passing semua)
- **Push**: `git push origin main` (credential store sudah dikonfigurasi)
- **Environment**: Termux ARM64 (Android), Rust + TypeScript
- **Zero dependency**: Frontend murni TypeScript tanpa React/Vue/library external

---

## Identitas Project

- **Nama**: MCDash — TPO Dashboard & Professional Trading Chart
- **Stack**: Rust (backend: axum + tokio) + TypeScript (frontend: pure, zero-dep)
- **Repo**: https://github.com/degidevops/mcdash.git
- **Data Source**: Binance klines (futures/spot), TradingView, MT5

---

## Arsitektur

```
mcdash/
├── Cargo.toml              # Workspace: crates/core + crates/server
├── config.json             # Runtime config (simbol, timezone, profil TPO)
├── GEMINI.md               # Context untuk Antigravity/Gemini agent
├── CLAUDE.md               # Context untuk Claude agent (file ini)
├── .agents/docs/           # Proposal & dokumentasi arsitektur
│   └── chart-proposal.md   # Arsitektur chart profesional (BACA INI)
├── crates/
│   ├── core/               # Library: TPO engine, period, profile, bias
│   │   ├── src/
│   │   │   ├── lib.rs      # Re-exports (Bar, Bars, Series, TpoEngine, Snap, dll)
│   │   │   ├── engine.rs   # TpoEngine: rebuild, snapshot, dump
│   │   │   ├── period.rs   # Period: TPO letters, POC, VA computation
│   │   │   │               #   Mode: VaBound, PocRule, VaTieBreak, VaStop
│   │   │   ├── profile.rs  # Profile: multi-period management
│   │   │   ├── series.rs   # Bar { o, h, l, c, v } & Series (ATR)
│   │   │   ├── config.rs   # Config parsing & validation
│   │   │   ├── bias.rs     # Bias calculation (open vs VA)
│   │   │   ├── snapshot.rs # Snap, PerSnap, ProfSnap, Context (ts-rs → TS types)
│   │   │   ├── wire.rs     # WebSocket frame types (Meta, Msg, Frame)
│   │   │   ├── calendar.rs # Timezone, session boundaries
│   │   │   └── util.rs     # Helpers (mql_round, decimals_of)
│   │   └── tests/
│   │       ├── golden.rs   # 8 golden snapshot tests
│   │       └── ts_parity.rs
│   └── server/             # Binary: HTTP + WebSocket (axum + tokio)
│       └── src/
│           ├── main.rs     # CLI args, startup, --dump, --once
│           ├── app.rs      # Shared state (RwLock), frame builders
│           ├── http.rs     # Routes: /, /api/snapshot, /api/config, /ws
│           ├── runner.rs   # Config → engine → feeds → snapshot loop
│           │               #   KEY: self.bars: HashMap<i64, BTreeMap<i64, Bar>>
│           │               #   Ini adalah sumber data OHLCV untuk chart baru
│           ├── notifier.rs # Telegram notifier
│           └── feed/
│               ├── mod.rs      # FeedEvent enum
│               ├── binance.rs  # Binance REST klines + WebSocket live
│               ├── tradingview.rs
│               └── mt5.rs
├── web/                    # Frontend TypeScript (zero-dependency)
│   ├── index.html          # Dashboard HTML (inline CSS, dark theme)
│   ├── package.json        # Build: tsc atau tsrs
│   ├── src/
│   │   ├── client.ts       # Dashboard: WS connect, render, morph
│   │   ├── history.ts      # Historical analysis per profil
│   │   ├── morph.ts        # DOM diffing (innerHTML replacement)
│   │   ├── types.ts        # Type helpers, ORDER, NAME, KEYS
│   │   └── gen/            # Auto-generated dari Rust (ts-rs): Frame.ts, Snap.ts, dll
│   └── dist/               # Compiled JS output
└── tests/                  # JSON fixtures untuk golden tests
```

---

## Status Milestone

### ✅ SELESAI: M1 — TPO Calculation Alignment
- POC/VAH/VAL calculation aligned dengan ATAS & Sierra Chart
- Mode: `PocRule::Atas`, `VaBound::Center`, `VaTieBreak::Cbot`, `VaStop::Floor`
- 74 tests passing

### ✅ SELESAI: M2 — Git + GitHub Push
- Branch `main`, pushed ke origin
- Credential store configured

### 🔲 AKTIF: M3 — Professional Trading Chart
**Goal**: Halaman `/chart` — full professional trading chart bergaya ATAS/DeepChart

**BACA PROPOSAL LENGKAP**: `.agents/docs/chart-proposal.md`

**Ringkasan arsitektur**:
- Hybrid WebGL2 + Canvas 2D, 3-layer rendering
- Candlestick + Volume + TPO overlay + Drawing tools
- Pure TypeScript, zero dependency
- Backend: expose Runner.bars via `/api/chart-bars` + `/ws/chart`

**Fase implementasi**:
1. **Phase 1**: Candlestick + Volume + Zoom/Pan + Realtime (✅ Selesai)
2. **Phase 2**: Crosshair + Multi-TF + Info Box + Y-Drag + Auto-Follow (✅ Selesai)
3. **Phase 3**: TPO Overlay + Level Lines (✅ Selesai)
4. **Phase 4**: Drawing Tools (Trendline, Fib, HLine, Rect) ← **SELANJUTNYA**
5. **Phase 5**: Polish (mobile, shortcuts, export)

**Keputusan teknis yang sudah diambil**:
- Layout: Price Y-axis (vertikal), Time X-axis (horizontal) — standar candlestick
- TPO: overlay semi-transparan di atas candlestick
- Multi-period: side-by-side (gaya ATAS "Multiples")
- Color: ATAS dark theme (#131722 background, teal bull, red bear)
- Halaman: terpisah `/chart`, navigasi 2 arah ↔ Dashboard
- Data: Binance klines dari Runner.bars (sudah ada, tinggal expose via API)

**File baru yang perlu dibuat (Phase 1)**:
```
web/chart.html                     # HTML halaman chart
web/src/chart/index.ts             # Entry point
web/src/chart/ChartApp.ts          # Orchestrator
web/src/chart/state/BarBuffer.ts   # OHLCV data store
web/src/chart/viewport/Viewport.ts # Transform matrix
web/src/chart/gl/GLContext.ts      # WebGL2 setup
web/src/chart/gl/CandleRenderer.ts # Instanced candlesticks
web/src/chart/gl/VolumeRenderer.ts # Volume histogram
web/src/chart/gl/GridRenderer.ts   # Grid lines
web/src/chart/overlay/AxisRenderer.ts     # Canvas 2D axes
web/src/chart/interaction/PanZoom.ts      # Mouse/touch handlers
web/src/chart/net/ChartClient.ts          # WS + REST client
```

**Backend changes (Rust)**:
```
crates/server/src/http.rs   # Tambah routes: /chart, /api/chart-bars, /ws/chart
crates/server/src/app.rs    # Expose bars ke Shared state
```

---

## Data Kunci

| Key | Value |
|-----|-------|
| Simbol | XAUUSDT (Binance Futures perpetual) |
| Tick size | 0.01 |
| TPO letters | 10m (sessional), 15m (daily/weekly) |
| Sessions | 6-hour blocks mulai 18:00 ET |
| Timezone | America/New_York |
| VA% | 70% |
| Point | 0.01 (auto dari Binance exchangeInfo) |

---

## Penting: Cara Kerja Data

Data OHLCV sudah di-fetch oleh `Runner` di `crates/server/src/runner.rs`:

```rust
struct Runner {
    bars: HashMap<i64, Bars>,  // key = timeframe (menit), value = BTreeMap<timestamp, Bar>
    // ... fields lain
}
```

`Bar` didefinisikan di `crates/core/src/series.rs`:
```rust
pub struct Bar { pub o: f64, pub h: f64, pub l: f64, pub c: f64, pub v: f64 }
pub type Bars = BTreeMap<i64, Bar>;  // key = epoch UTC detik
```

Feed Binance (`crates/server/src/feed/binance.rs`) mendukung timeframe:
1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d

Untuk chart: tinggal expose `Runner.bars` via API baru, TIDAK perlu fetch tambahan.
