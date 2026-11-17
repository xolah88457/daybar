use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub type DailyLog = BTreeMap<String, Vec<String>>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DailyLogFile { Current(DailyLog), Legacy(Vec<String>) }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimerState { pub r#type: String, pub minutes: u32, pub start: i64, pub end: i64, #[serde(skip_serializing_if="Option::is_none")] pub task: Option<String> }
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FocusDay { pub count: u32, pub minutes: u32 }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusSession { pub r#type: String, pub minutes: u32, pub credited_minutes: u32, pub end: i64, pub date: String, #[serde(skip_serializing_if="Option::is_none")] pub task: Option<String> }
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FocusData {
 pub state: Option<TimerState>, pub days: BTreeMap<String, FocusDay>,
 #[serde(skip_serializing_if="Option::is_none")] pub sessions: Option<BTreeMap<String, FocusSession>>,
 #[serde(skip_serializing_if="Option::is_none")] pub baseline: Option<BTreeMap<String, FocusDay>>
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SleepPlan { pub start: String, pub wake: u32, pub bed: u32 }
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SleepData { pub wakes: BTreeMap<String, u32>, pub beds: BTreeMap<String, u32>, pub plan: Option<SleepPlan> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct CountdownSettings { pub start_date: String, pub end_date: String, pub title: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct HabitSettings {
 pub start_date: String, pub end_date: String, pub title: String, pub log_id: String,
 pub tasks: Vec<String>, pub archived_tasks: Vec<String>, pub day_complete_min: u32,
 pub focus_thresholds: BTreeMap<String, u32>
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct FocusSettings { pub title: String, pub focus_options: Vec<u32>, pub break_options: Vec<u32>, pub long_break_options: Vec<u32>, pub block_minutes: u32, pub alerts: bool }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct SleepSettings {
 pub title: String, pub awake_hours: f64, pub sleep_hours: f64, pub target_wake: String, pub target_bed: String,
 pub step_minutes: u32, pub average_days: usize, pub bedtime_alerts: bool, pub routine_minutes: u32, pub no_phone_minutes: u32
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct Appearance {
 pub background: String, pub text: String, pub green: String, pub blue: String, pub red: String, pub orange: String, pub yellow: String,
 pub empty_opacity: f64, pub min_done_opacity: f64, pub future_opacity: f64,
 pub rows: u32, pub cell_size: f64, pub gap: f64, pub radius: f64
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct Settings { pub schema_version: u32, pub countdown: CountdownSettings, pub habits: HabitSettings, pub focus: FocusSettings, pub sleep: SleepSettings, pub appearance: Appearance }
impl Default for CountdownSettings { fn default() -> Self { Self { start_date:"2026-10-01".into(), end_date:"2027-07-01".into(), title:"Community Garden Opening".into() } } }
impl Default for HabitSettings { fn default() -> Self { Self { start_date:"2026-11-01".into(), end_date:String::new(), title:"Daily Tasks".into(), log_id:"Daily_Tasks".into(), tasks:vec!["Read a chapter".into(),"Sketch a scene".into(),"Take a walk".into(),"Water the plants".into()], archived_tasks:vec![], day_complete_min:1, focus_thresholds:BTreeMap::new() } } }
impl Default for FocusSettings { fn default() -> Self { Self { title:"Focus".into(),focus_options:vec![25,50],break_options:vec![5,10],long_break_options:vec![15,30],block_minutes:25,alerts:true } } }
impl Default for SleepSettings { fn default() -> Self { Self {title:"Time".into(),awake_hours:16.0,sleep_hours:8.0,target_wake:"08:00".into(),target_bed:String::new(),step_minutes:15,average_days:7,bedtime_alerts:true,routine_minutes:120,no_phone_minutes:60} } }
impl Default for Appearance { fn default() -> Self { Self { background:"#0d1117".into(),text:"#ffffff".into(),green:"#39d353".into(),blue:"#58a6ff".into(),red:"#ff5c5c".into(),orange:"#ff9f43".into(),yellow:"#f2cc60".into(),empty_opacity:0.05,min_done_opacity:0.3,future_opacity:0.12,rows:7,cell_size:10.0,gap:2.0,radius:2.0} } }
impl Default for Settings { fn default() -> Self { Self {schema_version:1,countdown:CountdownSettings::default(),habits:HabitSettings::default(),focus:FocusSettings::default(),sleep:SleepSettings::default(),appearance:Appearance::default()} } }
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="lowercase")]
pub enum ThemeMode { Day, #[default] Night, Auto }
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub enum TrayDisplay { #[default] Auto, FocusMinutes, FocusHours, FocusBlocks, ActiveTimer, Bedtime, NextTask, Countdown, NextDeadline }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Preferences {
 pub data_folder: String, pub real_data: bool, pub launch_at_login: bool, pub hide_dock: bool, pub global_shortcut: String,
 #[serde(default)] pub theme_mode: ThemeMode,
 #[serde(default)] pub tray_display: TrayDisplay,
 #[serde(default)] pub features: Features
}
// App-local feature toggles and configuration (Mac only; never part of the shared settings.json).
// Mirrors `featuresSchema` in packages/core/src/contracts/index.ts; limits live in validation.rs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct Features {
 pub countdown: bool, pub habits: bool, pub focus: bool, pub sleep: bool,
 pub radar: RadarConfig, pub room_before_event: Toggle, pub hourly_chime: HourlyChimeConfig, pub check_ins: CheckInsConfig,
 pub streak_saver: StreakSaverConfig, pub auto_cycle: AutoCycleConfig, pub focus_shortcuts: FocusShortcutsConfig,
 pub away_detection: AwayDetectionConfig, pub movement_nudges: MovementNudgesConfig, pub insights: Toggle,
 pub export_history: Toggle, pub command_palette: Toggle, pub extra_countdowns: ExtraCountdownsConfig
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Toggle { pub enabled: bool }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct RadarConfig {
 pub enabled: bool, pub calendars: Vec<String>, pub reminder_lists: Vec<String>, pub include_reminders: bool,
 pub days_ahead: u32, pub overdue_days_back: u32, pub keywords: Vec<String>, pub due_alerts: bool, pub alert_time: String
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct HourlyChimeConfig { pub enabled: bool, pub quiet_start: String, pub quiet_end: String, pub sound: bool }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct CheckInsConfig { pub enabled: bool, pub morning_time: String, pub evening_time: String }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct StreakSaverConfig { pub enabled: bool, pub minutes_before_bed: u32 }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct AutoCycleConfig { pub enabled: bool, pub long_break_every: u32 }
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct FocusShortcutsConfig { pub enabled: bool, pub on_start: String, pub on_end: String }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct AwayDetectionConfig { pub enabled: bool, pub idle_minutes: u32 }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct MovementNudgesConfig { pub enabled: bool, pub interval_minutes: u32, pub active_start: String, pub active_end: String }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ExtraCountdown { pub id: String, pub title: String, pub start_date: String, pub end_date: String }
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct ExtraCountdownsConfig { pub enabled: bool, pub items: Vec<ExtraCountdown> }
impl Default for Features { fn default() -> Self { Self {
 countdown:true, habits:true, focus:true, sleep:true,
 radar:RadarConfig::default(), room_before_event:Toggle::default(), hourly_chime:HourlyChimeConfig::default(), check_ins:CheckInsConfig::default(),
 streak_saver:StreakSaverConfig::default(), auto_cycle:AutoCycleConfig::default(), focus_shortcuts:FocusShortcutsConfig::default(),
 away_detection:AwayDetectionConfig::default(), movement_nudges:MovementNudgesConfig::default(), insights:Toggle::default(),
 export_history:Toggle::default(), command_palette:Toggle::default(), extra_countdowns:ExtraCountdownsConfig::default() } } }
impl Default for RadarConfig { fn default() -> Self { Self { enabled:false, calendars:vec![], reminder_lists:vec![], include_reminders:true, days_ahead:60, overdue_days_back:14, keywords:vec![], due_alerts:false, alert_time:"09:00".into() } } }
impl Default for HourlyChimeConfig { fn default() -> Self { Self { enabled:false, quiet_start:"22:00".into(), quiet_end:"08:00".into(), sound:true } } }
impl Default for CheckInsConfig { fn default() -> Self { Self { enabled:false, morning_time:"08:00".into(), evening_time:"20:00".into() } } }
impl Default for StreakSaverConfig { fn default() -> Self { Self { enabled:false, minutes_before_bed:90 } } }
impl Default for AutoCycleConfig { fn default() -> Self { Self { enabled:false, long_break_every:4 } } }
impl Default for AwayDetectionConfig { fn default() -> Self { Self { enabled:false, idle_minutes:5 } } }
impl Default for MovementNudgesConfig { fn default() -> Self { Self { enabled:false, interval_minutes:50, active_start:"09:00".into(), active_end:"18:00".into() } } }
impl Features {
 /// Whether a feature is on AND everything it depends on is on. `id` is the camelCase key used in
 /// preferences.json (`focus`, `radar`, `hourlyChime`, ...); unknown ids are off.
 pub fn active(&self, id: &str) -> bool {
  match id {
   "countdown" => self.countdown, "habits" => self.habits, "focus" => self.focus, "sleep" => self.sleep,
   "radar" => self.radar.enabled,
   "roomBeforeEvent" => self.radar.enabled && self.room_before_event.enabled,
   "hourlyChime" => self.hourly_chime.enabled, "checkIns" => self.check_ins.enabled,
   "streakSaver" => self.streak_saver.enabled, "autoCycle" => self.auto_cycle.enabled,
   "focusShortcuts" => self.focus_shortcuts.enabled, "awayDetection" => self.away_detection.enabled,
   "movementNudges" => self.movement_nudges.enabled, "insights" => self.insights.enabled,
   "exportHistory" => self.export_history.enabled, "commandPalette" => self.command_palette.enabled,
   "extraCountdowns" => self.extra_countdowns.enabled,
   _ => false
  }
 }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DataIssue { pub file: String, pub message: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Conflict { pub file: String, pub canonical: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Snapshot { pub settings: Settings, pub daily_log: DailyLog, pub focus: FocusData, pub sleep: SleepData, pub preferences: Preferences, pub issues: Vec<DataIssue>, pub conflicts: Vec<Conflict> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MutationResult { pub snapshot: Snapshot, #[serde(skip_serializing_if="Option::is_none")] pub credited_minutes: Option<u32>, #[serde(skip_serializing_if="Option::is_none")] pub message: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag="kind", deny_unknown_fields)]
pub enum Operation {
 #[serde(rename="set_task")] SetTask { date: String, task: String, done: bool },
 #[serde(rename="rename_task")] RenameTask { from: String, to: String },
 #[serde(rename="archive_task")] ArchiveTask { task: String },
 #[serde(rename="start_timer")] StartTimer { #[serde(rename="timerType")] timer_type: String, minutes: u32, task: Option<String> },
 #[serde(rename="stop_timer")] StopTimer,
 #[serde(rename="settle_timer")] SettleTimer,
 #[serde(rename="log_sleep")] LogSleep { entry: String, timestamp: i64 },
 #[serde(rename="start_plan")] StartPlan,
 #[serde(rename="stop_plan")] StopPlan,
 #[serde(rename="clear_sleep")] ClearSleep,
 #[serde(rename="save_settings")] SaveSettings { settings: Settings }
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn settings_defaults_and_roundtrip() { let s:Settings=serde_json::from_str("{}").unwrap(); assert_eq!(s.habits.tasks, vec!["Read a chapter", "Sketch a scene", "Take a walk", "Water the plants"]); assert_eq!(s.countdown.start_date, "2026-10-01"); assert_eq!(s.countdown.end_date, "2027-07-01"); assert_eq!(s.countdown.title, "Community Garden Opening"); assert_eq!(s.habits.start_date, "2026-11-01"); assert_eq!(s.focus.block_minutes,25); let json=serde_json::to_string(&s).unwrap(); let _:Settings=serde_json::from_str(&json).unwrap(); }
 #[test] fn preferences_theme_defaults_and_rejects_unknown_modes() {
  let prefs: Preferences = serde_json::from_str(r#"{"dataFolder":"/sandbox","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":""}"#).unwrap();
  assert_eq!(prefs.theme_mode, ThemeMode::Night);
  let json = serde_json::to_value(&prefs).unwrap();
  assert_eq!(json["themeMode"], "night");
  assert_eq!(json["trayDisplay"], "auto");
  let mut selected = prefs.clone();
  selected.tray_display = TrayDisplay::FocusHours;
  let selected_json = serde_json::to_value(&selected).unwrap();
  assert_eq!(selected_json["trayDisplay"], "focusHours");
  assert_eq!(serde_json::from_value::<Preferences>(selected_json).unwrap().tray_display, TrayDisplay::FocusHours);
  assert!(serde_json::from_str::<Preferences>(r#"{"dataFolder":"/sandbox","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":"","themeMode":"system"}"#).is_err());
  assert!(serde_json::from_str::<Preferences>(r#"{"dataFolder":"/sandbox","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":"","trayDisplay":"future"}"#).is_err());
 }
 #[test] fn preferences_without_features_load_with_defaults() {
  let prefs: Preferences = serde_json::from_str(r#"{"dataFolder":"/sandbox","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":""}"#).unwrap();
  assert_eq!(prefs.features, Features::default());
  assert!(prefs.features.countdown && prefs.features.habits && prefs.features.focus && prefs.features.sleep);
  assert!(!prefs.features.radar.enabled && !prefs.features.insights.enabled);
  let json = serde_json::to_value(&prefs).unwrap();
  assert_eq!(json["features"]["radar"]["daysAhead"], 60);
  assert_eq!(json["features"]["radar"]["alertTime"], "09:00");
  assert_eq!(json["features"]["radar"]["includeReminders"], true);
  assert_eq!(json["features"]["hourlyChime"]["quietStart"], "22:00");
  assert_eq!(json["features"]["checkIns"]["eveningTime"], "20:00");
  assert_eq!(json["features"]["movementNudges"]["intervalMinutes"], 50);
  assert_eq!(json["features"]["extraCountdowns"]["items"], serde_json::json!([]));
 }
 #[test] fn partial_features_fill_from_defaults_and_unknown_keys_are_rejected() {
  let prefs: Preferences = serde_json::from_str(r#"{"dataFolder":"/s","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":"","features":{"focus":false,"radar":{"enabled":true,"daysAhead":30}}}"#).unwrap();
  assert!(!prefs.features.focus && prefs.features.sleep);
  assert!(prefs.features.radar.enabled && prefs.features.radar.days_ahead == 30 && prefs.features.radar.overdue_days_back == 14);
  assert!(prefs.features.active("radar") && !prefs.features.active("roomBeforeEvent") && !prefs.features.active("focus"));
  for bad in [r#"{"nope":true}"#, r#"{"radar":{"nope":1}}"#] {
   let raw = format!(r#"{{"dataFolder":"/s","realData":false,"launchAtLogin":false,"hideDock":false,"globalShortcut":"","features":{bad}}}"#);
   assert!(serde_json::from_str::<Preferences>(&raw).is_err());
  }
 }
 #[test] fn rejects_unknown_fields() { assert!(serde_json::from_str::<Settings>("{\"schemaVersion\":1,\"future\":true}").is_err()); }
}
