//! Sumber data. Setiap sumber hanya mengirim FeedEvent ke runner; engine TPO tidak tahu asal datanya.
pub mod binance;
pub mod mt5;
pub mod tradingview;

use mcdash_core::{Bar, Bars};
use tokio::sync::mpsc;

#[derive(Debug)]
pub enum FeedEvent {
    /// Riwayat lengkap satu timeframe sudah diterima.
    History { tf: i64, bars: Bars, point: Option<f64> },
    /// Bar baru/terupdate (setelah riwayat selesai).
    Live { tf: i64, bars: Vec<(i64, Bar)> },
    /// Harga cepat dari sumber (mis. bid MT5), tanpa menunggu bar.
    Price { price: f64 },
    /// EA/klien terhubung dengan simbol tertentu (state sebelumnya harus dibuang).
    Hello { symbol: String, point: Option<f64> },
    /// Teks status sumber (mis. "EA terputus").
    Status { text: Option<String> },
    /// Feed berhenti karena error fatal (runner mencoba lagi nanti).
    Died { tf: i64, error: String },
}

/// (id feed, event). Runner mengabaikan event dari feed yang sudah tidak aktif.
pub type Tx = mpsc::UnboundedSender<(u64, FeedEvent)>;
