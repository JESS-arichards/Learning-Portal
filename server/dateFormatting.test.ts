import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { formatDate, formatDateTime } from '../shared/dateFormatting';

it('formats all display date styles with the shared UK policy', () => {
  expect(formatDate('2026-10-28')).toBe('28/10/2026');
  expect(formatDate('2026-10-28', 'long')).toBe('28 October 2026');
  expect(formatDateTime('2026-10-27T23:30:00Z', { timeZone: 'Asia/Dubai' })).toBe('28/10/2026, 03:30');
});
it('prevents new browser-locale date displays bypassing the shared formatting policy', () => {
  const root = fileURLToPath(new URL('../client/src', import.meta.url));
  function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? files(path.join(directory, item.name))
      : /\.(ts|tsx)$/.test(item.name) && !item.name.includes('.test.') ? [path.join(directory, item.name)] : []);
  }
  for (const file of files(root)) {
    const text = readFileSync(file, 'utf8');
    expect(text, file).not.toMatch(/\.toLocale(?:DateString|TimeString|String)\(/);
    expect(text, file).not.toMatch(/new Intl\.DateTimeFormat\(['"]/);
  }
});
