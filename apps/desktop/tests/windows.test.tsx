import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultFeatures } from '@daybar/core/contracts';
import type { Snapshot } from '@daybar/core/contracts';
import { SettingsPanel } from '../src/components/settings';
import { Config, TodayCard, View } from '../src/features/radar';
import { createDemoRadarClient, googleOnly, setRadarClient } from '../src/features/radarClient';
import { resetAutoRequest } from '../src/features/radarState';
import { device, isWindows, platform } from '../src/lib/platform';
import { demoUpdater } from '../src/lib/updates';
import { fixture } from './fixtures';

const invoke = vi.hoisted(() => vi.fn<(cmd: string) => Promise<string>>(async () => 'G:\\My Drive\\Daybar'));
vi.mock('@tauri-apps/api/core', async (original) => ({
  ...(await original<typeof import('@tauri-apps/api/core')>()),
  invoke
}));

const windowsAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const now = new Date(2026, 10, 16, 12, 0);

function props(snapshot: Snapshot = fixture()) {
  return {
    snapshot,
    now,
    busy: false,
    run: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
    savePreferences: vi.fn(async () => true),
    updater: demoUpdater
  };
}
function radarOn(): Snapshot {
  const s = fixture();
  s.preferences.features.radar = { ...defaultFeatures.radar, enabled: true };
  return s;
}

beforeEach(() => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(windowsAgent);
  resetAutoRequest();
  invoke.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  setRadarClient(null);
});

describe('platform', () => {
  it('reads Windows from the WebView2 user agent and keeps Mac wording elsewhere', () => {
    expect(platform()).toBe('windows');
    expect(device()).toBe('PC');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(isWindows()).toBe(false);
    expect(device()).toBe('Mac');
  });
});

describe('Settings on Windows', () => {
  it('speaks of this PC, the tray and the taskbar, and offers Google Drive instead of iCloud', async () => {
    const p = props();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    try {
      render(<SettingsPanel {...p} />);
      expect(screen.getByRole('heading', { name: 'On this PC' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Tray label' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /Hide taskbar button/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Scriptable folder/ })).toBeNull();
      expect(screen.getByText(/until you connect a Google Drive folder/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Use a Google Drive folder' }));
      await waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Data folder path' })).toHaveValue('G:\\My Drive\\Daybar')
      );
      expect(invoke).toHaveBeenCalledWith('google_drive_folder');
      expect(screen.getByRole('checkbox', { name: /This is my real shared data/ })).toBeChecked();
      // Still behind explicit consent.
      expect(screen.getByRole('button', { name: 'Save PC preferences ↗' })).toBeDisabled();
      fireEvent.click(screen.getByRole('checkbox', { name: /shared with my other computers/ }));
      expect(screen.getByRole('button', { name: 'Save PC preferences ↗' })).toBeEnabled();
    } finally {
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });
  it('shows why Google Drive could not be used', async () => {
    invoke.mockRejectedValueOnce('Google Drive for desktop was not found.');
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    try {
      render(<SettingsPanel {...props()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Use a Google Drive folder' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Google Drive for desktop was not found.');
    } finally {
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });
  it('does not list macOS Shortcuts among the features', () => {
    render(<SettingsPanel {...props()} />);
    const features = screen.getByRole('heading', { name: 'Features' }).closest('section') as HTMLElement;
    expect(features.querySelector('[data-feature="focusShortcuts"]')).toBeNull();
    expect(features.querySelector('[data-feature="awayDetection"]')).not.toBeNull();
    expect(within(features).getByText('APP-LOCAL · THIS PC ONLY')).toBeInTheDocument();
  });
});

describe('Deadline Radar on Windows', () => {
  it('asks for a Google sign-in on the page itself, then shows Google events and tasks', async () => {
    const client = createDemoRadarClient({ clock: () => now, status: googleOnly });
    setRadarClient(client);
    render(<View {...props(radarOn())} />);
    expect(await screen.findByText(/Sign in with Google to see your upcoming events/)).toBeInTheDocument();
    expect(screen.getByText('GOOGLE CALENDAR + TASKS')).toBeInTheDocument();
    const google = within(await screen.findByRole('group', { name: 'Google Calendar and Tasks' }));
    expect(google.getByText(/Windows Credential Manager/)).toBeInTheDocument();
    fireEvent.change(google.getByLabelText('Client ID'), { target: { value: '12-ab.apps.googleusercontent.com' } });
    fireEvent.change(google.getByLabelText('Client secret'), { target: { value: 'shh' } });
    fireEvent.click(google.getByRole('button', { name: 'Connect Google' }));
    expect(await screen.findByText('Team offsite planning')).toBeInTheDocument();
    expect(screen.getByText('Submit expense report')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Sign in with Google to see/)).toBeNull());
    expect(screen.queryByText(/System Settings/)).toBeNull();
  });
  it('points the Today card at the sign-in', async () => {
    setRadarClient(createDemoRadarClient({ clock: () => now, status: googleOnly }));
    render(<TodayCard {...props(radarOn())} />);
    expect(await screen.findByText(/Open Deadline Radar in the sidebar to sign in/)).toBeInTheDocument();
  });
  it('calls reminder lists Google Tasks lists in its settings', async () => {
    setRadarClient(createDemoRadarClient({ clock: () => now, status: googleOnly, google: true }));
    const snapshot = radarOn();
    render(
      <Config
        id="radar"
        value={snapshot.preferences.features.radar}
        features={snapshot.preferences.features}
        snapshot={snapshot}
        busy={false}
        save={vi.fn(async () => true)}
      />
    );
    expect(await screen.findByRole('checkbox', { name: 'Include Google Tasks with a due date' })).toBeChecked();
    const lists = within(await screen.findByRole('group', { name: 'Task lists' }));
    expect(await lists.findByRole('checkbox', { name: /My Tasks/ })).toBeInTheDocument();
    expect(screen.queryByText(/Grant access/)).toBeNull();
  });
  it('the browser demo opened on Windows starts signed in to Google', async () => {
    const client = createDemoRadarClient({ clock: () => now });
    expect(await client.status()).toMatchObject({ supported: false, google: true, googleSupported: true });
    const items = (await client.items()).items.map((i) => i.title);
    expect(items).toContain('Submit expense report');
    expect(items).toContain('Design review');
    expect((await client.calendars()).events.every((c) => c.account.startsWith('Google'))).toBe(true);
  });
});
