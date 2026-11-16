'use client';
import { featureEnabled, featureSwitch, setFeatureSwitch } from '@daybar/core';
import type { Features, Preferences, Snapshot } from '@daybar/core/contracts';
import { Section } from '../components/primitives';
import { featureGroups, featureRegistry } from './registry';
import type { ConfigFeatureId, FeatureDef } from './types';

/** Settings → Features: one switch per feature; a feature's `Config` appears while it is on. */
export function FeaturesPanel({
  snapshot,
  busy,
  savePreferences
}: {
  snapshot: Snapshot;
  busy: boolean;
  savePreferences: (preferences: Preferences) => Promise<boolean>;
}) {
  const features = snapshot.preferences.features;
  const saveFeatures = (next: Features) =>
    savePreferences({ ...snapshot.preferences, features: next });
  return (
    <Section
      title="Features"
      aside={<span className="tag">APP-LOCAL · THIS MAC ONLY</span>}
    >
      <p className="muted">
        Switch parts of Daybar on or off. These choices live on this Mac only and
        never change the settings your phone widgets share.
      </p>
      {featureGroups.map((group) => (
        <div className="feature-group" key={group} role="group" aria-label={group}>
          <h3>{group}</h3>
          {featureRegistry
            .filter((def) => def.group === group)
            .map((def) => (
              <FeatureRow
                key={def.id}
                def={def}
                features={features}
                snapshot={snapshot}
                busy={busy}
                saveFeatures={saveFeatures}
              />
            ))}
        </div>
      ))}
    </Section>
  );
}

function FeatureRow({
  def,
  features,
  snapshot,
  busy,
  saveFeatures
}: {
  def: FeatureDef;
  features: Features;
  snapshot: Snapshot;
  busy: boolean;
  saveFeatures: (features: Features) => Promise<boolean>;
}) {
  const on = featureSwitch(features, def.id);
  const blocked = def.requires ? !featureEnabled(features, def.requires) : false;
  const needs = def.requires
    ? featureRegistry.find((f) => f.id === def.requires)?.label
    : undefined;
  const switchId = `feature-${def.id}`;
  const Config = def.Config;
  const note = def.isModule
    ? 'Off hides it from the sidebar, Today, the menu bar and alerts. Your data is kept.'
    : undefined;
  return (
    <div className="feature" data-feature={def.id} data-on={on}>
      <div className="feature-head">
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          disabled={busy || blocked}
          aria-describedby={`${switchId}-info`}
          onChange={(e) => {
            if (!blocked) void saveFeatures(setFeatureSwitch(features, def.id, e.target.checked));
          }}
        />
        <div>
          <label htmlFor={switchId}>{def.label}</label>
          <p id={`${switchId}-info`} className="feature-info">
            {def.description}
            {note && <span className="feature-note"> {note}</span>}
            {def.permission && (
              <span className="feature-note">
                {' '}
                Asks for {def.permission} access.
              </span>
            )}
            {needs && (
              <span className="feature-note">
                {' '}
                {blocked ? `Turn on ${needs} first.` : `Works together with ${needs}.`}
              </span>
            )}
          </p>
        </div>
      </div>
      {on && !blocked && Config && !def.isModule && (
        <div className="feature-config">
          <Config
            id={def.id as ConfigFeatureId}
            value={features[def.id as ConfigFeatureId]}
            features={features}
            snapshot={snapshot}
            busy={busy}
            save={(next) => saveFeatures({ ...features, [def.id]: next })}
          />
        </div>
      )}
    </div>
  );
}
