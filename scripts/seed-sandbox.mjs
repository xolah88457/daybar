import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { URL } from 'node:url';
const source = new URL('../packages/core/tests/fixtures/', import.meta.url);
const target = new URL('../.dev-data/', import.meta.url);
await mkdir(target, { recursive: true });
for (const file of await readdir(source)) {
  if (!/^(daybar-settings|focus-timer|sleep-data|daily-log-[a-zA-Z0-9_]+)\.json$/.test(file)) continue;
  try { await copyFile(new URL(file, source), new URL(file, target), constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
// Tells the app these are the fixtures on purpose, so it does not move them aside as old sample data.
await writeFile(new URL('.daybar-starter', target), 'fixtures\n', { flag: 'a' });
console.log('Sandbox seeded; existing files preserved.');
