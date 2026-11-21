# MCDash — AI Agent Context

> Ini adalah file konteks universal untuk AI coding agent mana pun.
> Baca file ini + `CLAUDE.md` + `.agents/docs/chart-proposal.md` untuk konteks lengkap.

Lihat `CLAUDE.md` untuk arsitektur, milestone, dan keputusan teknis.

## Quick Start

```bash
cargo test --release          # 73 tests harus passing
cargo build --release --bin mcdash
```

## Status: M3 — Professional Trading Chart (IN PROGRESS)
- Halaman `/chart` — full professional trading chart bergaya ATAS/DeepChart
- Phase 1: Candlestick + Volume + Zoom/Pan + Realtime ← **MULAI DI SINI**
- Arsitektur: Hybrid WebGL2 + Canvas 2D
- Proposal lengkap: `.agents/docs/chart-proposal.md`
- Bahasa respons: **Bahasa Indonesia**
