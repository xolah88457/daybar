'use client';
// Small form kit shared by the notification features' Config panels (hourly chime, check-ins,
// streak saver, movement nudges). It only uses the existing Settings classes from globals.css.
import { useId, useState, type FormEvent, type ReactNode } from 'react';

/**
 * Local edits on top of the saved config. `draft` is what the form shows, `submit` validates and
 * saves the whole config, and a successful save drops the edits so the saved value shows again.
 */
export function useConfigDraft<T extends object>(
  value: T,
  save: (next: T) => Promise<boolean>,
  validate: (draft: T) => string | null
) {
  const [patch, setPatch] = useState<Partial<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = { ...value, ...patch } as T;
  const dirty =
    patch !== null && (Object.keys(patch) as (keyof T)[]).some((k) => !Object.is(patch[k], value[k]));
  const set = (next: Partial<T>) => {
    setPatch((prev) => ({ ...prev, ...next }));
    setError(null);
  };
  const submit = async () => {
    const problem = validate(draft);
    if (problem) return setError(problem);
    if (await save(draft)) setPatch(null);
    else setError('Could not save. Check the message at the top of the window and try again.');
  };
  return { draft, set, dirty, error, submit };
}

/** The form frame: fields, the error line, the one-line "Next: ..." preview and a Save button. */
export function NotifyForm({
  label,
  dirty,
  busy,
  error,
  preview,
  onSubmit,
  children
}: {
  label: string;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  preview: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      aria-label={label}
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="field-grid">{children}</div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p className="caption" aria-live="polite" data-testid="next-preview">
        {preview}
      </p>
      <div className="button-row">
        <button className="primary" type="submit" disabled={busy || !dirty}>
          Save
        </button>
      </div>
    </form>
  );
}

export function TimeField({
  label,
  value,
  onChange,
  hint,
  disabled
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="time"
        value={value}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hint
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number.isNaN(value) ? '' : value}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

/** An error message when `n` is not a whole number in `[min, max]`. */
export function rangeError(label: string, n: number, min: number, max: number): string | null {
  return Number.isInteger(n) && n >= min && n <= max ? null : `${label} must be a whole number from ${min} to ${max}.`;
}
