# mcdash — dashboard TPO (Rust + TypeScript)

Satu proses Rust memegang semuanya: sumber data → mesin TPO → bias → web + Telegram.
TypeScript hanya untuk tampilan di browser.

```
 TradingView (WebSocket)  ─┐
                           ├─►  feed ─► runner ─► mesin TPO ─► bias ─┬─► HTTP/WebSocket ─► browser (TS)
 MetaTrader 5 (EA, TCP)   ─┤
 Binance (REST + WebSocket)┘                                          └─► Telegram
```

| Folder | Isi |
|---|---|
| `crates/core` | Inti murni tanpa I/O: kalender, mesin TPO, snapshot, config, **bias**, isi + pemicu notifikasi Telegram |
| `crates/server` | Program `mcdash`: feed (TradingView, MT5, Binance), runner, HTTP/WS (axum), pengiriman Telegram |
| `web` | Klien TypeScript (di-compile tsc atau tsrs → `web/dist/*.js`, ES module). Tipe kawat di `web/src/gen/` **digenerate dari Rust (ts-rs)**, jangan diedit |
| `mt5/MCDashBridge.mq5` | Expert Advisor untuk sumber data MetaTrader 5 |
| `tools` | `fake_ea.py` (simulator EA), `mock_tv.py` (TradingView tiruan), `mock_binance.py` (Binance tiruan), `tv_compat_test.py` |
| `reference` | Engine Python & bias TS lama — **hanya acuan tes** (golden test) |

## Build & jalankan

