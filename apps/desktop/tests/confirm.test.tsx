import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmAction } from '../src/lib/confirm';
import { Focus } from '../src/components/modules';
import { fixture } from './fixtures';

const tauri = vi.hoisted(() => ({ native: false }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => tauri.native }));

// jsdom has no HTMLDialogElement.showModal/close; stub the platform bits the
// helper relies on (open flag, returnValue, close event).
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    if (this.open) throw new Error('dialog is already open');
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (
    this: HTMLDialogElement,
    returnValue?: string
  ) {
    if (!this.open) return;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

const dialog = () => document.querySelector('dialog') as HTMLDialogElement;
const buttons = () =>
  [...dialog().querySelectorAll('button')] as HTMLButtonElement[];

beforeEach(() => {
  tauri.native = false;
});
afterEach(() => {
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

describe('confirmAction', () => {
  it('keeps window.confirm outside Tauri (browser/demo fallback)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await expect(confirmAction('Proceed?')).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith('Proceed?');
    confirm.mockReturnValue(false);
    await expect(confirmAction('Proceed?')).resolves.toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('shows a visible native modal with accessible label/description and a default-focused Cancel', async () => {
    tauri.native = true;
    const pending = confirmAction('Discard everything?');
    const d = dialog();
    expect(d).not.toBeNull();
    expect(d.open).toBe(true);
    expect(d).toHaveAttribute('role', 'alertdialog');
    expect(d.className).toBe('confirm-dialog');
    const label = document.getElementById(d.getAttribute('aria-labelledby')!);
    const description = document.getElementById(
      d.getAttribute('aria-describedby')!
    );
    expect(label).toHaveTextContent(/confirm/i);
    expect(description).toHaveTextContent('Discard everything?');
    const form = d.querySelector('form')!;
    expect(form).toHaveAttribute('method', 'dialog');
    const cancel = buttons().find((b) => b.type === 'button')!;
    const ok = buttons().find((b) => b.type === 'submit')!;
    expect(cancel.textContent).toBe('Cancel');
    expect(cancel.autofocus).toBe(true);
    expect(document.activeElement).toBe(cancel);
    expect(ok.value).toBe('true');
    d.close();
    await expect(pending).resolves.toBe(false);
  });

  it('resolves true on Confirm, removes the dialog after close', async () => {
    tauri.native = true;
    const pending = confirmAction('Merge the conflict copy?');
    fireEvent.click(buttons().find((b) => b.type === 'submit')!);
    await expect(pending).resolves.toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('resolves false on Cancel and removes the dialog', async () => {
    tauri.native = true;
    const pending = confirmAction('Archive the task?');
    fireEvent.click(buttons().find((b) => b.type === 'button')!);
    await expect(pending).resolves.toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('resolves false on Escape (cancel event) and on plain close', async () => {
    tauri.native = true;
    const escape = confirmAction('Stop the plan?');
    dialog().dispatchEvent(new Event('cancel'));
    await expect(escape).resolves.toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
    const closed = confirmAction('Clear sleep data?');
    dialog().close();
    await expect(closed).resolves.toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('renders the message as text only, never markup', async () => {
    tauri.native = true;
    const evil = '<img src=x onerror=alert(1)>';
    const pending = confirmAction(evil);
    const d = dialog();
    expect(d.querySelector('img')).toBeNull();
    const description = document.getElementById(
      d.getAttribute('aria-describedby')!
    )!;
    expect(description.textContent).toBe(evil);
    expect(description.innerHTML).toContain('&lt;img');
    d.close();
    await expect(pending).resolves.toBe(false);
  });

  it('fails safely with a clear error when native dialogs are unsupported', async () => {
    tauri.native = true;
    const showModal = HTMLDialogElement.prototype.showModal;
    // simulate a web view without <dialog>.showModal
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>)
      .showModal;
    try {
      await expect(confirmAction('Delete?')).rejects.toThrow(
        /cannot show confirmation dialogs/
      );
      expect(document.querySelector('dialog')).toBeNull();
    } finally {
      HTMLDialogElement.prototype.showModal = showModal;
    }
  });

  it('routes a no-phone focus start through the native dialog before running', async () => {
    tauri.native = true;
    const p = {
      snapshot: fixture(),
      now: new Date(2026, 10, 15, 23, 30),
      busy: false,
      run: vi.fn(async () => true),
      confirm: confirmAction
    };
    p.snapshot.sleep.wakes['2026-11-15'] = 480;
    render(<Focus {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '25 min ↗' }));
    const d = await screen.findByRole('alertdialog');
    expect(d).toHaveTextContent('no-phone time');
    fireEvent.click(within(d).getByRole('button', { name: 'Cancel' }));
    expect(p.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '25 min ↗' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Confirm'
      })
    );
    await waitFor(() =>
      expect(p.run).toHaveBeenCalledWith({
        kind: 'start_timer',
        timerType: 'focus',
        minutes: 25
      })
    );
    expect(document.querySelector('dialog')).toBeNull();
  });
});
