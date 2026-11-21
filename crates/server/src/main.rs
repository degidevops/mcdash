mod app;
mod feed;
mod http;
mod notifier;
mod runner;

use app::{now_f, App, Shared};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::sync::broadcast;

const HELP: &str = "mcdash — dashboard TPO (Rust + TS)

  mcdash [opsi]
    --config <file>     config.json (default: config.json; dibuat otomatis bila belum ada)
    --host <alamat>     default 0.0.0.0 (pakai 127.0.0.1 agar hanya bisa diakses komputer ini)
    --port <n>          default 9898
    --web <folder>      folder hasil build klien (default: web/dist)
    --telegram <file>   default: telegram.json di folder yang sama dengan config
    --symbol <S>        timpa general.symbol (TradingView: OANDA:XAUUSD, Binance: XAUUSDT)
    --point <p>         timpa ukuran point
    --interval <detik>  jeda minimum antar perhitungan TPO (default 1.0)
    --text              cetak laporan teks tiap perhitungan
    --once              hitung sekali, cetak laporan teks, lalu keluar (tanpa web)
    --dump <profil>     cetak isi satu profil per baris (mis. S-1, D-now, W-1; angka = periode selesai ke-N dari belakang), lalu keluar
    --init-config       tulis config.json default lalu keluar
";

struct Args {
    config: String,
    host: String,
    port: u16,
    web: Option<String>,
    telegram: Option<String>,
    symbol: Option<String>,
    point: f64,
    interval: f64,
    text: bool,
    once: bool,
    init: bool,
    dump: Option<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut a = Args { config: "config.json".into(), host: "0.0.0.0".into(), port: 9898, web: None, telegram: None, symbol: None, point: 0.0, interval: 1.0, text: false, once: false, init: false, dump: None };
    let mut it = std::env::args().skip(1);
    while let Some(k) = it.next() {
        let mut val = |name: &str| it.next().ok_or(format!("{name} butuh nilai"));
        match k.as_str() {
            "--config" => a.config = val(&k)?,
            "--host" => a.host = val(&k)?,
            "--port" => a.port = val(&k)?.parse().map_err(|_| "--port harus angka")?,
            "--web" => a.web = Some(val(&k)?),
            "--telegram" => a.telegram = Some(val(&k)?),
            "--symbol" => a.symbol = Some(val(&k)?),
            "--point" => a.point = val(&k)?.parse().map_err(|_| "--point harus angka")?,
            "--interval" => a.interval = val(&k)?.parse().map_err(|_| "--interval harus angka")?,
            "--text" => a.text = true,
            "--once" => a.once = true,
            "--dump" => {
                a.dump = Some(val(&k)?);
                a.once = true;
            }
            "--init-config" => a.init = true,
            "-h" | "--help" => {
                print!("{HELP}");
                std::process::exit(0);
            }
            other => return Err(format!("opsi tidak dikenal: {other}\n\n{HELP}")),
        }
    }
    Ok(a)
}

fn resolve_web(arg: Option<String>) -> PathBuf {
    if let Some(w) = arg.or_else(|| std::env::var("MCDASH_WEB").ok()) {
        return PathBuf::from(w);
    }
    let cwd = PathBuf::from("web/dist");
    if cwd.join("index.html").exists() {
        return cwd;
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        for rel in ["web/dist", "../web/dist", "../../web/dist"] {
            let p = dir.join(rel);
            if p.join("index.html").exists() {
                return p;
            }
        }
    }
    cwd
}

#[tokio::main]
async fn main() {
    let a = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    if a.init {
        match mcdash_core::config::write_default(&a.config) {
            Ok(()) => println!("{} ditulis dengan nilai default.", a.config),
            Err(e) => {
                eprintln!("gagal menulis {}: {e}", a.config);
                std::process::exit(1);
            }
        }
        return;
    }
    let tg_path = a.telegram.clone().map(PathBuf::from).unwrap_or_else(|| {
        std::path::Path::new(&a.config).parent().map(|p| p.join("telegram.json")).unwrap_or_else(|| PathBuf::from("telegram.json"))
    });
    let web_dir = resolve_web(a.web.clone());
    let (tx, _) = broadcast::channel::<String>(512);
    let app = Arc::new(App { shared: RwLock::new(Shared::default()), tx, cfg_path: a.config.clone(), web_dir: web_dir.clone(), notifier: notifier::Notifier::new(tg_path) });
    let opts = runner::Opts { interval: a.interval, sym_override: a.symbol.clone(), pt_override: a.point, text: (a.text || a.once) && a.dump.is_none(), once: a.once, dump: a.dump.clone() };

    if a.once {
        // setara `mcdash.py --once`: hitung sekali lalu keluar, tanpa web
        match runner::run(app, opts).await {
            Ok(()) => {}
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        return;
    }

    if !web_dir.join("index.html").exists() {
        eprintln!("[web] {} belum berisi hasil build klien. Jalankan: cd web && npm install && npm run build", web_dir.display());
    }
    let mut runner_task = tokio::spawn(runner::run(app.clone(), opts));
    let a2 = app.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let (snap, ts) = {
                let sh = a2.shared.read().unwrap();
                (sh.snap.clone(), sh.meta.ts)
            };
            a2.notifier.tick(snap, ts).await;
        }
    });
    let addr = format!("{}:{}", a.host, a.port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("tidak bisa membuka {addr}: {e}");
            std::process::exit(1);
        }
    };
    println!("Dashboard: http://{}:{}   (mulai {:.0})", if a.host == "0.0.0.0" { "127.0.0.1" } else { &a.host }, a.port, now_f());
    let server = axum::serve(listener, http::router(app));
    tokio::select! {
        r = &mut runner_task => {
            match r {
                Ok(Err(e)) => { eprintln!("{e}"); std::process::exit(1); }
                Ok(Ok(())) => {}
                Err(e) => { eprintln!("runner berhenti: {e}"); std::process::exit(1); }
            }
        }
        r = server => { if let Err(e) = r { eprintln!("server berhenti: {e}"); } }
        _ = tokio::signal::ctrl_c() => println!("\nberhenti."),
    }
}
