import { writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { z } from 'zod';
import { dailyLogSchema, focusDataSchema, sleepDataSchema, settingsSchema, preferencesSchema } from '../src/contracts/index.ts';
const schemas = { 'daily-log': dailyLogSchema, 'focus-timer': focusDataSchema, 'sleep-data': sleepDataSchema, 'daybar-settings': settingsSchema, 'preferences': preferencesSchema };
for (const [file, schema] of Object.entries(schemas)) {
  await writeFile(new URL(`../src/contracts/schemas/${file}.schema.json`, import.meta.url), JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n');
}
console.log('Five schemas generated. Cross-field refinements remain in runtime validators.');
