#!/bin/sh
# Bangun klien web (butuh Node 18+) lalu server Rust. Hasil: target/release/mcdash
# Compiler TypeScript: tsc (bawaan) atau tsrs.   TS=tsrs ./build.sh
set -e
cd "$(dirname "$0")"
TS="${TS:-tsc}"
case "$TS" in
  tsc)  SCRIPT=build ;;
  tsrs) SCRIPT=build:tsrs ;;
  *) echo "TS harus 'tsc' atau 'tsrs' (nilai: $TS)" >&2; exit 2 ;;
esac
cargo test --release -p mcdash-core export_bindings   # tipe TS (web/src/gen) dari struct Rust via ts-rs
(cd web && npm install --no-audit --no-fund && npm run "$SCRIPT")   # type check + compile ke web/dist
cargo build --release
echo
echo "Selesai (compiler web: $TS). Jalankan:  ./target/release/mcdash --config config.json"
