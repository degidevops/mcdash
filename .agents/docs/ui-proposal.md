# MCDash Pro Chart — Spesifikasi UI (acuan: DeepCharts)

> Dokumen rancangan untuk perombakan menyeluruh UI `/chart`. Engine chart tetap milik sendiri
> (WebGL + Canvas 2D, TypeScript tanpa dependency). Fitur order flow (footprint dkk.) **ditunda**
> ke tahap berikutnya; lihat bagian 9.
>
> Status: **draf disetujui untuk dasar implementasi** — belum ada kode. Disusun 2026-11-25; keputusan hotkey,
> penyimpanan, dan tema sudah ditetapkan (bagian 11).

---

## 0. Cara membaca dokumen ini

DeepCharts closed source dan tidak bisa diakses langsung, jadi seluruh isi dibangun dari sumber publik.
Setiap butir diberi penanda keyakinan:

| Tanda | Arti |
|---|---|
| **[D]** | Terdokumentasi di sumber publik (bagian 1). Perilaku dianggap benar. |
| **[S]** | Terbaca dari screenshot yang diberikan pengguna. Tampilan saja, bukan perilaku. |
| **[I]** | Inferensi atau saran rancangan. Perlu keputusan atau verifikasi. |

Hal yang **tidak bisa** diketahui dari sumber publik: jarak/ukuran piksel, set ikon, font, animasi,
kasus tepi interaksi, dan perbedaan pasti web vs desktop. Bagian itu diisi dengan keputusan rancangan
sendiri ([I]) dan diperbaiki saat ada screenshot tambahan (bagian 11).

Ketentuan: yang ditiru adalah **tata letak dan perilaku fungsional**. Ikon, logo, nama merek
(Deep Print, Deep Sim, dst.), dan aset visual DeepCharts tidak disalin.

---

## 1. Sumber

| ID | Sumber | Dipakai untuk |
|---|---|---|
| S1 | DeepChart Web Overview — helpdesk.deepcharts.com/portal/en/kb/articles/deepchart-web-overview | Kerangka layar, toolbar, drawing, menu klik kanan, pengaturan, hotkey, bar profil |
| S2 | Price Chart – DeepCharts — helpdesk.deepcharts.com/portal/en/kb/articles/price-chart | Versi desktop: price settings, navigasi sumbu, mode kursor, drawing, template |
| S3 | DeepGamma Web – Platform Overview — helpdesk.deepcharts.com/portal/en/kb/articles/deepgamma-web-platform-overview | Menu bar, chart type, quick bar, tab chart, indikator (desain web yang sama) |
| S4 | Chart Window, Templates and Workspaces, Quick Chart Templates — deepcharts.com/helpcenter/article/… | Preset bawah, template vs workspace |
| S5 | How to Change the Layout of Indicators — deepcharts.com/helpcenter/article/how-to-change-the-layout-of-indicators | Model "chart area" untuk indikator |
| S6 | Deep Print (Footprint®) — deepcharts.com/helpcenter/article/deep-print | Struktur pengaturan footprint (bagian 9) |
| S7 | TradingView Charting Library docs: UI elements, Toolbars — tradingview.com/charting-library-docs | Acuan struktur cadangan |
| S8 | KLineChartQuant README — github.com/363045841/KLineChartQuant | Acuan arsitektur (state, aksi, Agent) |
| S9 | Screenshot DeepCharts dari pengguna (ES 5 Minute, desktop) | Tampilan |
| S10 | Ulasan proptradingvibes.com/blog/deepcharts-trading-platform | Pembeda versi web vs desktop |

Catatan: S1 dan S3 menjelaskan **versi web**; S2 dan S6 **versi desktop**. Screenshot S9 tampak seperti
desktop (preset bawah, strip DOM, ikon kiri atas). Perbedaan keduanya ditandai bila relevan.

---

## 2. Anatomi layar

