import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../src/components/dashboard';
import { SettingsPanel } from '../src/components/settings';
import { UpdatesPanel } from '../src/components/updates';
import { createDemoClient } from '../src/lib/demo';
import { demoUpdater } from '../src/lib/updates';
import type {
  UpdateInfo,
  UpdateProgress,
  UpdaterClient
} from '../src/lib/updates';
import { fixture } from './fixtures';

const info: UpdateInfo = {
  version: '0.3.0',
  notes: 'Faster heatmap\n- Fixed a bug',
  date: '2026-11-20T10:00:00Z'
};
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
function mockUpdater(overrides: Partial<UpdaterClient> = {}) {
  const updater = {
    supported: true,
    version: vi.fn(async () => '0.2.0'),
    check: vi.fn(async (): Promise<UpdateInfo | null> => null),
    downloadAndInstall: vi.fn<UpdaterClient['downloadAndInstall']>(
      async () => {}
    ),
    restart: vi.fn(async () => {}),
    ...overrides
  };
  return updater satisfies UpdaterClient;
}
function panel(
  updater: UpdaterClient,
  extra: Partial<Parameters<typeof UpdatesPanel>[0]> = {}
) {
  const props = {
    updater,
    busy: false,
    hasUnsavedChanges: () => false,
    confirm: vi.fn(async () => true),
    ...extra
  };
  render(<UpdatesPanel {...props} />);
  return props;
}
const checkButton = () =>
  screen.getByRole('button', { name: 'Check for updates' });

