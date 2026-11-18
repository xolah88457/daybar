import type { Features } from './contracts';

/** Every toggleable feature, in the order Settings lists them. Mirrors the keys of `Features`. */
export const featureIds = [
  'countdown', 'habits', 'focus', 'sleep',
  'radar', 'roomBeforeEvent',
  'hourlyChime', 'checkIns', 'streakSaver', 'movementNudges',
  'autoCycle', 'focusShortcuts', 'awayDetection',
  'insights', 'exportHistory', 'commandPalette', 'extraCountdowns'
] as const satisfies readonly (keyof Features)[];
export type FeatureId = (typeof featureIds)[number];
export const moduleFeatureIds = ['countdown', 'habits', 'focus', 'sleep'] as const;
export type ModuleFeatureId = (typeof moduleFeatureIds)[number];

/** Features that only work while another feature is on. */
export const featureRequires: Partial<Record<FeatureId, FeatureId>> = {
  roomBeforeEvent: 'radar',
  // The Focus extras only act on a running Focus session, so they do nothing while Focus is off.
  autoCycle: 'focus',
  focusShortcuts: 'focus',
  awayDetection: 'focus'
};

/**
 * Built-in features have no switch in Settings: each is inert until you use it (a blank Shortcut name,
 * no extra countdowns, a key you never press) or is part of the feature it requires. They are always
 * on once that requirement is on. Their stored `enabled` flag is ignored; it stays in the file format
 * so older preference files still load. Mirrors `Features::active` in the Mac app.
 */
export const builtInFeatureIds = [
  'roomBeforeEvent', 'focusShortcuts', 'exportHistory', 'commandPalette', 'extraCountdowns'
] as const satisfies readonly FeatureId[];
export function isBuiltInFeature(id: FeatureId): boolean {
  return (builtInFeatureIds as readonly FeatureId[]).includes(id);
}

/** The switch itself, ignoring dependencies. Built-in features are always switched on. */
export function featureSwitch(features: Features, id: FeatureId): boolean {
  if (isBuiltInFeature(id)) return true;
  const value = features[id];
  return typeof value === 'boolean' ? value : value.enabled;
}
/** True when the feature is on and everything it requires is on too. */
export function featureEnabled(features: Features, id: FeatureId): boolean {
  const needs = featureRequires[id];
  return featureSwitch(features, id) && (!needs || featureEnabled(features, needs));
}
/** Returns new features with one switch flipped; sub-object configuration is preserved. */
export function setFeatureSwitch(features: Features, id: FeatureId, on: boolean): Features {
  const value = features[id];
  return { ...features, [id]: typeof value === 'boolean' ? on : { ...value, enabled: on } };
}