Butuh Rust (stable terbaru) dan Node 18+ (hanya untuk membangun klien web). Type check dan compile (emit) klien ke `web/dist` memakai `tsc` (bawaan) atau, sebagai pilihan, [tsrs](https://github.com/oxc-project/tsrs) (compiler TS berbasis Rust, biner native lewat npm; dipasang sebagai `optionalDependencies`, jadi gagal pasang tidak menggagalkan `npm install`). Keduanya menghasilkan `dist` yang sama; tanpa esbuild dan tanpa bundler (browser memuat modul ES langsung). Pilih dengan `TS=tsrs ./build.sh` atau langsung `npm run build:tsrs`.

```sh
./build.sh                                   # web + server
./target/release/mcdash --config config.json # config.json dibuat otomatis bila belum ada
```

Buka `http://127.0.0.1:9898`. Opsi lain: `mcdash --help` (`--host 127.0.0.1` agar hanya komputer ini yang bisa mengakses,
`--port`, `--text`, `--once`, `--init-config`). Termux: `pkg install rust nodejs`.

`config.json` dan `telegram.json` lama **tetap kompatibel**. Bagian baru hanya `source`.

## Tipe TS dari Rust (ts-rs)
Kontrak server→browser didefinisikan sekali, di Rust (`snapshot.rs`, `bias.rs`, `wire.rs`). Setelah mengubah struct-nya:
```sh
cargo test -p mcdash-core export_bindings   # menulis ulang web/src/gen/*.ts (juga dijalankan oleh build.sh)
cd web && npm run typecheck                 # tsc langsung menandai kode klien yang tidak cocok lagi (atau: npm run typecheck:tsrs)
```
Tes di crate server memastikan frame WebSocket/HTTP yang sungguh dikirim bisa dibaca balik sebagai tipe `wire.rs`, jadi tipe dan keluaran nyata tidak bisa melenceng.

## First touch level (naked POC/VAH/VAL)
Level periode yang sudah selesai dianggap **tersentuh** hanya bila harga memuat level (high ≥ level ≥ low) pada `touch_letters` huruf TPO **berurutan** (default `2`, per profil di config). Sumbu yang cuma 1 huruf lalu menjauh tidak menghapus status naked, dan hitungan mulai dari nol bila ada huruf yang tidak menyentuh. Waktu dan arah touch dicatat dari huruf pertama rangkaian; level terisi begitu huruf ke-N mulai memuat level. `touch_letters: 1` = perilaku lama (satu bar cukup). Tes golden terhadap engine Python memakai `1`.

## Sumber data

`config.json`:

```json
"source": { "type": "tradingview" }                       // bawaan (sama seperti sebelumnya)
"source": { "type": "mt5", "mt5_listen": "127.0.0.1:9899", "mt5_symbol": "" }
"source": { "type": "binance", "binance_market": "futures" }       // simbol dari general.symbol
```

### Realtime & pemulihan koneksi (anti-delay)
- **Binance**: satu koneksi combined stream memuat `@kline_<interval>` (bar) DAN `@aggTrade`/`@trade` — harga bergerak per **trade**, bukan menunggu update kline (1–2 dtk). Klien mengirim ping WS tiap 25 dtk; tanpa pesan/pong 75 dtk koneksi dianggap mati dan diisi ulang otomatis (sebelumnya 240 dtk).
- **TradingView**: koneksi tanpa pesan apa pun 45 dtk dianggap mati (sebelumnya 60 dtk). Setelah reconnect feed hanya mengunduh jendela bar seluas selisih waktu putus (+margin), bukan seluruh riwayat — data kembali mengalir dalam ~1 dtk, bukan berputar mengunduh ribuan bar.
- **MT5**: riwayat dikirim EA satu potongan per tick timer (v1.10), jadi kiriman live tidak terblokir selama riwayat panjang ditransfer — perbarui `MCDashBridge.mq5` di terminal agar manfaatnya penuh.
- **TPO snapshot**: jeda minimum antar perhitungan bawaan 0,5 dtk (`--interval`, sebelumnya 1 dtk); di perangkat lambat mesin tetap menyesuaikan otomatis (4× durasi perhitungan).

### Binance
Data publik, tanpa API key. Cukup isi `source.type` dan simbolnya:

```json
{ "general": { "symbol": "XAUUSDT" }, "source": { "type": "binance" } }
```
atau tanpa mengubah file: `mcdash --symbol XAUUSDT` (bila `source.type` sudah `binance`).
- `binance_market`: `"futures"` (bawaan, USDⓈ-M perpetual) atau `"spot"`. **XAUUSDT/XAGUSDT hanya ada di futures.** Kripto biasa (BTCUSDT dll.) ada di keduanya.
- Penulisan simbol bebas: `XAUUSDT`, `xauusdt`, `BINANCE:XAUUSDT.P`, `xau/usdt`.
- Riwayat lewat REST `klines` (mundur per 1000 bar sampai `history_bars`), live lewat WebSocket combined stream `@kline_<interval>` + `@aggTrade`/`@trade` (harga bergerak per trade); setelah koneksi putus bar yang terlewat diisi ulang otomatis. Point diambil dari `tickSize` (XAUUSDT = 0.01).
- Waktu bar Binance sudah UTC, jadi tidak ada deteksi zona waktu server. Pasar ini 24/7 (tanpa jeda akhir pekan), sama seperti kripto.
- Timeframe feed yang didukung: 1, 3, 5, 15, 30, 60 menit (dan 120/240/360/480/720/1440 bila `feed_tf` dipaksa).
- Bila Binance menolak IP/lokasi server (HTTP 451/403), dashboard menampilkan pesannya; pakai server di wilayah lain atau proxy. Alamat bisa dialihkan lewat env `MCDASH_BINANCE_REST` / `MCDASH_BINANCE_WS`.
- Uji tanpa internet: `python3 tools/mock_binance.py` lalu jalankan mcdash dengan kedua env di atas menunjuk ke mock.

### MetaTrader 5
1. Salin `mt5/MCDashBridge.mq5` ke `<Data Folder>/MQL5/Experts/`, compile di MetaEditor (F7).
2. MT5: *Tools → Options → Expert Advisors* → centang **Allow WebRequest for listed URL**, tambahkan alamat server (mis. `127.0.0.1`). Ini juga berlaku untuk socket.
3. Pasang EA di **satu** chart simbol yang ingin dipantau (timeframe chart bebas). Simbol, point, dan zona waktu diambil dari EA.
4. Server di komputer lain? Isi `mt5_listen` dengan `0.0.0.0:9899` dan `InpHost` di EA dengan IP server.

### Zona waktu server broker
Bar MT5 berlabel jam dinding **server broker**, dan MT5 tidak menyediakan offset historis. Tujuan dashboard ini: riwayat MT5 yang panjang dengan waktu yang adaptif otomatis seperti IANA di TradingView (`general.timezone` mengatur batas hari/sesi/minggu).
- **`"auto"` (bawaan):** offset server per pekan dideteksi dari data. Pasar FX/emas selalu buka kembali pada jam New York yang sama (mis. Minggu 17:00), jadi selisih jam buka itu terhadap waktu server = offset pekan tersebut. Tidak perlu tahu aturan DST broker (AS, Eropa, atau tetap), dan beda broker menghasilkan level yang sama. Pekan dengan pembukaan tertunda (libur) disaring, bukan dianggap pergantian DST. Log menulis `[mt5] zona waktu server: TERDETEKSI OTOMATIS ...` beserta daftar offset dan tanggal pergantiannya, jadi bisa diverifikasi. Tanpa jeda akhir pekan (kripto 24/7), atau bila jam/zona PC tempat MT5 berjalan salah, dipakai offset terukur saat ini dan log memberi peringatan.
- Override manual (jarang perlu): `"ny_close"` (server = New York + 7 jam) atau nama IANA (`"Europe/Athens"`, `"Etc/GMT-2"`). Konversi dilakukan per bar, dan log memperingatkan bila aturan tidak cocok dengan offset yang diukur EA.
- Keterbatasan `auto`: bila EA tersambung dalam seminggu setelah pergantian DST broker, data tidak bisa membedakannya dari satu pembukaan yang tertunda 1 jam; jam buka yang dipakai tercetak di log, dan hasilnya sembuh sendiri setelah 2 pekan.
- Memerlukan EA MCDashBridge terbaru (mengirim field `off`).

`mt5_symbol` opsional: bila diisi, hanya EA dengan simbol itu yang diterima. EA otomatis tersambung ulang.
Riwayat dibatasi *Max bars in chart* milik terminal MT5. Waktu bar dikonversi ke UTC oleh EA (offset server broker dibulatkan 15 menit).

Tanpa MT5, uji jembatan dengan simulator: `python3 tools/fake_ea.py --port 9899`.

## Membandingkan profil dengan platform lain (ATAS, Sierra, dst.)
Cetak isi satu profil per baris, lalu bandingkan dengan profil yang sama di platform lain:
```sh
./target/release/mcdash --config config.json --dump S-1    # S-1 = sesi selesai terakhir; D-now = hari berjalan; W-2 = minggu selesai ke-2 dari belakang
```
Keluarannya: High/Low, Open, ukuran baris, jumlah huruf, total TPO, POC/VAH/VAL, lalu tiap baris (harga pusat baris, jumlah TPO, tanda POC/VAH/VAL, huruf yang menyentuh baris itu). Urutan pemeriksaan:
1. **Samakan dulu** `ticks` (isi angka tetap, satuan point; `0` = otomatis dan berubah tiap periode), `timezone`, `start_hour`/`start_minute`, `tpo_min`.
2. **Jumlah TPO per baris sama?** Bila ya tetapi VAH/VAL beda → perbedaannya di aturan Value Area: coba `"va_method": "one_row"` (bawaan `"two_rows"`: 2 baris atas vs 2 baris bawah per langkah). Bila jumlah TPO per baris sudah beda → masalahnya di grid huruf/awal sesi/ukuran baris/data, bukan di VA.
3. **Level VAH/VAL (Pusat vs Tepi baris):** Atur `"va_bound": "center"` agar VAH dan VAL persis berada pada harga pusat baris (sesuai standar Sierra Chart dan ATAS). Nilai `"edge"` menggunakan tepi luar baris (pusat baris ± ½ tick). POC selalu pada harga pusat baris.
4. **Tie-breaker POC (`poc_rule`):** Bila ada distribusi ganda / bimodal dengan beberapa baris memiliki jumlah TPO terbanyak yang seri:
   - `"mid"` (bawaan): memilih POC yang paling dekat dengan harga tengah range (High+Low)/2.
   - `"close"`: memilih POC yang paling dekat dengan harga penutupan periode.
   - `"atas"` (gaya ATAS): memilih distribusi aktif terakhir di sesi lalu mengambil level harga terawal terbentuk (first-formed base level).
   - `"high"`: memilih baris tertinggi di antara yang seri.
   - `"low"`: memilih baris terendah di antara yang seri.
5. **Tie-breaker Value Area (`va_tie_break`):** Bila jumlah TPO 2 baris atas seri dengan 2 baris bawah pada metode `"two_rows"`:
   - `"up"` (bawaan lama): selalu mengambil sisi atas.
   - `"cbot"` (gaya CBOT / ATAS): membandingkan baris tunggal terdekat terlebih dahulu untuk menentukan arah ekspansi.
6. **Kondisi Berhenti VA (`va_stop`):**
   - `"ceil"` (bawaan CME): terus ekspansi sampai total TPO minimal mencapai atau melampaui `va_pct` (≥ 70%).
   - `"floor"` (gaya ATAS): berhenti sebelum `va_pct` terlampaui (< 70%).
   - `"closest"`: berhenti pada total persentase yang paling dekat dengan `va_pct`.

Bias "Open vs VA" = Open periode berjalan (open bar feed pertama periode itu) dibandingkan dengan VAH/VAL periode **sebelumnya** yang sudah selesai.

## Telegram
Salin `telegram.example.json` → `telegram.json`, isi `token` dan `chat_id` (atau env `TG_TOKEN`, `TG_CHAT_ID`).
Token tidak pernah dikirim ke browser. Pengaturan lain bisa diubah dari tombol **Telegram** di dashboard.
Isi pesan: bias lengkap (dasar · close terakhir · realtime) + level per profil. Pemicu: bias berubah (anti kedip) dan periode baru.

## Tes
```sh
cargo test --release     # golden test vs engine Python, paritas bias+Telegram vs TS lama, pemicu Telegram, parser TV
cd web && npm run typecheck   # tsc (atau: npm run typecheck:tsrs)
python3 tools/tv_compat_test.py target/release/mcdash web/dist   # klien TV Python vs Rust pada server tiruan yang sama
python3 reference/python/gen_golden.py crates/core/tests/golden  # membuat ulang kasus golden dari engine Python
```

## Catatan jujur
- `MCDashBridge.mq5` **belum dikompilasi/diuji di terminal MT5 sungguhan** (tidak ada MT5 di lingkungan pengembangan). Sisi server diuji lengkap dengan `fake_ea.py` yang berbicara protokol yang sama. Bila ada error kompilasi MQL5, kirim pesan errornya.
- Feed Binance diuji terhadap server tiruan (`tools/mock_binance.py`) dan parser dengan contoh format respons resmi; belum diuji ke server Binance asli di lingkungan pengembangan.
- Feed TradingView memakai protokol tidak resmi dan belum diuji ke server TradingView asli di lingkungan pengembangan; diuji terhadap server tiruan dan terbukti setara dengan klien Python lama.
- Perilaku lama yang sengaja dipertahankan: bila koneksi TradingView putus di tengah pengunduhan riwayat, riwayat berhenti di potongan pertama (5000 bar).