Susunan target (diagram skema, bukan skala) — gabungan S9 dan S1/S3:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BAR ATAS     [simbol▾] [rentang▾] [timeframe▾]  [chart type] [ind] [prop] ...│  <- S1/S3/S9
├──┬───────────────────────────────────────────────────────────────────────┬───┤
│T │ O H L C  %V  ΣV  ΔV   (baris info bar di bawah kursor)               │ P │
│O │                                                                       │ R │
│O │                      AREA CHART  (panel harga)                        │ I │
│L │                                                                       │ C │
│B │                                                                       │ E │
│A │───────────────────── pemisah panel (bisa di-drag) ───────────────────│   │
│R │                      PANEL INDIKATOR (chart area 2..n)                │ S │
│  │                                                                       │ C │
│K │                                                                       │ A │
│I │                                                                       │ L │
│R ├───────────────────────────────────────────────────────────────────────┤ E │
│I │ SUMBU WAKTU                                              [timer bar]  │   │
├──┴───────────────────────────────────────────────────────────────────────┴───┤
│ BAR BAWAH   [Templates] (o)preset1 (o)preset2 ...            [toggle panel]  │  <- S4/S9
└──────────────────────────────────────────────────────────────────────────────┘
```

Strip DOM/trading di kanan pada S9 **tidak** diadopsi (mcdash tidak punya eksekusi; bagian 10).

---

## 3. Komponen

### 3.1 Bar atas (header)

[D] DeepChart Web memisahkan dua tingkat: **bar platform** (koneksi data, tema, pengaturan, bantuan) dan
**toolbar chart** (S1, S3). Desktop menaruh sebagian kontrol sebagai ikon kecil kiri atas: dua-candle
= price settings, grafik batang = indikator, kamera = screenshot (S2); [S] ketiganya cocok dengan baris
ikon kiri atas S9, tetapi pembacaan ikon sekecil itu adalah inferensi.

Isi toolbar chart yang akan dibangun:

| Kontrol | Perilaku | Sumber |
|---|---|---|
| Simbol | Dropdown + pencarian; mengganti instrumen | [D] S1, S3 |
| Timeframe | Dropdown/dialog; menetapkan durasi bar | [D] S1, S3 |
| Rentang data | Jumlah hari yang dimuat ("10D" pada S9). Padanan resmi: *Days to Load* di price settings (S2). Arti "BT" **tidak terdokumentasi** | [S]+[D], BT = tidak diketahui |
| Chart type | Candlestick, Line, OHLC (S3); gaya subgraph desktop: Line, Candlestick, OHLC, Hidden, Candlebody (S2) | [D] |
| Indicators | Membuka panel manajer indikator (3.9) | [D] |
| Property | Membuka dialog Price Settings (3.10) | [D] |
| Template | Simpan/muat setelan satu chart (3.11) | [D] |
| Watchlist | Daftar instrumen; klik memuat ke chart | [D] S1 |
| Sync | Menyamakan simbol antar chart tersambung; timeframe tetap per chart | [D] S1 |
| Workspace | Simpan/muat seluruh layar; ada indikator "Autosaved" | [D] S1 |
| Layout | Membagi jendela menjadi banyak chart | [D] |
| Full screen | Menyembunyikan chrome browser; Esc untuk keluar | [D] |
| Screenshot | Kamera; mode: simpan otomatis / dialog simpan / salin ke clipboard / keduanya | [D] S2 |
| Tema | Dark, Blue, Light, Deep Dark, Deep Light (web) | [D] S1 |
| Pengaturan platform | General (ukuran teks, "geser sumbu X dan Y saat drag chart"), HotKey | [D] S1, S3 |
| Bantuan | Diagnostik koneksi (status + ping), panduan, catatan rilis | [D] S1 |

[I] Untuk mcdash: Watchlist, Layout, dan Sync menyusul di UI-5; "diagnostik koneksi" cocok dengan
status sumber data yang sudah ada (`FeedEvent::Status`).

### 3.2 Tab chart

[D] Tiap chart adalah tab dengan label simbol + timeframe; tombol "+" menambah chart; ada pop-out ke
jendela baru; panel samping (T&S, trading) bisa dikunci ukurannya (S1, S3). Desktop punya dua mode:
**Compact** (tab) dan **Group** (daftar chart dalam satu panel) (S2).
[I] mcdash: mulai dari tab saja; pop-out lewat `window.open` ke `/chart?id=…`.

### 3.3 Toolbar gambar (kiri)

[D] Urutan fungsi (S1): **Kursor/Crosshair/Hand → Drawing tools → Tampil/Sembunyi gambar → Magnet →
Eraser → Chart trading ($) → Riwayat trade**. Desktop menambah **Zoom Range**, **Zoom Out**,
**Global Viewfinder**, dan **Crosshair Window** (S2).
[S] Pada S9 toolbar hanya berisi ikon, sempit, dengan satu ikon aktif disorot warna hijau.

Item $ dan riwayat trade tidak diadopsi. [I] Tambahan: tombol **Object Tree** (lihat 3.9).

### 3.4 Area chart dan elemen overlay

| Elemen | Perilaku | Sumber |
|---|---|---|
| Baris info bar | O/H/L/C bar di bawah kursor; bila bar live, bar terakhir. Juga %V (variasi), ΣV (volume), ΔV (delta) | [D] S1; [S] S9 |
| Kotak ask/bid | Dua kotak hijau/ungu menunjukkan harga ask dan bid saat ini | [D] S1 |
| Garis harga sekarang | Aktif/nonaktif, warna, gaya, tebal; opsi "perpanjang ke kiri" | [D] S2 |
| Label harga terakhir | Penanda di sumbu harga (kotak berwarna) | [D] S2; [S] |
| Countdown bar | Kotak waktu sampai bar tutup; **bisa diseret** ke posisi lain | [D] S2 |
| % Var | Kotak variasi persen dari penutupan sesi lalu; bisa diseret; warna terpisah positif/negatif | [D] S2 |
| Garis awal sesi | Garis vertikal di awal sesi; warna/gaya/tebal diatur | [D] S2 |
| Sesi kustom | Sorot jam sesi tertentu (zona waktu bursa), mis. sesi kas | [D] S2 |
| Lebar candle ∝ volume | Opsional; lebar candle mengikuti volume bar | [D] S2 |
| Warna candle ∝ delta | Opsional; butuh data delta (tahap order flow) | [D] S2 |

[I] Info baris: ΣV memakai volume bar; ΔV **kosong** sampai ada data trade (tahap order flow).

### 3.5 Sumbu dan navigasi

**Sumbu X** [D] S2:
- Scroll mouse atau drag pada sumbu waktu menggeser waktu.
- Klik kanan sumbu → **Auto Scroll** (harga maju mengikuti bar baru).
- Klik dua kali (atau tombol play kanan bawah) → kembali ke bar terbaru.

**Sumbu Y** [D] S2 — tiga mode yang dipilih lewat klik kanan:
1. *Automatic detection*: drag di area chart pada sumbu menggeser; drag di area label harga mengubah skala.
2. *Move axis range*: drag di mana pun pada sumbu menggeser naik-turun.
3. *Resize axis range*: drag di mana pun pada sumbu mengubah rentang harga.
Plus **Auto Scroll** sumbu Y (sumbu mengikuti harga bila keluar dari tampilan).

Pengaturan platform [D] S1/S3: "Move X and Y axes on chart drag" (aktif secara default pada S3).

[I] mcdash sudah punya Y-drag dan auto-follow (Phase 2); disatukan ke tiga mode di atas dan dijadikan opsi.

### 3.6 Mode kursor

[D] S1/S2:

| Mode | Fungsi | Hotkey default |
|---|---|---|
| Pointer | Memilih objek (default) | Alt+P |
| Crosshair ("Scope") | Garis silang dengan label harga/waktu | Alt+C |
| Global Viewfinder | Crosshair muncul serempak di semua chart yang menampilkan instrumen sama | — |
| Hand | Menggeser chart ke segala arah | Alt+H |
| Zoom Range | Klik awal dan klik akhir untuk memperbesar bagian itu | Alt+R |
| Zoom Out | Mengembalikan zoom range | — |
| Crosshair Window | Jendela detail: OHLC, ΣV, Σ trades bar di bawah crosshair | — |

### 3.7 Drawing

**Daftar tool** [D] S1/S2/S3: Horizontal Line, Vertical Line, Horizontal Ray, Line, Parallel Lines,
Rectangle, Ellipse, Text, Fibo Retracement, Fibo Projection, Fibo Fan ("Price Fan"), Volume Profile
(rentang gambar sendiri), VWAP Anchored, Buy Calculator, Sell Calculator, Counter, Ruler.
Yang diadopsi: semua kecuali Buy/Sell Calculator (terkait trading). [I] Tambahan: Arrow, Price Label.

**Interaksi** [D] S1/S2:
- Dibuka dari toolbar kiri **atau** klik kanan → Drawing Tools (daftar sama).
- Klik objek untuk memilihnya; klik kanan → Settings/Property; **klik dua kali** juga membuka pengaturan.
- Pengaturan warna/gaya; bisa **disimpan sebagai preset** lalu dipanggil lewat klik kanan → *Tool Config*.
- Impor/ekspor anotasi ke file; bawa gambar dari chart lain.
- Magnet/**Snap** (Ctrl+S) menempelkan titik ke harga terdekat.
- Show/Hide semua gambar; Erase semua (Ctrl+Delete).
- Alert pada objek gambar [D] disebut ada di S2; detailnya tidak terdokumentasi → ditunda.

**Hotkey tool** [D] S1/S3: Line Shift+L, Horizontal Shift+H, Parallel Shift+P, Rectangle Shift+R,
Volume Profile Shift+V, Text Shift+T, Fibo Shift+F, Calculator Buy/Sell Shift+B/S. Tool lain (Ray, Vertical,
Fibo Projection, Fibo Fan, VWAP, Ruler) tanpa default tapi bisa diberi hotkey sendiri.

**Keputusan mcdash:** hotkey bawaan **mengikuti DeepCharts** (Alt+P/C/H/R untuk kursor, Shift+huruf untuk tool,
Ctrl+S/Ctrl+I/Ctrl+P/Ctrl+Delete untuk aksi umum) dan tetap bisa diubah lewat editor hotkey (Record/Clear,
lihat [D] S1/S3). Konsekuensinya:
- Tombol tunggal lama (`T`, `H`, `F`, `R`, `P`, `C`) **dilepas** dari tool/kursor. Fungsi lama yang tidak ada padanannya di
  DeepCharts (mis. toggle TPO overlay yang dulu di `P`) dipindah ke kombinasi baru yang dipilih saat UI-1, dan dicatat di
  registry aksi agar tidak bentrok.
- Pintasan timeframe `1`–`6` dipertahankan: DeepCharts tidak punya pintasan yang bertabrakan dengan angka. [I]
- Saat migrasi, pengguna melihat daftar pintasan lama→baru satu kali (dialog ringkas) agar tidak bingung. [I]

### 3.8 Menu klik kanan

[D] S1/S3 — satu menu cepat berisi, berurutan: Pointer / Crosshair / Hand → Drawing Tools (submenu)
→ Show/hide annotations → Snap (Ctrl+S) → Erase all (Ctrl+Delete) → [trading: diabaikan] →
Indicators (Ctrl+I) → Price Settings → Property (Ctrl+P). Desktop menambah submenu **Template**
(Save As / Load) dan **Rebuild Chart** (muat ulang chart) (S2).
[I] Menu klik kanan pada sumbu (3.5) dan pada objek gambar (3.7) adalah menu terpisah berbasis konteks.

### 3.9 Indikator dan "chart area"

**Panel manajer** [D] S2/S3:
- Daftar indikator aktif dengan tombol hapus (tempat sampah), sembunyikan (mata), pengaturan (roda gigi).
- Tombol "Add indicator" membuka daftar bertab: *All*, *Technical analysis*, *Volumes* (S1) plus pencarian.
- Urutan indikator bisa diubah dengan drag (ikon tiga garis).

**Model chart area** [D] S5 — ini inti tata letak panel:
- Jendela dibagi menjadi beberapa **chart area** menurut jumlah indikator: satu untuk harga, satu per indikator.
- Setiap indikator memiliki **nomor area**; mengubah nomor memindahkan indikator ke area lain.
- Dua indikator dengan nomor sama **digabung** dalam satu area (contoh: Price + Moving Average di area 1).
- Batas antar area bisa di-drag untuk mengubah tinggi (S2).

[I] Rancangan mcdash: area = `PaneId` (0 = harga). Indikator punya `pane: number | 'new'`. Object tree (acuan
TradingView, S7) menampilkan pohon: Pane → objek (seri, indikator, gambar) dengan aksi tampil/sembunyi/hapus/urutan.

### 3.10 Dialog Price Settings (Property)

[D] S2/S3. Grup dan isi:

- **General** (desktop): Days to Load; tipe parameter bar (Minute/Second/Daily/Weekly/Monthly; tipe non-waktu seperti
  Range, Volume, Trades, Renko, Delta, Vol bars, Point & Figure butuh data tick → **ditunda**, bagian 9);
  Param 1/2; opsi kontrak berkelanjutan (rollover); kecualikan sesi lelang.
- **Volume/Delta**: lebar candle ∝ volume (+ % lebar maksimum); warna ∝ delta.
- **Price Line**, **Countdown**, **% Var**, **Line Start Day**, **Custom Time Session** (lihat 3.4).
- **General (tampilan)**: warna latar, warna border, ukuran teks, warna teks, warna harga terakhir.
- **Grid**: aktif/nonaktif, warna, gaya (titik-titik secara default pada web).
- **Subgraphs**: gaya candle dan label nilai (penanda harga terakhir).
- Tombol **Save** menerapkan perubahan; desktop menambah **Save/Load template** di dialog yang sama.

[I] Dialog = form generik yang dihasilkan dari skema (`SettingsSchema`), supaya dialog drawing dan indikator
memakai komponen yang sama.

### 3.11 Template dan Workspace

[D] S4:
- **Template** = satu chart: indikator, gaya, pengaturan. Disimpan/dimuat lewat klik kanan → Template atau tombol
  *Templates* di bar bawah. Picker memiliki tab sumber **Local / Cloud / Shared** dengan pratinjau.
- **Workspace** = seluruh layar: banyak chart, tab, indikator, profil. Dikelola dari panel workspace; lokal atau cloud.
- Pada versi desktop, tata letak **tidak disimpan otomatis**; versi web menampilkan status *Autosaved* (S1).

**Keputusan mcdash:** `Template` dan `Workspace` berupa JSON bertipe, disimpan di **`localStorage`** terlebih dahulu
(kunci ber-versi, mis. `mcdash.workspace.v1`, dengan `try/catch` dan cadangan bila penyimpanan kosong). Autosave bawaan.
Penyimpanan ke server (`/api/chart-workspace`) **tidak** dikerjakan sekarang; antarmuka penyimpanan dibuat sebagai
`WorkspaceStore` (`get/set/list/remove`) supaya backend server nanti cukup implementasi baru tanpa mengubah UI. Konsekuensi yang
perlu diketahui: workspace tidak tersinkron antar perangkat (PC ↔ Android) sampai backend server dibuat, dan ekspor/impor
berkas JSON disediakan sebagai jalan pindah manual. [I]

### 3.12 Bar bawah — preset cepat

[D] S4: tombol *Templates* + **deretan radio** yang sekali klik menerapkan layout lengkap. Isi di DeepCharts:
OF-VP, OF-B/A, D-VP, D-DP, D-VL, W-VP, W-DP, C-VP (+ D-VW pada web). Preset bersifat **bawaan dan tetap**, berbeda
dari template pengguna. [S] S9 menampilkan labelnya: *Order Flow – Vol. Profile, Order Flow – Bid/Ask, Dly Vol.
Profile, Dly Delta Profile, Dly Profile Values, Wkly Vol. Profile, Wkly Delta Profile, Comp. Vol. Profile*.

[I] mcdash — bar yang sama, isi berbeda per tahap:
- Tahap sekarang: **TPO Harian**, **TPO Mingguan**, **TPO Sesi**, **TPO Komposit**, **VWAP Harian**, **Level (POC/VAH/VAL)**.
- Tahap order flow: tambah preset Footprint dan Volume/Delta Profile (bagian 9).

---

## 4. Tampilan (token visual)

[S] dari S9, **perkiraan** — ambil nilai pasti dengan color picker saat implementasi:

| Token | Perkiraan | Catatan |
|---|---|---|
| `--bg` | hampir hitam (≈ `#161616`–`#1b1b1b`) | Lebih gelap dari tema #131722 yang dipakai chart sekarang |
| `--bull` | hijau terang | Lebih cerah dari teal `#26A69A` yang ada |
| `--bear` | **ungu**, bukan merah | Pola warna khas; konsisten dengan kotak bid ungu dan hari rugi ungu pada laporan [D] S1 |
| `--axis-label` | abu terang, teks kecil | Label sumbu harga di kanan, waktu di bawah |
| `--price-tag` | ungu, kotak pada sumbu | Label harga terakhir |
| `--toolbar-icon` | abu sedang; aktif = hijau | Ikon aktif berlatar hijau pada S9 |
| `--panel` | sedikit lebih terang dari `--bg` | Bar atas/bawah |

