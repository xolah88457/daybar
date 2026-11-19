'use client';
import { featureEnabled, featureSwitch, setFeatureSwitch } from '@daybar/core';
import type { Features, Preferences, Snapshot } from '@daybar/core/contracts';
import { Section } from '../components/primitives';
import { featureGroups, featureRegistry } from './registry';
import type { ConfigFeatureId, FeatureDef } from './types';

/**
 * Settings → Features: one collapsible section per group, closed until opened. A feature with a
 * switch keeps its options behind a second, smaller disclosure; built-in features have no switch.
 */
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
      collapsible
      aside={<span className="tag">APP-LOCAL · THIS MAC ONLY</span>}
    >
      <p className="muted">
        Most features start on. Open a section to change them. These choices live on this Mac only
        and never change the settings your phone widgets share.
      </p>
      <div className="feature-groups">
        {featureGroups.map(({ group, hint }) => {
          const defs = featureRegistry.filter((def) => def.group === group);
          const switches = defs.filter((def) => !def.builtIn);
          const on = switches.filter((def) => featureSwitch(features, def.id)).length;
          return (
            <details className="feature-group" key={group} role="group" aria-label={group}>
              <summary>
                <div className="feature-group-title">
                  <strong>{group}</strong>
                  <small>{hint}</small>
                </div>
                {switches.length > 0 && (
                  <small className="feature-group-count">
                    {on} of {switches.length} on
                  </small>
                )}
                <span aria-hidden="true">↙</span>
              </summary>
              {defs.map((def) => (
                <FeatureRow
                  key={def.id}
                  def={def}
                  features={features}
                  snapshot={snapshot}
                  busy={busy}
                  saveFeatures={saveFeatures}
                />
              ))}
            </details>
          );
        })}
      </div>
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
  const config = on && !blocked && Config && !def.isModule && (
    <Config
      id={def.id as ConfigFeatureId}
      value={features[def.id as ConfigFeatureId]}
      features={features}
      snapshot={snapshot}
      busy={busy}
      save={(next) => saveFeatures({ ...features, [def.id]: next })}
    />
  );
  const info = (
    <p id={`${switchId}-info`} className="feature-info">
      {def.description}
      {note && <span className="feature-note"> {note}</span>}
      {def.permission && (
        <span className="feature-note"> Asks for {def.permission} access.</span>
      )}
      {needs && (
        <span className="feature-note">
          {' '}
          {blocked
            ? def.builtIn
              ? `Comes with ${needs}, which is off.`
              : `Turn on ${needs} first.`
            : def.builtIn
              ? `Comes with ${needs}.`
              : `Works together with ${needs}.`}
        </span>
      )}
    </p>
  );
  if (def.builtIn)
    return (
      <div className="feature" data-feature={def.id} data-builtin="true">
        <div className="feature-head">
          <span className="feature-included" aria-hidden="true">
            ✓
          </span>
          <div>
            <span className="feature-label">{def.label}</span>
            {info}
          </div>
        </div>
        {config && <div className="feature-config">{config}</div>}
      </div>
    );
  return (
    <div className="feature" data-feature={def.id} data-on={on}>
      <div className="feature-head">
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          // A blocked switch that is already on stays usable, so it can still be turned off.
          disabled={busy || (blocked && !on)}
          aria-describedby={`${switchId}-info`}
          onChange={(e) => {
            if (!blocked || on) void saveFeatures(setFeatureSwitch(features, def.id, e.target.checked));
          }}
        />
        <div>
          <label htmlFor={switchId}>{def.label}</label>
          {info}
        </div>
      </div>
      {config && (
        <details className="feature-options">
          <summary>
            Options <span aria-hidden="true">↙</span>
          </summary>
          <div className="feature-config">{config}</div>
        </details>
      )}
    </div>
  );
}
