'use client';
// Feature: roomBeforeEvent. Needs Deadline Radar (the registry only shows this card while both are on).
// It reads the same calendar items as Radar and says how many focus blocks fit before the next timed event today.
import { useMemo } from 'react';
import { roomBeforeNextEvent, selectRadarItems } from '@daybar/core';
import { Section } from '../components/primitives';
import { useRadarItems } from './radarState';
import styles from './roomBeforeEvent.module.css';
import type { FeatureCardProps } from './types';

export function TodayCard({ snapshot, now }: FeatureCardProps) {
  const config = snapshot.preferences.features.radar;
  const blockMinutes = snapshot.settings.focus.blockMinutes;
  const radar = useRadarItems(config);
  const room = useMemo(
    () =>
      radar.data
        ? roomBeforeNextEvent(selectRadarItems(radar.data.items, config, now), now, blockMinutes)
        : null,
    // The clock ticks every second; the minute is the resolution that matters here.
    [radar.data, config, blockMinutes, Math.floor(now.getTime() / 60000)]
  );
  // Comes with Radar and starts on, so stay out of the way until Calendar can be read: the
  // Deadlines card already explains how to grant access.
  if (radar.data && radar.data.status.events !== 'fullAccess') return null;
  const time = room
    ? new Date(room.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  return (
    <Section title="Room before your next event" aside={<span className="tag">FOCUS BLOCKS</span>}>
      {!radar.data ? (
        <p className="muted">Reading your calendar…</p>
      ) : room ? (
        <>
          <p className={styles.room}>
            Room for ~<strong>{room.blocks}</strong> focus {room.blocks === 1 ? 'block' : 'blocks'} before{' '}
            {room.title} at {time}
          </p>
          <p className={styles.detail}>
            {room.minutes} min until it starts · {blockMinutes} min / block
          </p>
        </>
      ) : (
        <p className="muted">No more timed events today. The rest of the day is yours.</p>
      )}
    </Section>
  );
}