[D] Tema yang ada pada web: Dark, Blue, Light, Deep Dark, Deep Light (S1). **Keputusan mcdash:** tema bawaan **tetap tema sekarang**; skema hijau/ungu ala DeepCharts dibuat sebagai **tema terpisah** (mis. nama
"Deep") yang dipilih lewat pengaturan tema. Seluruh warna lewat CSS variable; tema awal: Dark (sekarang), Deep (S9), Light.
Skema candle (bull/bear) menjadi pengaturan sendiri di dalam tema, sehingga bisa dicampur. [I]

---

## 5. Arsitektur implementasi (acuan: KLineChartQuant, bukan engine-nya)

[D] S8: Agent diperlakukan setara dengan pengguna; tool adalah **himpunan bagian dari aksi** dengan satu state dan satu
jalur eksekusi, tanpa lapisan jembatan; state kernel tunggal (hanya aksi yang menulis, nilai turunan otomatis,
konsumen luar hanya membaca).

Rancangan mcdash (TS murni, tanpa dependency):

```
web/src/chart/
  kernel/        signal(), computed(), effect(), batch()      # ±100–200 baris
  state/         ChartState  (symbol, tf, chartType, viewport, cursorMode, theme, settings,
                              panes[], indicators[], drawings[], selection, ...)
  actions/       registry.ts + <domain>.ts                    # satu-satunya jalur menulis state
  layers/        registry.ts  (candles, volume, grid, tpo, drawings, crosshair, ...)  # z-order
  ui/            toolbar-top, toolbar-left, toolbar-bottom, tabs, dialogs, context-menu, object-tree
  persist/       template.ts, workspace.ts
  agent/         tools.ts (turunan registry), client.ts (WS)
```

