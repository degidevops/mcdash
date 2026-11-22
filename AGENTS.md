# MCDash — AI Agent Context

> Ini adalah file konteks universal untuk AI coding agent mana pun.
> Baca file ini + `CLAUDE.md` + `.agents/docs/chart-proposal.md` untuk konteks lengkap.

Lihat `CLAUDE.md` untuk arsitektur, milestone, dan keputusan teknis.

## Quick Start

```bash
cargo test --release          # 76 tests harus passing
cargo build --release --bin mcdash
```

## Status: M3 — Professional Trading Chart (SELESAI)
- Halaman `/chart` — full professional trading chart bergaya ATAS/DeepChart
- Phase 1: Candlestick + Volume + Zoom/Pan + Realtime (✅ Selesai)
- Phase 2: Crosshair + Multi-TF + Info Box + Y-Drag + Auto-Follow (✅ Selesai)
- Phase 3: TPO Overlay + Level Lines (✅ Selesai)
- Phase 4: Drawing Tools (Trendline, Fib, HLine, Rect) (✅ Selesai)
- Phase 5: Polish (mobile gestures, shortcuts, export PNG, ATAS watermark, extrema markers, 2D fallback) (✅ Selesai)
- Arsitektur: Hybrid WebGL2 + Canvas 2D
- Proposal lengkap: `.agents/docs/chart-proposal.md`
- Bahasa respons: **Bahasa Indonesia**
