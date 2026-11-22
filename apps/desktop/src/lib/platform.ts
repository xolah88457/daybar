// Which desktop Daybar runs on, for wording and for the few Mac-only or Windows-only controls.
// Read from the WebView's user agent (WebView2 says "Windows NT"), so the browser demo follows the
// visitor's own computer. Anything that is not Windows gets the Mac wording, as before 0.4.0.

export type Platform = 'mac' | 'windows';

export function platform(): Platform {
  if (typeof navigator === 'undefined') return 'mac';
  return /Windows/i.test(navigator.userAgent || navigator.platform || '') ? 'windows' : 'mac';
}

export const isWindows = () => platform() === 'windows';

/** "Mac" or "PC", as in "on this Mac". */
export const device = () => (isWindows() ? 'PC' : 'Mac');

/** The operating system's own name, as in "follows macOS appearance". */
export const osName = () => (isWindows() ? 'Windows' : 'macOS');

/** Where the always-there status item lives: the Mac menu bar or the Windows notification area. */
export const trayName = () => (isWindows() ? 'tray' : 'menu bar');