**Aksi** — satu definisi, tiga pemakai (tombol UI, hotkey, Agent):

```ts
interface ActionDef<A = unknown> {
  id: string;                 // mis. 'drawing.create'
  title: string;              // untuk menu / hotkey editor
  schema: JsonSchema;         // validasi argumen + deklarasi tool Agent
  hotkey?: string;            // default, bisa diubah pengguna
  run(state: ChartState, args: A): void | (() => void);  // mengembalikan undo
  agent?: boolean;            // tampil sebagai tool Agent (default true bila aman)
}
```

Aturan:
1. UI **tidak** menulis state langsung; ia memanggil `dispatch(id, args)`.
2. Setiap aksi yang mengubah tampilan mengembalikan fungsi **undo** (riwayat undo/redo bersama).
3. Daftar tool Agent = turunan otomatis dari registry (tidak ada daftar kedua yang bisa melenceng).
4. Hotkey, menu klik kanan, dan palet perintah dibaca dari registry yang sama.

**Layer** — lapisan pewarna (candle, volume, grid, TPO, gambar, crosshair) didaftarkan dengan z-order; fitur baru berupa
layer baru, bukan tambahan di `app.ts`. [I] Sesuai pola Scene/Layer di S8.

**Agent** [I]: pemanggilan LLM terjadi di **server Rust** (kunci API tidak dikirim ke browser, sama seperti token Telegram).
Browser mengirim teks lewat WebSocket; server membalas dengan perintah aksi (`{id, args}`) yang dijalankan
`dispatch` di klien. Karena mcdash tidak punya eksekusi order, jangkauan Agent hanya aksi chart, dan setiap aksi bisa di-undo.

