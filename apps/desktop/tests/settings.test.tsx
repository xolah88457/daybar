import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/components/settings';
import { DayProgress, Focus } from '../src/components/modules';
import { demoUpdater } from '../src/lib/updates';
import { fixture } from './fixtures';

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => '/Users/me',
  join: async (...parts: string[]) => parts.join('/')
}));

const now = new Date(2026, 10, 15, 12);
function props() {
  return {
    snapshot: fixture(),
    now,
    busy: false,
    run: vi.fn(async () => true),
    confirm: vi.fn(async (message: string) => window.confirm(message)),
    savePreferences: vi.fn(async () => true),
    updater: demoUpdater
  };
}

describe('settings and safety controls', () => {
  it('validates shared settings before sending and parses configurable preset lists', async () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.click(screen.getByText('Focus', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText(/Block Minutes/), {
      target: { value: '0' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save shared settings ↗' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'focus.blockMinutes'
    );
    expect(p.run).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Block Minutes/), {
      target: { value: '30' }
    });
    fireEvent.change(screen.getByLabelText('Focus Options'), {
      target: { value: '30, 60' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save shared settings ↗' })
    );
    await waitFor(() =>
      expect(p.run).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'save_settings',
          settings: expect.objectContaining({
            focus: expect.objectContaining({
              blockMinutes: 30,
              focusOptions: [30, 60]
            })
          })
        })
      )
    );
  });
  it('confirms history-bearing rename and archive operations', async () => {
    const p = props();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsPanel {...p} />);
    fireEvent.change(
      screen.getByRole('textbox', { name: 'New name for Read a chapter' }),
      { target: { value: 'Read every day' } }
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename…' })[0]);
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(p.run).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename…' })[0]);
    await waitFor(() =>
      expect(p.run).toHaveBeenCalledWith({
        kind: 'rename_task',
        from: 'Read a chapter',
        to: 'Read every day'
      })
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive…' })[0]);
    await waitFor(() =>
      expect(p.run).toHaveBeenCalledWith({
        kind: 'archive_task',
        task: 'Read a chapter'
      })
    );
  });
  it('requires explicit real-folder opt-in and confirmation before changing preferences', async () => {
    const p = props();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsPanel {...p} />);
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Data folder path' }),
      { target: { value: '/tmp/user-selected-shared-folder' } }
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /This is my real shared data/ })
    );
    const save = screen.getByRole('button', { name: 'Save Mac preferences ↗' });
    expect(save).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I understand this connects real data/
      })
    );
    fireEvent.click(save);
    expect(p.savePreferences).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(save);
    await waitFor(() =>
      expect(p.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          dataFolder: '/tmp/user-selected-shared-folder',
          realData: true
        })
      )
    );
  });
  it('fills in the iPhone Scriptable folder in the desktop app, still behind consent', async () => {
    const p = props();
    expect(
      render(<SettingsPanel {...p} />).queryByRole('button', { name: /iPhone’s Scriptable folder/ })
    ).toBeNull();
    document.body.innerHTML = '';
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    try {
      render(<SettingsPanel {...p} />);
      expect(screen.getByText(/Not synced/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /iPhone’s Scriptable folder/ }));
      await waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Data folder path' })).toHaveValue(
          '/Users/me/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents'
        )
      );
      expect(screen.getByRole('checkbox', { name: /This is my real shared data/ })).toBeChecked();
      expect(screen.getByRole('button', { name: 'Save Mac preferences ↗' })).toBeDisabled();
    } finally {
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });
  it('shows logId as read-only with stable identifier hint', () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.click(screen.getByText('Habits', { selector: 'summary' }));
    const logIdInput = screen.getByLabelText(/Log Id/);
    expect(logIdInput).toHaveAttribute('readonly');
    expect(screen.getByText('Stable identifier for the habit log file. Cannot be changed here.')).toBeInTheDocument();
  });
  it('saves the selected menu-bar label as an app-local preference', async () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Menu-bar label' }), {
      target: { value: 'focusMinutes' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Mac preferences ↗' }));
    await waitFor(() => expect(p.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ trayDisplay: 'focusMinutes', themeMode: 'night' })
    ));
    expect(p.run).not.toHaveBeenCalled();
  });
  it('saves app-local appearance through the preferences API without changing shared settings', async () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Appearance' }), {
      target: { value: 'auto' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Mac preferences ↗' })
    );
    await waitFor(() =>
      expect(p.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ themeMode: 'auto' })
      )
    );
    expect(p.run).not.toHaveBeenCalled();
  });
  it('states accurately that the network is used only for update checks', () => {
    render(<SettingsPanel {...props()} />);
    expect(
      screen.getByText(
        /uses no location access, and uses the network only when you click Check for updates/
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/no location or network/)).not.toBeInTheDocument();
  });
  it('does not overwrite externally changed settings from an old draft', () => {
    const p = props();
    const { rerender } = render(<SettingsPanel {...p} />);
    const next = fixture();
    next.settings.focus.title = 'Phone edited title';
    rerender(<SettingsPanel {...p} snapshot={next} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Settings changed outside this editor'
    );
    expect(
      screen.getByRole('button', { name: 'Save shared settings ↗' })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));
    expect(
      screen.getByRole('button', { name: 'Save shared settings ↗' })
    ).toBeEnabled();
  });
});

describe('sleep and focus presentation', () => {
  it('uses the legacy dimmed sleeping status for an estimated future wake', () => {
    const p = props();
    render(<DayProgress {...p} now={new Date(2026, 10, 15, 4)} />);
    expect(screen.getByRole('heading', { name: 'Wake in 4h' })).toHaveStyle({
      opacity: '0.4'
    });
    expect(screen.getByText('SLEEPING')).toBeInTheDocument();
    expect(screen.getByText(/Wake.*\(est\)/)).toBeInTheDocument();
  });
  it('requires gentle confirmation during no-phone time and sends the selected task tag', async () => {
    const p = props();
    p.snapshot.sleep.wakes['2026-11-15'] = 480;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Focus {...p} now={new Date(2026, 10, 15, 23, 30)} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Link a task' }), {
      target: { value: 'Take a walk' }
    });
    fireEvent.click(screen.getByRole('button', { name: '25 min ↗' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(p.run).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '25 min ↗' }));
    await waitFor(() =>
      expect(p.run).toHaveBeenCalledWith({
        kind: 'start_timer',
        timerType: 'focus',
        minutes: 25,
        task: 'Take a walk'
      })
    );
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('no-phone'));
  });
});
