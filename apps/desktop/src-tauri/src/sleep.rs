use crate::{contracts::*, validation::Result};
use chrono::{DateTime, Days, Duration, Local, NaiveDate, TimeZone};

pub fn wrap(m: f64) -> u32 {
    (((m + 0.5).floor() as i64).rem_euclid(1440)) as u32
}
fn diff(from: u32, to: u32) -> i64 {
    (i64::from(to) - i64::from(from) + 720).rem_euclid(1440) - 720
}
pub fn shift(from: u32, to: u32, days: i64, step: u32) -> u32 {
    let delta = diff(from, to);
    wrap((i64::from(from) + delta.signum() * delta.abs().min(days.max(0) * i64::from(step))) as f64)
}
pub fn to_min(clock: &str) -> u32 {
    clock[..2].parse::<u32>().unwrap() * 60 + clock[3..].parse::<u32>().unwrap()
}
fn targets(s: &SleepSettings) -> (u32, u32) {
    let wake = to_min(&s.target_wake);
    (
        wake,
        if s.target_bed.is_empty() {
            wrap(f64::from(wake) - s.sleep_hours * 60.0)
        } else {
            to_min(&s.target_bed)
        },
    )
}
pub fn average(map: &std::collections::BTreeMap<String, u32>, n: usize) -> Option<u32> {
    let values: Vec<_> = map.values().rev().take(n).collect();
    if values.is_empty() {
        return None;
    }
    let (sin, cos) = values.iter().fold((0.0, 0.0), |(s, c), m| {
        let a = f64::from(**m) / 1440.0 * std::f64::consts::TAU;
        (s + a.sin(), c + a.cos())
    });
    Some(wrap(sin.atan2(cos) / std::f64::consts::TAU * 1440.0))
}
pub fn baseline(data: &SleepData, s: &SleepSettings) -> Option<(u32, u32)> {
    let wake = average(&data.wakes, s.average_days)?;
    Some((
        wake,
        average(&data.beds, s.average_days)
            .unwrap_or_else(|| wrap(f64::from(wake) - s.sleep_hours * 60.0)),
    ))
}
fn at(day: NaiveDate, minutes: u32) -> Result<DateTime<Local>> {
    let naive = day
        .and_hms_opt(minutes / 60, minutes % 60, 0)
        .ok_or("Invalid sleep time")?;
    // JS chooses the earlier repeated time and shifts a nonexistent time by the entire DST gap.
    if let Some(d) = Local.from_local_datetime(&naive).earliest() {
        return Ok(d);
    }
    let (mut before, mut after) = (None, None);
    for offset in 1..=1440 {
        before = before.or_else(|| {
            Local
                .from_local_datetime(&(naive - Duration::minutes(offset)))
                .earliest()
        });
        after = after.or_else(|| {
            Local
                .from_local_datetime(&(naive + Duration::minutes(offset)))
                .earliest()
        });
        if let (Some(a), Some(b)) = (before, after) {
            let gap = b.offset().local_minus_utc() - a.offset().local_minus_utc();
            return Local
                .from_local_datetime(&(naive + Duration::seconds(i64::from(gap))))
                .earliest()
                .ok_or_else(|| "Cannot resolve local sleep time".into());
        }
    }
    Err("Cannot resolve local sleep time".into())
}
fn parse(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|e| e.to_string())
}
pub struct View {
    pub wake: DateTime<Local>,
    pub bed: DateTime<Local>,
    pub asleep: bool,
}
pub fn view(data: &SleepData, s: &SleepSettings, now: DateTime<Local>) -> Result<View> {
    let mut best = None;
    for (day, minute) in data.wakes.iter().rev().take(3) {
        let d = at(parse(day)?, *minute)?;
        if d <= now
            && (now - d).num_milliseconds() as f64 / 3_600_000.0 < s.awake_hours + 6.0
            && best.is_none_or(|b| d > b)
        {
            best = Some(d);
        }
    }
    let (tw, tb) = targets(s);
    let wake = if let Some(d) = best {
        d
    } else {
        let minute = if let Some(plan) = &data.plan {
            shift(
                plan.wake,
                tw,
                (now.date_naive() - parse(&plan.start)?).num_days(),
                s.step_minutes,
            )
        } else {
            baseline(data, s).map(|b| b.0).unwrap_or(tw)
        };
        at(now.date_naive(), minute)?
    };
    let asleep = best.is_none() && now < wake;
    let mut bed = wake + Duration::milliseconds((s.awake_hours * 3_600_000.0) as i64);
    if let Some(plan) = &data.plan {
        let k = (wake.date_naive() - parse(&plan.start)?).num_days().max(0);
        let goal = shift(plan.bed, tb, k + 1, s.step_minutes);
        let mut day = wake.date_naive();
        bed = at(day, goal)?;
        while (bed - wake).num_milliseconds() < 3_600_000 {
            day = day.checked_add_days(Days::new(1)).ok_or("Date overflow")?;
            bed = at(day, goal)?;
        }
    }
    Ok(View { wake, bed, asleep })
}
pub fn log(data: &mut SleepData, entry: &str, timestamp: i64) -> Result<()> {
    use chrono::Timelike;
    let date = Local
        .timestamp_millis_opt(timestamp)
        .single()
        .ok_or("Invalid sleep timestamp")?;
    let minutes = date.hour() * 60 + date.minute();
    match entry {
        "wake" => {
            data.wakes
                .insert(date.format("%Y-%m-%d").to_string(), minutes);
        }
        "bed" => {
            let day = if date.hour() < 12 {
                date.date_naive().pred_opt().ok_or("Date overflow")?
            } else {
                date.date_naive()
            };
            data.beds.insert(day.to_string(), minutes);
        }
        _ => return Err("Invalid sleep entry".into()),
    }
    Ok(())
}
pub fn title(view: &View, now: DateTime<Local>) -> String {
    let mins = ((if view.asleep { view.wake } else { view.bed } - now).num_seconds() as f64 / 60.0)
        .round()
        .max(0.0) as i64;
    let duration = if mins >= 60 {
        format!("{}h {}m", mins / 60, mins % 60)
    } else {
        format!("{mins}m")
    };
    if view.asleep {
        format!("{duration} → wake")
    } else if view.bed <= now {
        "Past bedtime".into()
    } else {
        format!("{duration} → bed")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn circular_mean_and_plan_wrap() {
        let map = std::collections::BTreeMap::from([
            ("2026-01-01".into(), 1430),
            ("2026-01-02".into(), 10),
        ]);
        assert_eq!(average(&map, 7), Some(0));
        assert_eq!(shift(1430, 20, 1, 15), 5);
        assert_eq!(diff(0, 720), -720);
        assert_eq!(wrap(-0.5), 0);
        assert_eq!(wrap(-1.5), 1439);
    }
    #[test]
    fn post_midnight_bed_is_recorded_on_previous_evening() {
        let when = at(NaiveDate::from_ymd_opt(2026, 11, 15).unwrap(), 90).unwrap();
        let mut d = SleepData::default();
        log(&mut d, "bed", when.timestamp_millis()).unwrap();
        log(&mut d, "wake", when.timestamp_millis()).unwrap();
        assert_eq!(d.beds["2026-11-14"], 90);
        assert_eq!(d.wakes["2026-11-15"], 90);
    }
    #[test]
    fn local_time_resolution_matches_js_dst_policy() {
        let day = NaiveDate::from_ymd_opt(2026, 3, 8).unwrap();
        let resolved = at(day, 150).unwrap();
        assert!(resolved.naive_local() >= day.and_hms_opt(2, 30, 0).unwrap());
        if std::env::var("TZ").as_deref() == Ok("America/Toronto") {
            assert_eq!(resolved.format("%H:%M").to_string(), "03:30");
        }
        let day = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        let naive = day.and_hms_opt(1, 30, 0).unwrap();
        assert_eq!(
            at(day, 90).unwrap(),
            Local.from_local_datetime(&naive).earliest().unwrap()
        );
    }
    #[test]
    fn estimated_wake_and_plan_bed_are_consistent() {
        let now = at(NaiveDate::from_ymd_opt(2026, 11, 15).unwrap(), 6 * 60).unwrap();
        let mut d = SleepData::default();
        let s = SleepSettings::default();
        let v = view(&d, &s, now).unwrap();
        assert!(v.asleep);
        assert_eq!((v.bed - v.wake).num_hours(), 16);
        d.plan = Some(SleepPlan {
            start: "2026-11-15".into(),
            wake: 480,
            bed: 450,
        });
        let v = view(&d, &s, now).unwrap();
        assert!((v.bed - v.wake).num_hours() >= 1);
    }
}
