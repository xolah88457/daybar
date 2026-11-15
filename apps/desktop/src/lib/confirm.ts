import { isTauri } from '@tauri-apps/api/core';

let seq = 0;

// WKWebView never shows window.confirm dialogs, so destructive actions were
// silently cancelled in the native app. Ask through a native <dialog> there;
// browser/demo keeps the plain JS confirm.
export function confirmAction(message: string): Promise<boolean> {
  if (!isTauri() && !('__TAURI_INTERNALS__' in window))
    return Promise.resolve(window.confirm(message));
  return nativeConfirm(message);
}

function nativeConfirm(message: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const dialog = document.createElement('dialog');
    if (
      typeof dialog.showModal !== 'function' ||
      typeof dialog.close !== 'function'
    ) {
      reject(
        new Error(
          'This web view cannot show confirmation dialogs; the action was not performed.'
        )
      );
      return;
    }
    const id = ++seq;
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    const title = document.createElement('strong');
    title.id = `confirm-title-${id}`;
    title.textContent = 'Please confirm';
    const text = document.createElement('p');
    text.id = `confirm-message-${id}`;
    text.textContent = message; // textContent only: the message is data, never markup
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.setAttribute('aria-describedby', text.id);
    const form = document.createElement('form');
    form.method = 'dialog';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.autofocus = true;
    cancel.addEventListener('click', () => dialog.close(''));
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.value = 'true';
    ok.className = 'primary';
    ok.textContent = 'Confirm';
    form.append(cancel, ok);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      dialog.close(ok.value);
    });
    dialog.append(title, text, form);
    dialog.addEventListener('cancel', () => {
      if (dialog.open) dialog.close('');
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'true');
    });
    document.body.appendChild(dialog);
    try {
      dialog.showModal();
    } catch (error) {
      dialog.remove();
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    cancel.focus();
  });
}
