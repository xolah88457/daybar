'use client';
import { useEffect, useRef, useState } from 'react';
import { preferencesSchema, settingsSchema } from '@daybar/core/contracts';
import type { Preferences, Settings, Snapshot } from '@daybar/core/contracts';
import type { Actions } from './modules';
import type { UpdaterClient } from '../lib/updates';
import { Section } from './primitives';
import { UpdatesPanel } from './updates';

const label = (name: string) =>
  name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
type Group = 'countdown' | 'habits' | 'focus' | 'sleep' | 'appearance';
const groups: Group[] = ['countdown', 'habits', 'focus', 'sleep', 'appearance'];
const hints: Record<string, string> = {
  endDate: 'Required for Countdown; leave Habits empty for a rolling window.',
  logId:
    'Stable identifier for the habit log file. Cannot be changed here.',
  dayCompleteMin: 'Tasks needed to complete a day.',
  blockMinutes: 'Partial sessions accumulate into whole blocks.',
  targetBed: 'Empty = target wake minus sleep hours.',
  averageDays: 'Circular average of the latest logged days.',
  rows: 'Legacy grids always have seven rows.',
  gap: 'Square spacing in pixels.',
  minDoneOpacity: 'Brightness at the low end of partial completion.'
};

export function SettingsPanel({
  snapshot,
  busy,
  run,
  confirm,
  savePreferences,
  updater
}: Actions & {
  savePreferences: (p: Preferences) => Promise<boolean>;
  updater: UpdaterClient;
}) {
  const [draft, setDraft] = useState<Settings>(() =>
    structuredClone(snapshot.settings)
  );
  const [source, setSource] = useState(() => JSON.stringify(snapshot.settings));
  const [presetText, setPresetText] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [newTask, setNewTask] = useState('');
  const [rename, setRename] = useState<Record<string, string>>({});
  const changedExternally = source !== JSON.stringify(snapshot.settings);
  const preferencesDirty = useRef(false);
  const hasUnsavedChanges = () =>
    preferencesDirty.current ||
    JSON.stringify(draft) !== source ||
    Object.keys(presetText).length > 0;
  const reload = () => {
    setDraft(structuredClone(snapshot.settings));
    setSource(JSON.stringify(snapshot.settings));
    setPresetText({});
    setError('');
  };
  const update = (group: Group, field: string, value: unknown) =>
    setDraft((d) => ({ ...d, [group]: { ...d[group], [field]: value } }));
  const save = async () => {
    setError('');
    const candidate = structuredClone(draft);
    for (const [field, text] of Object.entries(presetText)) {
      const values = text.split(',').map((v) => Number(v.trim()));
      if (!text.trim() || text.split(',').some((v) => !v.trim())) {
        setError(`${label(field)}: enter comma-separated whole minutes.`);
        return;
      }
      Object.assign(candidate.focus, { [field]: values });
    }
    const parsed = settingsSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => `${i.path.join('.') || 'Settings'}: ${i.message}`)
          .join(' · ')
      );
      return;
    }
    if (await run({ kind: 'save_settings', settings: parsed.data })) {
      setDraft(parsed.data);
      setSource(JSON.stringify(parsed.data));
      setPresetText({});
    }
  };
  return (
    <>
      <Section
        title="Make it your day"
        aside={<span className="tag">SHARED SETTINGS · v1</span>}
      >
        <p className="muted">
          These settings are shared with the updated phone widgets. Changes are
          validated before saving. Layout follows the window, not a fixed widget
          width.
        </p>
        {changedExternally && (
          <div className="notice warning" role="alert">
            Settings changed outside this editor. Reload before editing or
            saving so another device’s changes are not overwritten.{' '}
            <button onClick={reload}>Reload settings</button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset
            disabled={busy || changedExternally || snapshot.issues.length > 0}
            className="settings-fields"
          >
            {groups.map((group) => (
              <details key={group} open={group === 'countdown'}>
                <summary>
                  {label(group)} <span>↙</span>
                </summary>
                <div className="field-grid">
                  {Object.entries(draft[group])
                    .filter(
                      ([field]) =>
                        !['tasks', 'archivedTasks', 'focusThresholds'].includes(
                          field
                        )
                    )
                    .map(([field, value]) => (
                      <label className="field" key={field}>
                        <span>{label(field)}</span>
                        {typeof value === 'boolean' ? (
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) =>
                              update(group, field, e.target.checked)
                            }
                          />
                        ) : Array.isArray(value) ? (
                          <input
                            value={presetText[field] ?? value.join(', ')}
                            onChange={(e) =>
                              setPresetText((t) => ({
                                ...t,
                                [field]: e.target.value
                              }))
                            }
                            aria-label={label(field)}
                          />
                        ) : (
                          <input
                            type={
                              field.includes('Date')
                                ? 'date'
                                : field === 'targetWake' ||
                                    field === 'targetBed'
                                  ? 'time'
                                  : typeof value === 'number'
                                    ? 'number'
                                    : 'text'
                            }
                            step={typeof value === 'number' ? 'any' : undefined}
                            readOnly={field === 'rows' || field === 'logId'}
                            value={value as string | number}
                            onChange={(e) =>
                              update(
                                group,
                                field,
                                typeof value === 'number'
                                  ? Number(e.target.value)
                                  : e.target.value
                              )
                            }
                          />
                        )}
                        {hints[field] && <small>{hints[field]}</small>}
                      </label>
                    ))}
                </div>
              </details>
            ))}
            <details open>
              <summary>
                Task focus thresholds <span>↙</span>
              </summary>
              <p className="caption">
                Tagged focus minutes automatically check a task at its
                threshold. Empty disables the link. Task names and history are
                managed below.
              </p>
              <div className="field-grid">
                {draft.habits.tasks.map((task) => (
                  <label className="field" key={task}>
                    <span>{task} · minutes / day</span>
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      step="1"
                      value={draft.habits.focusThresholds[task] ?? ''}
                      onChange={(e) => {
                        const thresholds = { ...draft.habits.focusThresholds };
                        if (e.target.value)
                          thresholds[task] = Number(e.target.value);
                        else delete thresholds[task];
                        update('habits', 'focusThresholds', thresholds);
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button className="primary" type="submit">
                Save shared settings ↗
              </button>
              <button type="button" onClick={reload}>
                Reset draft
              </button>
            </div>
          </fieldset>
        </form>
      </Section>
      <Section
        title="Tasks, with their history"
        aside={<span className="tag">ARCHIVE, NEVER ERASE</span>}
      >
        <p className="caption">
          Save or reset the settings draft before managing tasks. Renames carry
          past checks, timer tags, and thresholds. Archived tasks stay in the
          log but no longer count toward completion.
        </p>
        <fieldset
          disabled={busy || snapshot.issues.length > 0}
          className="task-manager"
        >
          {snapshot.settings.habits.tasks.map((task) => (
            <div className="task-edit" key={task}>
              <label>
                {task}
                <input
                  aria-label={`New name for ${task}`}
                  value={rename[task] ?? task}
                  onChange={(e) =>
                    setRename((r) => ({ ...r, [task]: e.target.value }))
                  }
                />
              </label>
              <button
                disabled={!rename[task]?.trim() || rename[task].trim() === task}
                onClick={async () => {
                  if (
                    await confirm(
                      `Rename “${task}” to “${rename[task].trim()}” across ALL history and focus tags?`
                    )
                  )
                    void run({
                      kind: 'rename_task',
                      from: task,
                      to: rename[task].trim()
                    });
                }}
              >
                Rename…
              </button>
              <button
                className="subtle-danger"
                disabled={snapshot.settings.habits.tasks.length <= 1}
                onClick={async () => {
                  if (
                    await confirm(
                      `Archive “${task}”? History is kept, but this task will no longer count toward daily completion.`
                    )
                  )
                    void run({ kind: 'archive_task', task });
                }}
              >
                Archive…
              </button>
            </div>
          ))}
          <form
            className="button-row"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newTask.trim();
              if (
                !name ||
                [
                  ...snapshot.settings.habits.tasks,
                  ...snapshot.settings.habits.archivedTasks
                ].includes(name)
              ) {
                setError('Choose a new, unique task name.');
                return;
              }
              const settings = structuredClone(snapshot.settings);
              settings.habits.tasks.push(name);
              void run({ kind: 'save_settings', settings }).then((ok) => {
                if (ok) setNewTask('');
              });
            }}
          >
            <label className="inline-field">
              New task
              <input
                required
                maxLength={120}
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
              />
            </label>
            <button>Add task +</button>
          </form>
        </fieldset>
        {snapshot.settings.habits.archivedTasks.length > 0 && (
          <p className="caption">
            Archived: {snapshot.settings.habits.archivedTasks.join(' · ')}
          </p>
        )}
      </Section>
      <PreferencesPanel
        key={JSON.stringify(snapshot.preferences)}
        snapshot={snapshot}
        busy={busy}
        confirm={confirm}
        save={savePreferences}
        dirty={preferencesDirty}
      />
      <UpdatesPanel
        updater={updater}
        busy={busy}
        hasUnsavedChanges={hasUnsavedChanges}
        confirm={confirm}
      />
      <Section title="Keyboard, not mouse">
        <div className="shortcut-list">
          <p>
            <kbd>1–6</kbd>
            <span>Today / Countdown / Habits / Focus / Sleep / Settings</span>
          </p>
          <p>
            <kbd>⌘ / Ctrl</kbd> + <kbd>1–6</kbd>
            <span>Same module shortcuts when using a modifier</span>
          </p>
          <p>
            <kbd>⌘ / Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd>
            <span>Start default focus / stop timer</span>
          </p>
        </div>
        <p className="caption">
          Window shortcuts leave text fields alone. The configurable global
          shortcut is registered by the desktop app.
        </p>
      </Section>
    </>
  );
}

function PreferencesPanel({
  snapshot,
  busy,
  confirm,
  save,
  dirty
}: {
  snapshot: Snapshot;
  busy: boolean;
  confirm: Actions['confirm'];
  save: (p: Preferences) => Promise<boolean>;
  dirty: { current: boolean };
}) {
  const [draft, setDraft] = useState(() => ({ ...snapshot.preferences }));
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const edited = JSON.stringify(draft) !== JSON.stringify(snapshot.preferences);
  useEffect(() => {
    dirty.current = edited;
    return () => {
      dirty.current = false;
    };
  }, [dirty, edited]);
  const changedFolder =
    draft.dataFolder !== snapshot.preferences.dataFolder ||
    draft.realData !== snapshot.preferences.realData;
  const set = <K extends keyof Preferences>(field: K, value: Preferences[K]) =>
    setDraft((p) => ({ ...p, [field]: value }));
  const submit = async () => {
    const parsed = preferencesSchema.safeParse(draft);
    if (!parsed.success || !draft.dataFolder.trim()) {
      setError('Enter a data folder and valid desktop preferences.');
      return;
    }
    if (
      draft.realData &&
      changedFolder &&
      (!consent ||
        !(await confirm(
          'Connect this real data folder? Daybar will read its JSON files and back up managed files before its first write. The phone and Mac will share changes.'
        )))
    )
      return;
    setError('');
    await save(parsed.data);
  };
  return (
    <Section
      title="On this Mac"
      aside={<span className="tag">APP-LOCAL PREFERENCES</span>}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="preferences">
          <label className="field">
            Appearance
            <select
              aria-label="Appearance"
              value={draft.themeMode}
              onChange={(e) =>
                set('themeMode', e.target.value as Preferences['themeMode'])
              }
            >
              <option value="day">Day</option>
              <option value="night">Night</option>
              <option value="auto">Auto · follow system appearance</option>
            </select>
            <small>Auto follows macOS appearance. Set macOS to Auto for its scheduled day/night changes; Daybar uses no location access, and uses the network only when you click Check for updates.</small>
          </label>
          <label className="field">
            Menu-bar label
            <select
              aria-label="Menu-bar label"
              value={draft.trayDisplay}
              onChange={(e) =>
                set('trayDisplay', e.target.value as Preferences['trayDisplay'])
              }
            >
              <option value="auto">Auto · timer, then bedtime</option>
              <option value="focusMinutes">Today's focus minutes</option>
              <option value="focusHours">Today's focus hours</option>
              <option value="focusBlocks">Today's focus blocks</option>
              <option value="activeTimer">Active timer</option>
              <option value="bedtime">Time until bed</option>
              <option value="nextTask">Next task</option>
              <option value="countdown">Countdown days left</option>
            </select>
            <small>Mac-only display. Focus totals count credited minutes only; the browser demo cannot change the menu bar.</small>
          </label>
          <label className="field">
            Data folder path
            <input
              value={draft.dataFolder}
              onChange={(e) => {
                set('dataFolder', e.target.value);
                setConsent(false);
              }}
              spellCheck={false}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.realData}
              onChange={(e) => {
                set('realData', e.target.checked);
                setConsent(false);
              }}
            />
            This is my real shared data (explicit opt-in)
          </label>
          <div className="notice warning">
            <strong>Your iCloud data stays yours.</strong>
            <p>
              Development uses a sandbox. Do not point it at Scriptable’s real
              folder until you want live reads and writes. Real-folder mode
              creates a timestamped backup before the first write. Invalid files
              are never silently replaced. Keep this folder downloaded in
              Finder.
            </p>
            {draft.realData && changedFolder && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I understand this connects real data, shared with my phone.
              </label>
            )}
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.launchAtLogin}
              onChange={(e) =>
                set('launchAtLogin', e.target.checked)
              }
            />
            Launch at login
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.hideDock}
              onChange={(e) =>
                set('hideDock', e.target.checked)
              }
            />
            Hide Dock icon (keep Daybar in the menu bar)
          </label>
          <label className="field">
            Global focus shortcut
            <input
              placeholder="CommandOrControl+Shift+F"
              value={draft.globalShortcut}
              onChange={(e) =>
                set('globalShortcut', e.target.value)
              }
            />
            <small>Use Tauri shortcut syntax. Empty disables it.</small>
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={draft.realData && changedFolder && !consent}
          >
            Save Mac preferences ↗
          </button>
          <p className="caption">
            Browser demo cannot connect folders or change OS preferences; appearance changes stay in memory.
            Notification scheduling, menu bar, and global keys run only in the
            desktop shell.
          </p>
        </fieldset>
      </form>
    </Section>
  );
}
