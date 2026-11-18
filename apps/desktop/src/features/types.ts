import type { ComponentType } from 'react';
import type { FeatureId, ModuleFeatureId } from '@daybar/core';
import type { Features, Preferences, Snapshot } from '@daybar/core/contracts';
import type { Actions } from '../components/modules';

/** Features that carry a configuration object (everything except the four built-in modules). */
export type ConfigFeatureId = Exclude<FeatureId, ModuleFeatureId>;
export type FeatureGroup = 'Pages' | 'Deadline Radar' | 'Reminders' | 'Focus sessions' | 'Tools';

/** Props for a feature's `Config` panel, rendered under its switch while the feature is on. */
export interface FeatureConfigProps<K extends ConfigFeatureId = ConfigFeatureId> {
  id: K;
  /** The feature's current saved configuration (`preferences.features[id]`). */
  value: Features[K];
  features: Features;
  snapshot: Snapshot;
  busy: boolean;
  /** Persist a new configuration for this feature only; resolves true once saved. */
  save: (next: Features[K]) => Promise<boolean>;
}
/** Props for a feature's full-page `View` (a sidebar destination). */
export type FeatureViewProps = Actions & {
  savePreferences: (preferences: Preferences) => Promise<boolean>;
};
/** Props for a card a feature contributes to the Today view. */
export type FeatureCardProps = Actions;
/**
 * Props for a feature's `Overlay`: UI the dashboard renders once at the shell level (outside any
 * view) while the feature is on, such as a command palette or a global dialog.
 */
export type FeatureOverlayProps = Actions & {
  /** Switch to a view by id (any `id` from `visibleViews(features)`) and move focus to the page. */
  navigate: (viewId: string) => void;
  savePreferences: (preferences: Preferences) => Promise<boolean>;
};

/**
 * What `src/features/<id>.tsx` may export. The registry picks these up by name, so a feature agent
 * only edits its own file: export `Config`, and optionally `View` and/or `TodayCard`.
 */
export type FeatureModule<K extends FeatureId = FeatureId> = {
  Config?: K extends ConfigFeatureId ? ComponentType<FeatureConfigProps<K>> : never;
  View?: ComponentType<FeatureViewProps>;
  TodayCard?: ComponentType<FeatureCardProps>;
  /** Rendered at the app-shell level while the feature is on; see `FeatureOverlayProps`. */
  Overlay?: ComponentType<FeatureOverlayProps>;
};

/** Sidebar metadata for a feature that owns a view. The view appears only once `View` is exported. */
export interface FeatureNav {
  label: string;
  symbol: string;
  description: string;
}

export interface FeatureDef {
  id: FeatureId;
  label: string;
  /** One plain-English line shown under the switch. */
  description: string;
  group: FeatureGroup;
  /** Human name of the macOS permission it asks for, if any. */
  permission?: string;
  /** Another feature that must be on for this one to work. */
  requires?: FeatureId;
  /** Built-in modules hide (and keep their data) instead of adding something new. */
  isModule: boolean;
  /** No switch: always on once `requires` is on (see `builtInFeatureIds` in core). */
  builtIn: boolean;
  nav?: FeatureNav;
  Config?: ComponentType<FeatureConfigProps>;
  View?: ComponentType<FeatureViewProps>;
  TodayCard?: ComponentType<FeatureCardProps>;
  /** When set, the Today card shows only while this returns true (e.g. once there is content). */
  cardWhen?: (features: Features) => boolean;
  Overlay?: ComponentType<FeatureOverlayProps>;
}