describe('Updates settings section', () => {
  it('shows the version and never checks on its own', async () => {
    const updater = mockUpdater();
    panel(updater);
    expect(await screen.findByText('Version 0.2.0')).toBeInTheDocument();
    expect(checkButton()).toBeEnabled();
    expect(updater.check).not.toHaveBeenCalled();
    expect(updater.downloadAndInstall).not.toHaveBeenCalled();
  });
  it('does not check when Settings is opened inside the dashboard', async () => {
    const updater = mockUpdater();
    render(<Dashboard client={createDemoClient()} updater={updater} />);
    fireEvent.click(
      within(
        await screen.findByRole('navigation', { name: 'Modules' })
      ).getByRole('button', { name: /Settings/ })
    );
    expect(
      await screen.findByRole('heading', { name: 'Updates' })
    ).toBeInTheDocument();
    await screen.findByText('Version 0.2.0');
    expect(updater.check).not.toHaveBeenCalled();
  });
  it('reports being up to date, then allows checking again', async () => {
    const updater = mockUpdater();
    panel(updater);
    await screen.findByText('Version 0.2.0');
    fireEvent.click(checkButton());
    expect(
      await screen.findByText('You’re up to date (v0.2.0).')
    ).toBeInTheDocument();
    expect(updater.downloadAndInstall).not.toHaveBeenCalled();
    expect(checkButton()).toBeEnabled();
    fireEvent.click(checkButton());
    await waitFor(() => expect(updater.check).toHaveBeenCalledTimes(2));
  });
  it('disables the button while checking', async () => {
    const check = deferred<UpdateInfo | null>();
    const updater = mockUpdater({ check: vi.fn(() => check.promise) });
    panel(updater);
    fireEvent.click(checkButton());
    expect(
      await screen.findByText('Checking for updates…')
    ).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
    fireEvent.click(checkButton());
    expect(updater.check).toHaveBeenCalledTimes(1);
    await act(async () => check.resolve(null));
    expect(checkButton()).toBeEnabled();
  });
  it('downloads a found update with progress, then restarts on request', async () => {
    const download = deferred();
    let report!: (p: UpdateProgress) => void;
    const updater = mockUpdater({
      check: vi.fn(async () => info),
      downloadAndInstall: vi.fn((onProgress) => {
        report = onProgress;
        return download.promise;
      })
    });
    panel(updater);
    fireEvent.click(checkButton());
    expect(
      await screen.findByText('Downloading Daybar 0.3.0…')
    ).toBeInTheDocument();
    expect(screen.getByText(/Faster heatmap/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Starting download…')).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
    act(() => report({ downloaded: 250, total: 1000 }));
    expect(
      screen.getByRole('progressbar', { name: 'Download progress' })
    ).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(updater.restart).not.toHaveBeenCalled();
    await act(async () => download.resolve());
    expect(
      await screen.findByText(/Daybar 0.3.0 is ready/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(updater.restart).toHaveBeenCalledTimes(1));
  });
  it('shows downloaded size when the total is unknown', async () => {
    let report!: (p: UpdateProgress) => void;
    const updater = mockUpdater({
      check: vi.fn(async () => ({ ...info, notes: '', date: null })),
      downloadAndInstall: vi.fn((onProgress) => {
        report = onProgress;
        return new Promise<void>(() => {});
      })
    });
    panel(updater);
    fireEvent.click(checkButton());
    await screen.findByText('Starting download…');
    act(() => report({ downloaded: 3 * 1_048_576, total: null }));
    expect(screen.getByText('3.0 MB downloaded…')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Release notes')).not.toBeInTheDocument();
  });
  it('shows a friendly error when the check fails and recovers on retry', async () => {
    const updater = mockUpdater({
      check: vi
        .fn<UpdaterClient['check']>()
        .mockRejectedValueOnce(new Error('error sending request: dns error'))
        .mockResolvedValueOnce(null)
    });
    panel(updater);
    fireEvent.click(checkButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not check for updates');
    expect(alert).not.toHaveTextContent('dns');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('You’re up to date (v0.2.0).')
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('shows a friendly error when the download fails and retries from a fresh check', async () => {
    const updater = mockUpdater({
      check: vi.fn(async () => info),
      downloadAndInstall: vi
        .fn<UpdaterClient['downloadAndInstall']>()
        .mockRejectedValueOnce(new Error('signature mismatch'))
        .mockResolvedValueOnce(undefined)
    });
    panel(updater);
    fireEvent.click(checkButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not download or install Daybar 0.3.0'
    );
    expect(alert).not.toHaveTextContent('signature');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: 'Restart now' })
    ).toBeEnabled();
    expect(updater.check).toHaveBeenCalledTimes(2);
  });
  it('reports a failed relaunch without hiding that the update is installed', async () => {
    const updater = mockUpdater({
      check: vi.fn(async () => info),
      restart: vi.fn(async () => {
        throw new Error('relaunch denied');
      })
    });
    panel(updater);
    fireEvent.click(checkButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Restart now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Quit and reopen Daybar'
    );
  });
  it('asks before restarting only when there are unsaved edits', async () => {
    const confirm = vi.fn(async () => false);
    const updater = mockUpdater({ check: vi.fn(async () => info) });
    panel(updater, { hasUnsavedChanges: () => true, confirm });
    fireEvent.click(checkButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Restart now' }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining('unsaved changes')
      )
    );
    expect(updater.restart).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(updater.restart).toHaveBeenCalledTimes(1));
  });
  it('disables Restart while a save is in progress', async () => {
    const updater = mockUpdater({ check: vi.fn(async () => info) });
    const props = {
      updater,
      hasUnsavedChanges: () => false,
      confirm: async () => true
    };
    const { rerender } = render(<UpdatesPanel {...props} busy={false} />);
    fireEvent.click(checkButton());
    expect(
      await screen.findByRole('button', { name: 'Restart now' })
    ).toBeEnabled();
    rerender(<UpdatesPanel {...props} busy />);
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeDisabled();
  });
  it('shows only the version and a desktop-app note in the browser demo', async () => {
    const check = vi.spyOn(demoUpdater, 'check');
    panel(demoUpdater);
    expect(
      await screen.findByText(/^Version \d+\.\d+\.\d+/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/available in the desktop app/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /check for updates/i })
    ).not.toBeInTheDocument();
    expect(check).not.toHaveBeenCalled();
  });
});

describe('Settings integration of the restart guard', () => {
  function setup() {
    const updater = mockUpdater({ check: vi.fn(async () => info) });
    const confirm = vi.fn(async () => false);
    render(
      <SettingsPanel
        snapshot={fixture()}
        now={new Date(2026, 10, 15, 12)}
        busy={false}
        run={vi.fn(async () => true)}
        confirm={confirm}
        savePreferences={vi.fn(async () => true)}
        updater={updater}
      />
    );
    return { updater, confirm };
  }
  it('restarts without a prompt when nothing is unsaved', async () => {
    const { updater, confirm } = setup();
    fireEvent.click(checkButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(updater.restart).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });
  it('prompts when the shared-settings draft has unsaved edits', async () => {
    const { updater, confirm } = setup();
    fireEvent.change(screen.getByLabelText(/Block Minutes/), {
      target: { value: '45' }
    });
    fireEvent.click(checkButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(updater.restart).not.toHaveBeenCalled();
  });
  it('prompts when the Mac preferences draft has unsaved edits', async () => {
    const { updater, confirm } = setup();
    fireEvent.change(screen.getByLabelText('Appearance'), {
      target: { value: 'day' }
    });
    fireEvent.click(checkButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(updater.restart).not.toHaveBeenCalled();
  });
});
