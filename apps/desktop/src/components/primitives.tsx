'use client';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { formatCountdown, getFocusBlocks } from '@daybar/core';
import type { FocusDay, TimerState, Settings } from '@daybar/core/contracts';

export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(1, entry.contentRect.width))
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
export function Section({
  title,
  index,
  aside,
  children,
  className = ''
}: {
  title: string;
  index?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section ${className}`}>
      <header className="section-head">
        <h2>
          {index && <span className="index">{index}</span>}
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
export function Stats({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="stats">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Heatmap({
  cells,
  columns,
  label,
  onPick,
  fixedSize = false
}: {
  cells: ({
    date: string;
    color: string;
    opacity: number;
    count?: number;
  } | null)[];
  columns: number;
  label: string;
  onPick?: (date: string) => void;
  fixedSize?: boolean;
}) {
  return (
    <div
      className="heatmap"
      role="group"
      aria-label={label}
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
        maxWidth: fixedSize
          ? `calc(${columns} * var(--cellSize) + ${Math.max(0, columns - 1)} * var(--gap))`
          : undefined
      }}
    >
      {cells.map((cell, i) =>
        cell ? (
          onPick ? (
            <button
              key={cell.date}
              type="button"
              className="square"
              title={`${cell.date} · ${cell.count ?? 0} done`}
              aria-label={`${cell.date}: ${cell.count ?? 0} tasks done`}
              onClick={() => onPick(cell.date)}
              style={{ background: cell.color, opacity: cell.opacity }}
            />
          ) : (
            <span
              key={cell.date}
              className="square"
              role="img"
              aria-label={cell.date}
              title={cell.date}
              style={{ background: cell.color, opacity: cell.opacity }}
            />
          )
        ) : (
          <span
            key={`blank-${i}`}
            className="square blank"
            aria-hidden="true"
          />
        )
      )}
    </div>
  );
}
export function TimerDisplay({
  state,
  now,
  idleMinutes
}: {
  state: TimerState | null;
  now: Date;
  idleMinutes: number;
}) {
  return (
    <div className={`timer-display ${state?.type === 'break' ? 'break' : ''}`}>
      <span
        className={state ? '' : 'idle'}
        role="timer"
        aria-label="Time remaining"
      >
        {state ? formatCountdown(state, now) : `${idleMinutes}:00`}
      </span>
      <p className="muted">
        {state
          ? `${state.type.toUpperCase()} · ends ${clock(new Date(state.end))}${state.task ? ` · ${state.task}` : ''}`
          : 'One thing at a time.'}
      </p>
    </div>
  );
}
export function Blocks({
  day,
  settings
}: {
  day: FocusDay;
  settings: Settings;
}) {
  const { ref, width } = useWidth();
  const grid = getFocusBlocks(day, settings, width);
  return (
    <div
      ref={ref}
      className="blocks"
      role="img"
      aria-label={`${day.count} completed focus blocks`}
      style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }}
    >
      {grid.cells.map((cell, i) => (
        <span
          className="square"
          key={i}
          style={{ background: cell.color, opacity: cell.opacity }}
        />
      ))}
    </div>
  );
}
export function Progress({
  value,
  color,
  label
}: {
  value: number;
  color: string;
  label: string;
}) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(Math.max(0, Math.min(1, value)) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          background: color
        }}
      />
    </div>
  );
}
export function clock(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function theme(s: Settings): CSSProperties {
  return Object.fromEntries(
    Object.entries(s.appearance).map(([k, v]) => [
      `--${k}`,
      ['gap', 'radius', 'cellSize'].includes(k) ? `${v}px` : v
    ])
  ) as CSSProperties;
}
