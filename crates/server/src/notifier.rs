//! Telegram: pengiriman HTTP + berkas telegram.json. Semua keputusan kapan/apa yang dikirim ada di mcdash_core::telegram.
use crate::app::now_f;
use mcdash_core::telegram::{build_messages, sanitize, TgSettings, Trigger};
use mcdash_core::Snap;
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

const SECRET: [&str; 2] = ["token", "chat_id"];

struct Inner {
    raw: Value,
    mtime: Option<SystemTime>,
    settings: TgSettings,
    trigger: Trigger,
    sent: u64,
    last_at: Option<String>,
    last_reason: Option<String>,
    last_error: Option<String>,
}

pub struct Notifier {
    file: PathBuf,
    inner: Mutex<Inner>,
}

fn log(m: &str) {
    println!("[telegram] {m}");
}

impl Notifier {
    pub fn new(file: PathBuf) -> Notifier {
        Notifier {
            file,
            inner: Mutex::new(Inner { raw: json!({}), mtime: None, settings: TgSettings::default(), trigger: Trigger::new(), sent: 0, last_at: None, last_reason: None, last_error: None }),
        }
    }

    fn reload(&self, g: &mut Inner) {
        let Ok(meta) = std::fs::metadata(&self.file) else {
            g.raw = json!({});
            g.mtime = None;
            g.settings = TgSettings::default();
            return;
        };
        let mt = meta.modified().ok();
        if mt == g.mtime && g.mtime.is_some() {
            return;
        }
        g.mtime = mt;
        let res = std::fs::read_to_string(&self.file)
            .map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str::<Value>(&s).map_err(|e| e.to_string()))
            .and_then(|raw| sanitize(&raw).map(|s| (raw, s)));
        match res {
            Ok((raw, s)) => {
                g.raw = raw;
                g.settings = s;
                g.last_error = None;
            }
            Err(e) => {
                g.last_error = Some(format!("telegram.json ditolak: {e}"));
                log(g.last_error.as_deref().unwrap());
            }
        }
    }

    fn creds(g: &Inner) -> Option<(String, String)> {
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let token = env("TG_TOKEN").or_else(|| g.raw["token"].as_str().map(String::from)).unwrap_or_default();
        let chat = env("TG_CHAT_ID")
            .or_else(|| match &g.raw["chat_id"] { Value::String(s) => Some(s.clone()), Value::Number(n) => Some(n.to_string()), _ => None })
            .unwrap_or_default();
        if token.is_empty() || chat.is_empty() || token.starts_with("123456:ABC") || token == "ISI_TOKEN_BOT" {
            None
        } else {
            Some((token, chat))
        }
    }

    pub fn status(&self) -> Value {
        let mut g = self.inner.lock().unwrap();
        self.reload(&mut g);
        let c = Self::creds(&g);
        json!({
            "configured": c.is_some(), "enabled": g.settings.enabled,
            "chat": c.as_ref().map(|(_, chat)| { let t: Vec<char> = chat.chars().collect(); format!("…{}", t[t.len().saturating_sub(4)..].iter().collect::<String>()) }),
            "sent": g.sent, "last_sent": g.last_at, "last_reason": g.last_reason, "last_error": g.last_error, "settings": g.settings.to_json()
        })
    }

    pub fn save_settings(&self, body: &str) -> Result<(), String> {
        let incoming: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
        let next = sanitize(&incoming)?; // gagal bila tidak valid
        let mut g = self.inner.lock().unwrap();
        self.reload(&mut g);
        let mut out = Map::new();
        if let Some(o) = g.raw.as_object() {
            for (k, v) in o {
                if SECRET.contains(&k.as_str()) || k.starts_with('_') {
                    out.insert(k.clone(), v.clone()); // pertahankan token/chat_id/_help
                }
            }
        }
        if let Some(o) = next.to_json().as_object() {
            for (k, v) in o {
                out.insert(k.clone(), v.clone());
            }
        }
        let tmp = format!("{}.tmp", self.file.display());
        std::fs::write(&tmp, serde_json::to_string_pretty(&Value::Object(out)).unwrap()).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.file).map_err(|e| e.to_string())?;
        g.mtime = None;
        self.reload(&mut g);
        Ok(())
    }

    fn mark(g: &mut Inner, reason: &str) {
        g.sent += 1;
        g.last_at = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
        g.last_reason = Some(reason.to_string());
        g.last_error = None;
    }

    async fn deliver(creds: Option<(String, String)>, texts: Vec<String>) -> Result<(), String> {
        let (token, chat) = creds.ok_or("token / chat_id belum diisi (telegram.json atau env TG_TOKEN, TG_CHAT_ID)")?;
        tokio::task::spawn_blocking(move || {
            for t in texts {
                send_text(&token, &chat, &t, true)?;
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    pub async fn send_manual(&self, snap: Option<Snap>) -> Result<(), String> {
        let snap = snap.ok_or("belum ada data dari engine")?;
        let (creds, settings) = {
            let mut g = self.inner.lock().unwrap();
            self.reload(&mut g);
            (Self::creds(&g), g.settings.clone())
        };
        Self::deliver(creds, build_messages(&snap, &settings, &["Manual".to_string()])).await?;
        Self::mark(&mut self.inner.lock().unwrap(), "Manual");
        Ok(())
    }

    pub async fn send_test(&self) -> Result<(), String> {
        let creds = {
            let mut g = self.inner.lock().unwrap();
            self.reload(&mut g);
            Self::creds(&g)
        };
        let text = format!("✅ <b>TPO Context</b> terhubung · {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
        Self::deliver(creds, vec![text]).await?;
        Self::mark(&mut self.inner.lock().unwrap(), "Test");
        Ok(())
    }

    /// Dipanggil tiap detik. `meta_ts` = waktu terakhir engine memperbarui data (engine mati -> tidak memicu apa pun).
    pub async fn tick(&self, snap: Option<Snap>, meta_ts: f64) {
        let now = now_f();
        let Some(snap) = snap else { return };
        if now - meta_ts > 30.0 {
            return;
        }
        let (fire, settings, creds) = {
            let mut g = self.inner.lock().unwrap();
            self.reload(&mut g);
            let settings = g.settings.clone();
            let creds = Self::creds(&g);
            let fire = g.trigger.step(&snap, &settings, now);
            (fire, settings, creds)
        };
        let Some(fire) = fire else { return };
        let reasons = fire.reasons.clone();
        match Self::deliver(creds, build_messages(&snap, &settings, &reasons)).await {
            Ok(()) => {
                let mut g = self.inner.lock().unwrap();
                g.trigger.sent(fire, now);
                Self::mark(&mut g, &reasons.join("; "));
                log(&format!("terkirim: {}", reasons.join("; ")));
            }
            Err(e) => {
                let mut g = self.inner.lock().unwrap();
                g.trigger.failed(now);
                g.last_error = Some(e.clone());
                log(&format!("gagal: {e}"));
            }
        }
    }
}

fn clean(s: &str, token: &str) -> String {
    s.replace(token, "***")
}

/// Kirim satu pesan; ulang sekali bila kena rate limit (429) dengan jeda <= 30 dtk.
pub fn send_text(token: &str, chat: &str, text: &str, retry: bool) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    let body = json!({"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": true});
    let (status, j): (u16, Value) = match ureq::post(&url).timeout(Duration::from_secs(15)).send_json(body) {
        Ok(r) => (r.status(), r.into_json().unwrap_or(json!({}))),
        Err(ureq::Error::Status(code, r)) => (code, r.into_json().unwrap_or(json!({}))),
        Err(e) => return Err(format!("tidak bisa menghubungi Telegram: {}", clean(&e.to_string(), token))),
    };
    if j["ok"].as_bool() == Some(true) {
        return Ok(());
    }
    if retry && status == 429 {
        if let Some(w) = j["parameters"]["retry_after"].as_f64().filter(|w| *w <= 30.0) {
            std::thread::sleep(Duration::from_millis((w * 1000.0) as u64 + 200));
            return send_text(token, chat, text, false);
        }
    }
    let desc = j["description"].as_str().map(String::from).unwrap_or(format!("HTTP {status}"));
    Err(format!("Telegram menolak: {}", clean(&desc, token)))
}
