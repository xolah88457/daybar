import type { ComponentType } from 'react';
import { featureEnabled, featureRequires, moduleFeatureIds } from '@daybar/core';
import type { FeatureId } from '@daybar/core';
import type { Features } from '@daybar/core/contracts';
import * as autoCycle from './autoCycle';
import * as awayDetection from './awayDetection';
import * as checkIns from './checkIns';
import * as commandPalette from './commandPalette';
import * as exportHistory from './exportHistory';
import * as extraCountdowns from './extraCountdowns';
import * as focusShortcuts from './focusShortcuts';
import * as hourlyChime from './hourlyChime';
import * as insights from './insights';
import * as movementNudges from './movementNudges';
import * as radar from './radar';
import * as roomBeforeEvent from './roomBeforeEvent';
import * as streakSaver from './streakSaver';
import type {
  FeatureCardProps,
  FeatureConfigProps,
  FeatureDef,
  FeatureGroup,
  FeatureModule,
  FeatureNav,
  FeatureOverlayProps
} from './types';

export const featureGroups: readonly FeatureGroup[] = [
  'Modules',
  'Deadline Radar',
  'Time awareness',
  'Focus',
  'Review & extras'
];

type Meta = Pick<FeatureDef, 'label' | 'description' | 'group' | 'permission'> & {
  nav?: FeatureNav;
};
// The one place that widens a feature's typed Config to the registry's generic shape.
function feature<K extends FeatureId>(
  id: K,
  meta: Meta,
  module: FeatureModule<K> = {}
): FeatureDef {
  return {
    id,
    ...meta,
    requires: featureRequires[id],
    isModule: (moduleFeatureIds as readonly string[]).includes(id),
    Config: module.Config as ComponentType<FeatureConfigProps> | undefined,
    View: module.View,
    TodayCard: module.TodayCard,
    // `in` (not a plain read) so a partial `vi.mock` of a feature file without `Overlay` still works.
    Overlay: 'Overlay' in module ? module.Overlay : undefined
  };
}

/**
 * Every toggleable feature, in the order Settings lists them. To add a view or a Today card, export
 * `View` / `TodayCard` from the feature's own file (and give the entry `nav` metadata for a view);
 * this list is the only shared place that imports those files.
 */
export const featureRegistry: readonly FeatureDef[] = [
  feature('countdown', {
    label: 'Countdown',
    description: 'The countdown to your big date, shown as a grid of days.',
    group: 'Modules'
  }),
  feature('habits', {
    label: 'Habits',
    description: 'Daily tasks, streaks and the long-run heatmap.',
    group: 'Modules'
  }),
  feature('focus', {
    label: 'Focus',
    description: 'Timed focus sessions and breaks, counted in whole blocks.',
    group: 'Modules'
  }),
  feature('sleep', {
    label: 'Sleep',
    description: 'Your wake and bedtime rhythm, with bedtime alerts.',
    group: 'Modules'
  }),
  feature(
    'radar',
    {
      label: 'Deadline Radar',
      description: 'See upcoming calendar events and due reminders in one place.',
      group: 'Deadline Radar',
      permission: 'Calendars & Reminders',
      nav: {
        label: 'Deadline Radar',
        symbol: '⌖',
        description: 'What is coming up, and what is overdue.'
      }
    },
    radar
  ),
  feature(
    'roomBeforeEvent',
    {
      label: 'Room before an event',
      description: 'Shows how much focus time fits before your next event.',
      group: 'Deadline Radar'
    },
    roomBeforeEvent
  ),
  feature(
    'hourlyChime',
    {
      label: 'Hourly chime',
      description: 'A gentle notification on the hour, outside your quiet hours.',
      group: 'Time awareness'
    },
    hourlyChime
  ),
  feature(
    'checkIns',
    {
      label: 'Morning and evening check-ins',
      description: 'A nudge to plan your day and to review it.',
      group: 'Time awareness'
    },
    checkIns
  ),
  feature(
    'streakSaver',
    {
      label: 'Streak saver',
      description: 'A reminder before bed if today’s habits are unfinished.',
      group: 'Time awareness'
    },
    streakSaver
  ),
  feature(
    'movementNudges',
    {
      label: 'Movement nudges',
      description: 'Reminds you to stand up and move during your active hours.',
      group: 'Time awareness'
    },
    movementNudges
  ),
  feature(
    'autoCycle',
    {
      label: 'Auto-cycle sessions',
      description: 'Starts the next break or focus session for you, with a long break every few rounds.',
      group: 'Focus'
    },
    autoCycle
  ),
  feature(
    'focusShortcuts',
    {
      label: 'Focus shortcuts',
      description: 'Runs a macOS Shortcut when a focus session starts or ends.',
      group: 'Focus'
    },
    focusShortcuts
  ),
  feature(
    'awayDetection',
    {
      label: 'Away detection',
      description: 'Notices when you step away from the Mac during a session.',
      group: 'Focus'
    },
    awayDetection
  ),
  feature(
    'insights',
    {
      label: 'Insights',
      description: 'A page of patterns across your focus, habits and sleep.',
      group: 'Review & extras',
      nav: {
        label: 'Insights',
        symbol: '≋',
        description: 'Patterns worth noticing.'
      }
    },
    insights
  ),
  feature(
    'exportHistory',
    {
      label: 'Export history',
      description: 'Save your history as a file you can keep.',
      group: 'Review & extras'
    },
    exportHistory
  ),
  feature(
    'commandPalette',
    {
      label: 'Command palette',
      description: 'Jump anywhere or start a session from the keyboard.',
      group: 'Review & extras'
    },
    commandPalette
  ),
  feature(
    'extraCountdowns',
    {
      label: 'Extra countdowns',
      description: 'More countdown grids for other dates.',
      group: 'Review & extras'
    },
    extraCountdowns
  )
];

export function featureDef(id: FeatureId): FeatureDef {
  const def = featureRegistry.find((f) => f.id === id);
  if (!def) throw new Error(`Unknown feature ${id}`);
  return def;
}

/** Cards features contribute to the Today view, for the features that are on. */
export function todayCards(
  features: Features
): { id: FeatureId; Card: ComponentType<FeatureCardProps> }[] {
  return featureRegistry.flatMap((def) =>
    def.TodayCard && featureEnabled(features, def.id)
      ? [{ id: def.id, Card: def.TodayCard }]
      : []
  );
}

/** Shell-level overlays (e.g. the command palette) contributed by the features that are on. */
export function featureOverlays(
  features: Features
): { id: FeatureId; Overlay: ComponentType<FeatureOverlayProps> }[] {
  return featureRegistry.flatMap((def) =>
    def.Overlay && featureEnabled(features, def.id)
      ? [{ id: def.id, Overlay: def.Overlay }]
      : []
  );
}
