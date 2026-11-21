import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { key } from '@daybar/core';
import type { DaybarClient } from '@daybar/core/contracts';
import { Dashboard } from '../src/components/dashboard';
import { createDemoClient } from '../src/lib/demo';
import { fixture } from './fixtures';

function setup() {
  const s = fixture();
  s.settings.habits.startDate = key(new Date(Date.now() - 10 * 864e5));
  const client = createDemoClient(s);
  const spy: DaybarClient = { ...client, mutate: vi.fn(client.mutate) };
  render(<Dashboard client={spy} />);
  return spy;
}
const nav = () => within(screen.getByRole('navigation', { name: 'Modules' }));
const h1 = () => screen.getByRole('heading', { level: 1 });
const open = (name: RegExp | string) => fireEvent.click(nav().getByRole('button', { name }));

afterEach(() => vi.restoreAllMocks());

describe('subtasks', () => {
  it('stay collapsed, tick the parent once all are done and untick it when one is undone', async () => {
    setup();
    const parent = await screen.findByRole('checkbox', { name: /Read a chapter/ });
    fireEvent.click(screen.getByRole('button', { name: 'Add subtasks to Read a chapter' }));
    for (const name of ['Pick the book', 'Read 20 pages']) {
      fireEvent.change(screen.getByLabelText('New subtask for Read a chapter'), { target: { value: name } });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      await screen.findByRole('checkbox', { name });
    }
    const toggle = screen.getByRole('button', { name: /subtasks of Read a chapter, 0 of 2 done/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('0/2');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Pick the book' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Pick the book' })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: /Read a chapter/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read 20 pages' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Read a chapter/ })).toBeChecked());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Pick the book' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Read a chapter/ })).not.toBeChecked());
    expect(screen.getByRole('checkbox', { name: 'Read 20 pages' })).toBeChecked();

    // Collapsing keeps the count visible and hides the rows.
    fireEvent.click(screen.getByRole('button', { name: /Hide subtasks of Read a chapter/ }));
    expect(screen.queryByRole('checkbox', { name: 'Read 20 pages' })).toBeNull();
    expect(screen.getByRole('button', { name: /Show subtasks of Read a chapter, 1 of 2 done/ })).toHaveTextContent('1/2');
    expect(parent).toBeInTheDocument();
  });

  it('tick and clear every subtask with the parent, and can be removed', async () => {
    setup();
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    fireEvent.click(screen.getByRole('button', { name: 'Add subtasks to Read a chapter' }));
    fireEvent.change(screen.getByLabelText('New subtask for Read a chapter'), { target: { value: 'Notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByRole('checkbox', { name: 'Notes' });
    fireEvent.click(screen.getByRole('checkbox', { name: /Read a chapter/ }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Notes' })).toBeChecked());
    fireEvent.change(screen.getByLabelText('New subtask for Read a chapter'), { target: { value: 'Notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    fireEvent.click(screen.getByRole('button', { name: 'Remove subtask Notes' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Notes' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Add subtasks to Read a chapter' })).toBeInTheDocument();
  });
});

describe('spaces', () => {
  it('are created from the Overview, get their own page and count on the Overview', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const client = setup();
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    open(/Overview/);
    expect(h1()).toHaveTextContent('Overview');
    fireEvent.change(screen.getByPlaceholderText('Work'), { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create space +' }));
    await waitFor(() => expect(h1()).toHaveTextContent('Work'));
    expect(nav().getByRole('button', { name: /Work/ })).toBeInTheDocument();

    // Its own checklist: ticking it leaves the main list alone.
    fireEvent.click(await screen.findByRole('checkbox', { name: /First task/ }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /First task/ })).toBeChecked());
    expect((await client.snapshot()).dailyLog[key(new Date())] ?? []).toEqual([]);

    // A focus session started here is credited to the space.
    fireEvent.click(screen.getAllByRole('button', { name: /min$/ })[0]);
    await screen.findByText('IN PROGRESS');
    const snap = await client.snapshot();
    expect(snap.spaces.focus[String(snap.focus.state?.start)]).toEqual({ space: 'work' });

    open(/Overview/);
    const card = document.querySelector('[data-space="work"]') as HTMLElement;
    expect(within(card).getByText('FOCUSING')).toBeInTheDocument();
    expect(card).toHaveTextContent('1 / 1 today');
    fireEvent.click(within(card).getByRole('button', { name: 'Open Work →' }));
    expect(h1()).toHaveTextContent('Work');

    // Removing the space keeps its history file and goes back to the Overview.
    fireEvent.click(screen.getByRole('button', { name: 'Remove space…' }));
    await waitFor(() => expect(h1()).toHaveTextContent('Overview'));
    expect(nav().queryByRole('button', { name: /Work/ })).toBeNull();
    await act(async () => undefined);
  });

  it('add, rename and archive their own tasks', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setup();
    await screen.findByRole('checkbox', { name: /Read a chapter/ });
    open(/Overview/);
    fireEvent.change(screen.getByPlaceholderText('Work'), { target: { value: 'Study' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create space +' }));
    await waitFor(() => expect(h1()).toHaveTextContent('Study'));
    fireEvent.change(screen.getByRole('textbox', { name: 'New task' }), { target: { value: 'Flashcards' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task +' }));
    await screen.findByRole('checkbox', { name: /Flashcards/ });
    fireEvent.change(screen.getByLabelText('New name for First task'), { target: { value: 'Lecture' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename…' })[0]);
    await screen.findByRole('checkbox', { name: /Lecture/ });
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive…' })[1]);
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Flashcards/ })).toBeNull());
    expect(screen.getAllByText(/Archived, history preserved: Flashcards/).length).toBeGreaterThan(0);
    // The main space is untouched.
    open(/Habits/);
    expect(screen.getByRole('checkbox', { name: /Read a chapter/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Lecture/ })).toBeNull();
  });
});