---

## 6. Kesenjangan terhadap mcdash saat ini

Berdasarkan `CLAUDE.md` dan struktur `web/src/chart/` (belum diverifikasi ke seluruh isi `app.ts`, ±77 KB):

| Area | Sudah ada | Kurang |
|---|---|---|
| Chart | Candle+volume WebGL, grid, crosshair, TPO overlay, multi-TF, multi-source | Chart type lain (line/OHLC/candlebody), lebar candle ∝ volume |
| Navigasi | Pan/zoom, Y-drag, auto-follow | Tiga mode sumbu Y, auto-scroll per sumbu, klik dua kali ke bar terbaru, Zoom Range/Zoom Out |
| Kursor | Crosshair | Mode Pointer/Crosshair/Hand, Global Viewfinder, Crosshair Window |
| Drawing | Trendline, HLine, Fib, Rectangle | Ray, Vertical, Parallel, Ellipse, Text, Fib Projection/Fan, Ruler, Volume Profile, VWAP Anchored; magnet; show/hide; erase; dialog pengaturan; preset *Tool Config*; impor/ekspor |
| Indikator | — (TPO/level saja) | Panel manajer, area/pane, drag antar pane, object tree |
| Pengaturan | `settings.ts` | Dialog Price Settings lengkap, Hotkey editor, tema |
| Penyimpanan | localStorage (drawing, sumber) | Template, Workspace, autosave, sinkron server |
| Layout | Satu chart | Tab, multi-chart, Sync, pop-out |
| Bar bawah | — | Preset cepat |
| Info | Info box OHLCV | Baris info (ΣV, ΔV), kotak countdown/%Var yang bisa diseret, garis awal sesi |
| Arsitektur | `app.ts` monolitik | Kernel + registry aksi + registry layer |

