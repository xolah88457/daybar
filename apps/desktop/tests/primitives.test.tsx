import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getCountdown, getHabitGrid, key } from '@daybar/core';
import {
  Blocks,
  Heatmap,
  Section,
  Progress,
  TimerDisplay,
  dayProjectedSettings,
  layoutTheme,
  theme
} from '../src/components/primitives';
import { fixture } from './fixtures';

const now = new Date(2026, 10, 15, 12);
describe('legacy square grids', () => {
  it('renders core row-major cells without rearranging column-major dates', () => {
    const s = fixture().settings;
    s.countdown.startDate = '2026-11-01';
    s.countdown.endDate = '2026-11-09';
    const grid = getCountdown(s, now);
    const { container } = render(
      <Heatmap cells={grid.cells} columns={grid.columns} label="Countdown" />
    );
    expect(screen.getByRole('group', { name: 'Countdown' })).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))'
    });
    const squares = container.querySelectorAll('.square');
    expect(squares).toHaveLength(14);
    expect(squares[0]).toHaveAttribute('aria-label', '2026-11-01');
    expect(squares[1]).toHaveAttribute('aria-label', '2026-11-08');
    expect(squares[2]).toHaveAttribute('aria-label', '2026-11-02');
    expect(container.querySelectorAll('.blank')).toHaveLength(5);
  });
  it('shows the exact legacy red/orange/yellow/green from core at partial brightness', () => {
    const s = fixture().settings;
    s.habits.startDate = '2026-11-12';
    s.habits.endDate = '2026-11-15';
    const log = Object.fromEntries(
      [1, 2, 3, 4].map((n, i) => [
        `2026-11-${12 + i}`,
        s.habits.tasks.slice(0, n)
      ])
    );
    const grid = getHabitGrid(log, s, now, 400);
    const pick = vi.fn();
    render(
      <Heatmap
        cells={grid.cells}
        columns={grid.columns}
        label="History"
        onPick={pick}
      />
    );
    const colors = ['#ff5c5c', '#ff9f43', '#f2cc60', '#39d353'];
    colors.forEach((color, i) => {
      const cell = screen.getByRole('button', {
        name: `2026-11-${12 + i}: ${i + 1} tasks done`
      });
      expect(cell).toHaveStyle({ background: color });
      expect(Number(cell.style.opacity)).toBeCloseTo(0.3 + ((i + 1) / 4) * 0.7);
    });
    fireEvent.click(
      screen.getByRole('button', { name: `${key(now)}: 4 tasks done` })
    );
    expect(pick).toHaveBeenCalledWith(key(now));
  });
});
describe('timer and progress', () => {
  it('clamps an expired timer to zero and keeps its end clock and task visible', () => {
    const state = {
      type: 'focus' as const,
      minutes: 25,
      start: now.getTime() - 26 * 60000,
      end: now.getTime() - 60000,
      task: 'Read a chapter'
    };
    const { rerender } = render(
      <TimerDisplay state={state} now={now} idleMinutes={25} />
    );
    expect(screen.getByRole('timer')).toHaveTextContent(/^0{1,2}:00$/);
    expect(screen.getByText(/FOCUS · ends/)).toHaveTextContent(
      'Read a chapter'
    );
    rerender(
      <TimerDisplay
        state={{ ...state, type: 'break', end: now.getTime() + 65000 }}
        now={now}
        idleMinutes={25}
      />
    );
    expect(screen.getByRole('timer')).toHaveTextContent(/^0?1:05$/);
    expect(screen.getByRole('timer').parentElement).toHaveClass('break');
    rerender(<TimerDisplay state={null} now={now} idleMinutes={50} />);
    expect(screen.getByRole('timer')).toHaveTextContent('50:00');
  });
  it('clamps progress and gives block squares an accessible summary', () => {
    const { rerender } = render(
      <Progress value={2} color="#39d353" label="Day" />
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100'
    );
    rerender(<Progress value={-1} color="#ff5c5c" label="Day" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0'
    );
    rerender(
      <Blocks day={{ count: 3, minutes: 75 }} settings={fixture().settings} />
    );
    expect(
      screen.getByRole('img', { name: '3 completed focus blocks' })
    ).toBeInTheDocument();
  });
});

describe('appearance tokens', () => {
  it('keeps grid layout tokens separate from the night color palette', () => {
    const s = fixture().settings;
    s.appearance.cellSize = 14;
    s.appearance.gap = 3;
    s.appearance.radius = 4;
    expect(theme(s)).toMatchObject({
      '--cellSize': '14px',
      '--gap': '3px',
      '--radius': '4px',
      '--green': '#39d353'
    });
    expect(layoutTheme(s)).toEqual({
      '--cellSize': '14px',
      '--gap': '3px',
      '--radius': '4px'
    });
    expect(layoutTheme(s)).not.toHaveProperty('--background');
  });

  it('projects day colors without mutating raw settings or changing opacity math', () => {
    const raw = fixture().settings;
    const projected = dayProjectedSettings(raw);
    expect(projected).not.toBe(raw);
    expect(projected.appearance).toMatchObject({
      background: '#f4f3ed',
      text: '#202820',
      green: '#18764b',
      blue: '#286a9f',
      red: '#b43737',
      orange: '#a34b15',
      yellow: '#80620b',
      emptyOpacity: raw.appearance.emptyOpacity,
      minDoneOpacity: raw.appearance.minDoneOpacity,
      futureOpacity: raw.appearance.futureOpacity,
      cellSize: raw.appearance.cellSize,
      gap: raw.appearance.gap,
      radius: raw.appearance.radius
    });
    expect(raw.appearance.green).toBe('#39d353');
    expect(raw.appearance.background).toBe('#0d1117');
  });
});

describe('collapsible sections', () => {
  it('start closed, open from the header and remember it', () => {
    localStorage.clear();
    const { container, unmount } = render(
      <Section title="Updates" collapsible aside={<span className="tag">MAC</span>}>
        <p>Body</p>
      </Section>
    );
    const details = container.querySelector('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument();
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(localStorage.getItem('daybar.section-open.Updates')).toBe('1');
    unmount();
    const again = render(
      <Section title="Updates" collapsible>
        <p>Body</p>
      </Section>
    );
    expect(again.container.querySelector('details')).toHaveAttribute('open');
  });
  it('render as a plain section without the prop', () => {
    const { container } = render(<Section title="Focus">x</Section>);
    expect(container.querySelector('details')).toBeNull();
  });
});
