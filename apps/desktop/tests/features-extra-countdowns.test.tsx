import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExtraCountdown } from '@daybar/core/contracts';
import { featuresSchema } from '@daybar/core/contracts';
import { Config, countdownProgress, TodayCard } from '../src/features/extraCountdowns';
import { fixture } from './fixtures';

const item = (id: string, title: string, startDate = '2026-11-01', endDate = '2026-12-01'): ExtraCountdown => ({ id, title, startDate, endDate });
function props(items: ExtraCountdown[] = [], busy = false) {
  const snapshot = fixture();
  snapshot.preferences.features.extraCountdowns = { enabled: true, items };
  return {
    id: 'extraCountdowns' as const,
    value: snapshot.preferences.features.extraCountdowns,
    features: snapshot.preferences.features,
    snapshot,
    busy,
    save: vi.fn(async () => true)
  };
}
const saved = (p: ReturnType<typeof props>) =>
  (p.save.mock.calls[0] as unknown as [{ enabled: boolean; items: ExtraCountdown[] }])[0];

describe('Extra countdowns config', () => {
  it('explains that the phone keeps showing only the main countdown', () => {
    render(<Config {...props()} />);
    expect(screen.getByText(/phone widgets keep showing just the main countdown/)).toBeInTheDocument();
  });
  it('adds a countdown with a generated id and saves only valid data', async () => {
    const p = props();
    render(<Config {...p} />);
    const save = screen.getByRole('button', { name: 'Save countdowns' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add countdown' }));
    fireEvent.change(screen.getByLabelText('Title of New countdown'), { target: { value: 'Exam' } });
    fireEvent.change(screen.getByLabelText('Start date of Exam'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('End date of Exam'), { target: { value: '2027-01-15' } });
    fireEvent.click(save);
    await waitFor(() => expect(p.save).toHaveBeenCalledTimes(1));
    const out = saved(p);
    expect(out.enabled).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ title: 'Exam', startDate: '2026-12-01', endDate: '2027-01-15' });
    expect(featuresSchema.shape.extraCountdowns.safeParse(out).success).toBe(true);
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
  it('blocks an empty title and an end date before the start, with a message', () => {
    const p = props([item('a', 'Trip')]);
    render(<Config {...p} />);
    fireEvent.change(screen.getByLabelText('Title of Trip'), { target: { value: '   ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Give this countdown a title.');
    expect(screen.getByRole('button', { name: 'Save countdowns' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title of countdown 1'), { target: { value: 'Trip' } });
    fireEvent.change(screen.getByLabelText('End date of Trip'), { target: { value: '2026-10-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('End date precedes start date');
    expect(screen.getByLabelText('Title of Trip')).toBeInvalid();
    expect(screen.getByRole('button', { name: 'Save countdowns' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('End date of Trip'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Pick an end date.');
  });
  it('edits, reorders and removes items, saving the new order', async () => {
    const p = props([item('a', 'One'), item('b', 'Two'), item('c', 'Three')]);
    render(<Config {...p} />);
    const titles = () => within(screen.getByRole('list', { name: 'Extra countdowns' })).getAllByRole('textbox').map((i) => (i as HTMLInputElement).value);
    expect(screen.getByRole('button', { name: 'Move One up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Three down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Three up' }));
    expect(titles()).toEqual(['One', 'Three', 'Two']);
    fireEvent.click(screen.getByRole('button', { name: 'Move One down' }));
    expect(titles()).toEqual(['Three', 'One', 'Two']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Two' }));
    fireEvent.change(screen.getByLabelText('Title of One'), { target: { value: 'Uno' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save countdowns' }));
    await waitFor(() => expect(p.save).toHaveBeenCalled());
    expect(saved(p).items.map((i) => [i.id, i.title])).toEqual([['c', 'Three'], ['a', 'Uno']]);
  });
  it('reverts unsaved edits', () => {
    render(<Config {...props([item('a', 'One')])} />);
    fireEvent.change(screen.getByLabelText('Title of One'), { target: { value: 'Changed' } });
    expect(screen.getByText('Unsaved changes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    expect(screen.getByLabelText('Title of One')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save countdowns' })).toBeDisabled();
  });
  it('allows at most 12 items and gives each a distinct id', () => {
    const p = props([]);
    render(<Config {...p} />);
    const add = screen.getByRole('button', { name: 'Add countdown' });
    for (let i = 0; i < 12; i++) fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(screen.getByText('12 / 12')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Extra countdowns' })).getAllByRole('listitem')).toHaveLength(12);
  });
  it('disables editing while busy', () => {
    render(<Config {...props([item('a', 'One')], true)} />);
    expect(screen.getByLabelText('Title of One')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add countdown' })).toBeDisabled();
  });
  it('picks up a list saved elsewhere', () => {
    const { rerender } = render(<Config {...props([item('a', 'One')])} />);
    rerender(<Config {...props([item('a', 'One'), item('b', 'Two')])} />);
    expect(screen.getByLabelText('Title of Two')).toBeInTheDocument();
  });
});

describe('Extra countdowns Today card', () => {
  const now = new Date(2026, 10, 16, 12); // 16 Nov 2026
  function card(items: ExtraCountdown[]) {
    const snapshot = fixture();
    snapshot.preferences.features.extraCountdowns = { enabled: true, items };
    render(<TodayCard snapshot={snapshot} now={now} busy={false} run={vi.fn(async () => true)} confirm={vi.fn(async () => true)} />);
  }
  it('shows title, days left, a progress bar and percent elapsed for each countdown', () => {
    card([item('a', 'Thesis', '2026-11-01', '2026-12-01'), item('b', 'Trip', '2026-11-10', '2026-11-30')]);
    expect(screen.getByRole('heading', { name: 'Thesis' })).toBeInTheDocument();
    const thesis = screen.getByRole('progressbar', { name: /Thesis: \d+% elapsed/ });
    expect(thesis).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('50% elapsed')).toBeInTheDocument();
    const row = screen.getByRole('heading', { name: 'Thesis' }).closest('div') as HTMLElement;
    expect(row).toHaveTextContent('15days left');
    expect(screen.getByRole('heading', { name: 'Trip' }).closest('div')).toHaveTextContent('14days left');
  });
  it('uses the same maths as the main countdown', () => {
    const snapshot = fixture();
    const p = countdownProgress(item('a', 'X', '2026-11-01', '2026-12-01'), snapshot.settings, now);
    expect(p).toMatchObject({ daysLeft: 15, total: 31, elapsed: 16, percent: 50, startsIn: 0, finished: false });
  });
  it('handles countdowns that have not started, end today, or are over', () => {
    card([item('a', 'Later', '2026-12-01', '2026-12-31'), item('b', 'Today', '2026-11-01', '2026-11-16'), item('c', 'Over', '2026-10-01', '2026-10-31')]);
    expect(screen.getByRole('heading', { name: 'Later' }).closest('div')).toHaveTextContent('Not started');
    expect(screen.getByText(/starts in 15 days/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today' }).closest('div')).toHaveTextContent('Last day');
    expect(screen.getByRole('heading', { name: 'Over' }).closest('div')).toHaveTextContent('Finished');
    expect(screen.getByRole('progressbar', { name: /Over: 100% elapsed/ })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Later: 0% elapsed/ })).toBeInTheDocument();
  });
  it('points to Settings when there are no countdowns', () => {
    card([]);
    expect(screen.getByText(/No extra countdowns yet/)).toBeInTheDocument();
  });
});