---

## 7. Fase implementasi

| Fase | Isi | Kriteria selesai |
|---|---|---|
| **UI-0** | Kernel (signal), `ChartState`, registry aksi, undo/redo, tes unit | Semua perubahan state lewat `dispatch`; tes: undo/redo, validasi skema |
| **UI-1** | Shell: bar atas, toolbar kiri, bar bawah, tab, tema (Dark, Deep, Light) + CSS variable; pindahkan kontrol lama ke registry; pemetaan hotkey baru (ikut DeepCharts) + dialog migrasi | Tampilan tema Deep setara S9; tidak ada regresi fungsi lama; tiap fungsi lama punya pintasan baru tanpa bentrok |
| **UI-2** | Mode kursor, perilaku sumbu X/Y (3.5), zoom range, klik dua kali ke terbaru, menu klik kanan | Semua perilaku 3.5/3.6/3.8 lulus daftar periksa manual |
| **UI-3** | Sistem drawing: daftar tool lengkap, pemilihan/edit, dialog pengaturan, preset konfigurasi, magnet, show/hide, ekspor/impor, hotkey editor | Tiap tool dapat dibuat, dipilih, diubah, dihapus, di-undo, dan bertahan saat muat ulang |
| **UI-4** | Refactor `app.ts` menjadi registry layer; panel indikator + pane (area) + object tree | Indikator dapat dipindah/digabung antar pane; tinggi pane bisa di-drag |
| **UI-5** | Price Settings lengkap, Template, Workspace (+autosave di `localStorage`, `WorkspaceStore` siap diganti server), multi-chart (Layout, Sync, Global Viewfinder), ekspor/impor JSON | Workspace dipulihkan persis setelah muat ulang di perangkat yang sama; berkas ekspor bisa diimpor di perangkat lain |
| **UI-6** | Bar preset bawah (TPO/VWAP/level), palet perintah | Satu klik menerapkan layout lengkap; preset tidak menimpa template pengguna |
| **UI-7** | Agent: endpoint WS di server, panel chat, tool dari registry | Perintah bahasa natural → aksi chart yang bisa di-undo; tidak ada aksi di luar registry |

