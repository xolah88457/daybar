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
impl Default for CountdownSettings { fn default() -> Self { Self { start_date:"2026-09-09".into(), end_date:"2027-05-24".into(), title:"End of University".into() } } }
impl Default for HabitSettings { fn default() -> Self { Self { start_date:"2026-10-30".into(), end_date:String::new(), title:"Daily Tasks".into(), log_id:"Daily_Tasks".into(), tasks:vec!["Coursework".into(),"Live Trading".into(),"Trade Review".into(),"Apostles work".into()], archived_tasks:vec![], day_complete_min:1, focus_thresholds:BTreeMap::new() } } }
impl Default for FocusSettings { fn default() -> Self { Self { title:"Focus".into(),focus_options:vec![25,50],break_options:vec![5,10],long_break_options:vec![15,30],block_minutes:25,alerts:true } } }
impl Default for SleepSettings { fn default() -> Self { Self {title:"Time".into(),awake_hours:16.0,sleep_hours:8.0,target_wake:"08:00".into(),target_bed:String::new(),step_minutes:15,average_days:7,bedtime_alerts:true,routine_minutes:120,no_phone_minutes:60} } }
impl Default for Appearance { fn default() -> Self { Self { background:"#0d1117".into(),text:"#ffffff".into(),green:"#39d353".into(),blue:"#58a6ff".into(),red:"#ff5c5c".into(),orange:"#ff9f43".into(),yellow:"#f2cc60".into(),empty_opacity:0.05,min_done_opacity:0.3,future_opacity:0.12,rows:7,cell_size:10.0,gap:2.0,radius:2.0} } }
impl Default for Settings { fn default() -> Self { Self {schema_version:1,countdown:CountdownSettings::default(),habits:HabitSettings::default(),focus:FocusSettings::default(),sleep:SleepSettings::default(),appearance:Appearance::default()} } }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Preferences { pub data_folder: String, pub real_data: bool, pub launch_at_login: bool, pub hide_dock: bool, pub global_shortcut: String }
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
 #[test] fn settings_defaults_and_roundtrip() { let s:Settings=serde_json::from_str("{}").unwrap(); assert_eq!(s.habits.tasks.len(),4); assert_eq!(s.focus.block_minutes,25); let json=serde_json::to_string(&s).unwrap(); let _:Settings=serde_json::from_str(&json).unwrap(); }
 #[test] fn rejects_unknown_fields() { assert!(serde_json::from_str::<Settings>("{\"schemaVersion\":1,\"future\":true}").is_err()); }
}
