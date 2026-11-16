import type { ComponentType } from 'react';
import { featureEnabled, featureSwitch } from '@daybar/core';
import type { FeatureId } from '@daybar/core';
import type { Features } from '@daybar/core/contracts';
import { featureRegistry } from './registry';
import type { FeatureViewProps } from './types';

export interface ViewDef {
  /** Stable id. Built-in views use their name; feature views use the feature id. */
  id: string;
  label: string;
  symbol: string;
  description: string;
  /** Module whose switch controls this built-in view (it disappears while the module is off). */
  module?: FeatureId;
  /** Component for a feature-owned view; built-in views are rendered by the dashboard itself. */
  View?: ComponentType<FeatureViewProps>;
}

export const todayView: ViewDef = {
  id: 'Today',
  label: 'Today',
  symbol: '◫',
  description: 'A little more room in your day.'
};
export const settingsView: ViewDef = {
  id: 'Settings',
  label: 'Settings',
  symbol: '⚙',
  description: 'Your rhythm. Your rules.'
};
const moduleViews: ViewDef[] = [
  { id: 'Countdown', label: 'Countdown', symbol: '▦', description: 'The big picture, one square at a time.', module: 'countdown' },
  { id: 'Habits', label: 'Habits', symbol: '✓', description: 'Small things. Done consistently.', module: 'habits' },
  { id: 'Focus', label: 'Focus', symbol: '◷', description: 'Give one thing your full attention.', module: 'focus' },
  { id: 'Sleep', label: 'Sleep', symbol: '☾', description: 'Find a rhythm you can return to.', module: 'sleep' }
];

/**
 * The sidebar, in order: Today, the modules that are on, views owned by features that are on and
 * have a `View`, then Settings. Number keys 1..N follow exactly this list.
 */
export function visibleViews(features: Features): ViewDef[] {
  const featureViews = featureRegistry.flatMap((def): ViewDef[] =>
    def.nav && def.View && featureEnabled(features, def.id)
      ? [{ id: def.id, ...def.nav, View: def.View }]
      : []
  );
  return [
    todayView,
    ...moduleViews.filter((v) => !v.module || featureSwitch(features, v.module)),
    ...featureViews,
    settingsView
  ];
}