Urutan UI-0 → UI-1 wajib; UI-2..UI-5 bisa diurut ulang menurut prioritas.

---

## 8. Di luar cakupan

- Seluruh bagian **trading** DeepCharts: strip DOM di chart, panel order, Deep Sim (akun simulasi), pengelola risiko,
  trade copier, riwayat trade pada chart, tab Accounts/Report. mcdash tidak punya eksekusi.
- Replay/backtest tick. (DeepCharts web sendiri menyatakan replay belum tersedia, S1.)
- Indikator proprietari DeepCharts dan model analisis miliknya.
- Cloud/Shared template pada skala banyak pengguna (mcdash pengguna tunggal).

---

## 9. Ditunda: tahap order flow

Disimpan di sini agar kerangka UI sekarang tidak perlu dirombak nanti.

**Prasyarat data** [I]: `FeedEvent` saat ini tidak memiliki event trade (hanya `History`, `Live`, `Price`).
Footprint butuh event trade dengan sisi agresor, agregator per (bar, level harga), dan backfill riwayat trade.
Binance XAUUSDT memberi data ini; tick CFD MT5 umumnya tanpa sisi agresor. DeepCharts web sendiri menyatakan
data CFD **tanpa volume** [D] S1, jadi delta pada XAUUSD MT5 hanya aproksimasi.

**Struktur pengaturan footprint** [D] S6 (acuan untuk dialog nanti, memanfaatkan form berbasis skema dari 3.10):
- *Typology*: tipe isi sel (Volume, Ask/Bid Split, Delta, Delta+Volume) dan mode (Profile = histogram, Box = kotak).
- *Data*: sumber input (volume, agregat, order book, jumlah trade); filter min/maks.
- *Tick grouping*: otomatis/manual, faktor, mode tetap atau berdasar open/close.
- *Plot*: lebar penanda, gaya bar (Bar/Body), perataan, tepi luar; latar (mode warna: None/Fixed/Fading/More Colors; dasar
  perhitungan warna: Volume, Delta, Imbalance, Dominant Volume, Dominant Volume Delta); border, opacity; teks (ukuran,
  format Automatic/Normal/K, ukuran dinamis, tampilkan nol).
- *Imbalance*: ambang selisih volume minimum, sertakan nol, warnai sisi dominan saja.
- Blok opsional: **POC** (volume dan delta, dengan minimum delta), **Value Area** (% dan sorotan), **Single Print**,
  **Ratio** bid/ask, **Vol Cluster**, **Pull Back**, **alert** (suara, pesan, volume minimum).
- **Multi-kolom**: sampai empat footprint berdampingan dalam satu bar, masing-masing dikonfigurasi sendiri.

**Empat mode tampilan** footprint yang diganti sekali klik: Classic, Orderflow Profile, Delta Profile, Big Trades [D].
Bar preset (3.12) dan jenis bar non-waktu (Range, Volume, Trades, Renko, Delta, Vol bars, P&F) menunggu data tick.

---

## 10. Risiko dan batasan

