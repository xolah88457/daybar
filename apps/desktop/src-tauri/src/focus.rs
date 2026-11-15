use crate::{
    contracts::*,
    validation::{ensure, Result},
};
use chrono::{Local, TimeZone};
use std::collections::BTreeMap;

pub fn date_at(ms: i64) -> Result<String> {
    let date = Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|d| d.format("%Y-%m-%d").to_string())
        .ok_or("Timestamp outside supported range")?;
    crate::validation::date(&date)?;
    Ok(date)
}
pub fn normalize(data: &mut FocusData, block: u32) -> Result<()> {
    ensure(block > 0, "Block length must be positive")?;
    if data.sessions.is_none() {
        if let Some(base) = &data.baseline {
            let totals = |map: &BTreeMap<String, FocusDay>| {
                map.iter()
                    .filter(|(_, d)| d.minutes > 0)
                    .map(|(k, d)| (k.clone(), d.minutes))
                    .collect::<BTreeMap<_, _>>()
            };
            ensure(totals(base)==totals(&data.days),"Baseline without a session ledger disagrees with legacy days; manual recovery needed")?;
        } else {
            data.baseline = Some(data.days.clone());
        }
        data.sessions = Some(BTreeMap::new());
    }
    let mut days = data.baseline.clone().unwrap_or_default();
    for s in data
        .sessions
        .as_ref()
        .unwrap()
        .values()
        .filter(|s| s.r#type == "focus")
    {
        let d = days.entry(s.date.clone()).or_default();
        d.minutes = d
            .minutes
            .checked_add(s.credited_minutes)
            .ok_or("Focus total overflow")?;
    }
    for (date, day) in &data.days {
        ensure(day.minutes<=days.get(date).map_or(0,|d|d.minutes),"Focus days contain untracked minutes; preserve/recover the legacy baseline before editing")?;
    }
    for day in days.values_mut() {
        day.count = day.minutes / block;
    }
    if data.baseline.is_none() {
        data.baseline = Some(BTreeMap::new());
    }
    data.days = days;
    Ok(())
}
// Returns new credit only; duplicate keys are never added a second time.
pub fn stop(data: &mut FocusData, now: i64, block: u32) -> Result<u32> {
    normalize(data, block)?;
    let Some(s) = data.state.take() else {
        return Ok(0);
    };
    let end = now.max(s.start).min(s.end);
    let credited = if s.r#type == "focus" {
        ((end - s.start) / 60_000).min(i64::from(s.minutes)) as u32
    } else {
        0
    };
    let session = FocusSession {
        r#type: s.r#type,
        minutes: s.minutes,
        credited_minutes: credited,
        end,
        date: date_at(end)?,
        task: s.task,
    };
    let sessions = data.sessions.as_mut().unwrap();
    let credited = match sessions.entry(s.start.to_string()) {
        std::collections::btree_map::Entry::Vacant(e) => {
            e.insert(session);
            credited
        }
        std::collections::btree_map::Entry::Occupied(_) => 0,
    };
    normalize(data, block)?;
    Ok(credited)
}
pub fn settle(data: &mut FocusData, now: i64, block: u32) -> Result<u32> {
    if data.state.as_ref().is_some_and(|s| s.end <= now) {
        stop(data, now, block)
    } else {
        Ok(0)
    }
}
pub fn start(
    data: &mut FocusData,
    kind: String,
    minutes: u32,
    task: Option<String>,
    now: i64,
    block: u32,
) -> Result<()> {
    ensure(kind == "focus" || kind == "break", "Invalid timer type")?;
    ensure((1..=240).contains(&minutes), "Minutes must be 1–240")?;
    settle(data, now, block)?;
    ensure(
        data.state.is_none(),
        "Stop the running timer before starting another",
    )?;
    normalize(data, block)?;
    ensure(
        !data
            .sessions
            .as_ref()
            .unwrap()
            .contains_key(&now.to_string()),
        "Session timestamp already used; try again",
    )?;
    data.state = Some(TimerState {
        r#type: kind,
        minutes,
        start: now,
        end: now
            .checked_add(i64::from(minutes) * 60_000)
            .ok_or("Timer overflow")?,
        task,
    });
    Ok(())
}
pub fn linked(data: &FocusData, settings: &Settings) -> DailyLog {
    let mut totals: BTreeMap<(String, String), u64> = BTreeMap::new();
    for s in data
        .sessions
        .iter()
        .flat_map(|m| m.values())
        .filter(|s| s.r#type == "focus")
    {
        if let Some(task) = &s.task {
            *totals.entry((s.date.clone(), task.clone())).or_default() +=
                u64::from(s.credited_minutes);
        }
    }
    let mut log = DailyLog::new();
    for ((date, task), total) in totals {
        if settings.habits.tasks.contains(&task)
            && settings
                .habits
                .focus_thresholds
                .get(&task)
                .is_some_and(|n| total >= u64::from(*n))
        {
            log.entry(date).or_default().push(task);
        }
    }
    log
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn baseline_partial_and_duplicate_settlement() {
        let now = 1_800_000_000_000;
        let day = date_at(now).unwrap();
        let mut d = FocusData::default();
        d.days.insert(
            day.clone(),
            FocusDay {
                count: 1,
                minutes: 25,
            },
        );
        start(
            &mut d,
            "focus".into(),
            25,
            Some("Coursework".into()),
            now,
            25,
        )
        .unwrap();
        assert_eq!(stop(&mut d, now + 119_999, 25).unwrap(), 1);
        assert_eq!(d.days[&day].minutes, 26);
        start(&mut d, "focus".into(), 25, None, now + 120_000, 25).unwrap();
        let state = d.state.clone();
        settle(&mut d, now + 2_000_000, 25).unwrap();
        assert_eq!(d.days[&day].minutes, 51);
        d.state = state;
        assert_eq!(settle(&mut d, now + 2_000_000, 25).unwrap(), 0);
        assert_eq!(d.days[&day].minutes, 51);
        assert_eq!(d.baseline.unwrap()[&day].minutes, 25);
    }
    #[test]
    fn unexplained_legacy_totals_are_not_erased_by_an_incomplete_ledger() {
        let mut d = FocusData {
            days: BTreeMap::from([(
                "2026-11-15".into(),
                FocusDay {
                    count: 1,
                    minutes: 25,
                },
            )]),
            sessions: Some(BTreeMap::new()),
            ..Default::default()
        };
        assert!(normalize(&mut d, 25).is_err());
        assert_eq!(d.days["2026-11-15"].minutes, 25);
    }
    #[test]
    fn under_minute_and_break_are_zero() {
        let mut d = FocusData::default();
        start(&mut d, "focus".into(), 25, None, 1_800_000_000_000, 25).unwrap();
        assert_eq!(stop(&mut d, 1_800_000_059_999, 25).unwrap(), 0);
        start(&mut d, "break".into(), 5, None, 1_800_000_060_000, 25).unwrap();
        assert_eq!(settle(&mut d, 1_800_001_000_000, 25).unwrap(), 0);
    }
}
