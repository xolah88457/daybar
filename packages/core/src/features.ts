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
export const featureRequires: Partial<Record<FeatureId, FeatureId>> = { roomBeforeEvent: 'radar' };

/** The switch itself, ignoring dependencies. */
export function featureSwitch(features: Features, id: FeatureId): boolean {
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
