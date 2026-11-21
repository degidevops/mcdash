//! mcdash-core: inti murni (tanpa I/O) — kalender, mesin TPO, snapshot, config, bias.
pub mod brokertime;
pub mod calendar;
pub mod config;
pub mod engine;
pub mod period;
pub mod profile;
pub mod series;
pub mod snapshot;
pub mod util;
pub mod wire;

pub use calendar::{Calendar, Mode};
pub use engine::{format_text, ChartNakedLevel, ChartTpoPeriod, ChartTpoProfile, ChartTpoResponse, TpoEngine, DAYS_ID};
pub use period::{Period, PocRule, TpoRowSnap, VaBound, VaMethod, VaStop, VaTieBreak};
pub use profile::{default_profiles, ProfileCfg};
pub use series::{Bar, Bars, Series};
pub use snapshot::*;
pub mod bias;
pub mod telegram;
