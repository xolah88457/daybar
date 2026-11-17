import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Config } from '../src/features/exportHistory';
import {
  csvField,
  csvFiles,
  habitsCsv,
  jsonFile,
  sleepCsv
} from '../src/features/exportHistory.format';
import { fixture } from './fixtures';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', async (original) => ({
  ...(await original<typeof import('@tauri-apps/api/core')>()),
  invoke
}));

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

function props(snapshot = fixture()) {
  return {
    id: 'exportHistory' as const,
    value: snapshot.preferences.features.exportHistory,
    features: snapshot.preferences.features,
    snapshot,
    busy: false,
    save: vi.fn(async () => true)
  };
}
function sample() {
  const s = fixture();
  s.settings.habits.startDate = '2026-11-14';
  s.settings.habits.tasks = ['Read, then "write"', 'Walk'];
  s.dailyLog = { '2026-11-15': ['Read, then "write"'] };
  s.sleep = { wakes: { '2026-11-15': 455 }, beds: { '2026-11-14': 1410 }, plan: null };
  s.focus = {
    state: null,
    days: { '2026-11-15': { count: 1, minutes: 25 } },
    sessions: { '1800000000000': { type: 'focus', minutes: 25, creditedMinutes: 25, end: 1800001500000, date: '2026-11-15', task: 'Walk' } }
  };
  return s;
}

describe('Export history in the browser demo', () => {
  const blobs: Blob[] = [];
  const names: string[] = [];
  beforeEach(() => {
    blobs.length = 0;
    names.length = 0;
    URL.createObjectURL = vi.fn((blob: Blob) => (blobs.push(blob), `blob:${blobs.length}`));
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
  });
  afterEach(() => invoke.mockReset());

  it('offers CSV as four downloads and never calls the native command', async () => {
    render(<Config {...props(sample())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/Browser demo: downloaded/)).toBeInTheDocument();
    expect(names).toEqual(['focus-sessions.csv', 'focus-days.csv', 'habits.csv', 'sleep.csv']);
    expect(invoke).not.toHaveBeenCalled();
    const habits = await readBlob(blobs[2]);
    expect(habits).toContain('2026-11-15,"Read, then ""write""",true\r\n');
    expect(habits).toContain('2026-11-14,Walk,false\r\n');
  });
  it('offers JSON as a single file with settings, daily log, focus and sleep', async () => {
    render(<Config {...props(sample())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    await screen.findByText(/Browser demo: downloaded daybar-export.json/);
    expect(names).toEqual(['daybar-export.json']);
    const data = JSON.parse(await readBlob(blobs[0]));
    expect(Object.keys(data)).toEqual(expect.arrayContaining(['settings', 'dailyLog', 'focus', 'sleep']));
    expect(data.dailyLog['2026-11-15']).toEqual(['Read, then "write"']);
    expect(data.sleep.wakes['2026-11-15']).toBe(455);
  });
  it('disables both buttons while the app is busy', () => {
    render(<Config {...props()} busy />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
  });
});

describe('Export history in the desktop app', () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    invoke.mockReset();
  });
  it('asks Rust to export in the chosen format and shows the folder path', async () => {
    invoke.mockResolvedValue('/Users/me/Downloads/Daybar export 2026-11-16');
    render(<Config {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(await screen.findByText('/Users/me/Downloads/Daybar export 2026-11-16')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('export_history', { format: 'json' });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('export_history', { format: 'csv' }));
  });
  it('shows an error returned by the command', async () => {
    invoke.mockRejectedValue('Could not create /Downloads: permission denied');
    render(<Config {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
    expect(screen.queryByText('Done.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });
});

describe('export formatting (demo twin of the Rust formatter)', () => {
  it('escapes CSV fields', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });
  it('matches the Rust columns and clock format', () => {
    const s = sample();
    expect(sleepCsv(s)).toBe('date,wake,bed\r\n2026-11-14,,23:30\r\n2026-11-15,07:35,\r\n');
    const files = csvFiles(s, new Date(2026, 10, 16, 12));
    expect(files.map((f) => f.name)).toEqual(['focus-sessions.csv', 'focus-days.csv', 'habits.csv', 'sleep.csv']);
    expect(files[0].text.split('\r\n')[0]).toBe('date,type,planned_minutes,credited_minutes,start_utc,end_utc,task');
    expect(files[0].text).toContain('2026-11-15,focus,25,25,2027-01-15T08:00:00Z,2027-01-15T08:25:00Z,Walk');
    expect(files[1].text).toBe('date,blocks,minutes\r\n2026-11-15,1,25\r\n');
  });
  it('writes a habit row for every active task on every day up to today', () => {
    const s = sample();
    const csv = habitsCsv(s, new Date(2026, 10, 16, 9));
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + 3 * 2);
    expect(csv).toContain('2026-11-16,Walk,false');
  });
  it('keeps archived tasks only where they were done', () => {
    const s = sample();
    s.dailyLog['2026-11-14'] = ['Old, task'];
    const csv = habitsCsv(s, new Date(2026, 10, 15, 9));
    expect(csv).toContain('2026-11-14,"Old, task",true');
    expect(csv).not.toContain('Old, task",false');
  });
  it('writes JSON with a trailing newline and no preferences', () => {
    const file = jsonFile(sample(), new Date(Date.UTC(2027, 0, 15, 8)));
    expect(file.text.endsWith('}\n')).toBe(true);
    const data = JSON.parse(file.text);
    expect(data.exportedAt).toBe('2027-01-15T08:00:00Z');
    expect(data.preferences).toBeUndefined();
  });
});