| Risiko | Mitigasi |
|---|---|
| Tampilan tidak mirip karena hanya mengandalkan dokumentasi dan satu screenshot | Kumpulkan screenshot per keadaan (bagian 11); sampling warna dari gambar asli |
| Perilaku web ≠ desktop pada beberapa hal | Dokumen menandai sumber; keputusan akhir mengikuti kebutuhan mcdash |
| Refactor `app.ts` memecah fitur lama | UI-1 memindahkan fungsi lama ke registry **sebelum** menambah fitur; tes regresi manual per fase |
| Pelanggaran kekayaan intelektual | Tidak menyalin ikon/logo/nama merek; hanya tata letak fungsional |
| Agent memanggil aksi tak diinginkan | Hanya aksi registry; skema divalidasi; semua bisa di-undo; panggilan LLM di server |

---

## 11. Keputusan dan data tambahan

**Keputusan yang sudah ditetapkan (2026-11-25):**

| # | Keputusan | Dampak pada dokumen |
|---|---|---|
| 1 | Hotkey bawaan **mengikuti DeepCharts** | 3.7, UI-1, Lampiran A |
| 2 | Workspace/template disimpan di **`localStorage`** dulu | 3.11, UI-5 |
| 3 | Hijau/ungu ala DeepCharts sebagai **tema terpisah**, bukan default | 4, UI-1 |

**Yang masih terbuka:**
- Kombinasi tombol baru untuk fungsi lama yang tidak ada padanannya di DeepCharts (toggle TPO overlay, dsb.) — dipilih saat UI-1.
- Nama tema ("Deep") dan apakah tema Light dikerjakan di UI-1 atau ditunda.

**Screenshot yang paling membantu** (tiap keadaan, bukan hanya layar penuh):
- Menu klik kanan di area chart, di sumbu Y, dan di sebuah objek gambar.
- Dialog daftar indikator dan dialog pengaturan satu indikator.
- Dialog pengaturan drawing (mis. Fibo atau Rectangle).
- Dialog Price Settings.
- Picker Template (Local/Cloud/Shared) dan panel Workspace.
- Toolbar kiri dengan submenu Drawing Tools terbuka.

Sumber publik tidak menjangkau bagian-bagian ini secara visual; dokumen akan diperbarui bila ada tambahan.

---

## Lampiran A — Daftar awal aksi (registry)

| ID | Keterangan | Hotkey (default) | Agent |
|---|---|---|---|
| `chart.setSymbol` | Ganti simbol/sumber | — | ya |
| `chart.setTimeframe` | Ganti timeframe | `1`–`6` (dipertahankan) | ya |
| `chart.setType` | Candle / Line / OHLC / Candlebody | — | ya |
| `view.scrollToLatest` | Kembali ke bar terbaru | Home | ya |
| `view.setAutoScroll` | Auto-scroll X / Y | — | ya |
| `view.zoomRange` / `view.zoomOut` | Zoom rentang | Alt+R | ya |
| `view.setAxisMode` | Deteksi otomatis / geser / skala | — | ya |
| `cursor.setMode` | Pointer / Crosshair / Hand | Alt+P / C / H | ya |
| `drawing.create` | Buat objek (jenis + titik + gaya) | Shift+L/H/P/R/V/T/F (lihat 3.7) | ya |
| `drawing.update` / `drawing.delete` | Ubah/hapus | Delete | ya |
| `drawing.setVisible` / `drawing.clear` | Tampil-sembunyi / hapus semua | Ctrl+Delete | ya |
| `drawing.setMagnet` | Snap ke harga | Ctrl+S | ya |
| `drawing.saveToolConfig` / `drawing.applyToolConfig` | Preset gaya | — | ya |
| `indicator.add` / `indicator.remove` | Tambah/hapus | Ctrl+I | ya |
| `indicator.setVisible` / `indicator.setPane` / `indicator.update` | Tampil, pindah pane, ubah setelan | — | ya |
| `settings.update` | Price settings (grid, garis harga, countdown, …) | Ctrl+P | ya |
| `theme.set` | Tema | — | ya |
| `template.save` / `template.load` | Satu chart | — | ya |
| `workspace.save` / `workspace.load` | Seluruh layar | — | ya |
| `layout.set` / `sync.set` | Multi-chart | — | ya |
| `preset.apply` | Preset bar bawah | — | ya |
| `screenshot.take` | Tangkap layar | — | tidak |
| `history.undo` / `history.redo` | Undo/redo | Ctrl+Z / Ctrl+Shift+Z | tidak |

---

*Akhir dokumen. Setelah ditinjau, lokasi yang disarankan: `.agents/docs/ui-proposal.md` (berdampingan dengan `chart-proposal.md`).*
