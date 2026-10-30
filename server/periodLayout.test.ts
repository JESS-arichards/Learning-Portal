import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the whole day scrollable with room to align the final current period at the top', () => {
  const css = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.timeline { max-height: 65vh; overflow-y: auto; overscroll-behavior-y: contain; padding: 8px; position: relative; }');
  expect(css).toContain('.timeline:has(.current-period)::after { content: ""; display: block; height: calc(65vh - 38px); }');
});

it('keeps timetable navigation buttons touch-sized and allows wrapping', () => {
  const css = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.date-navigation { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-bottom: 18px; }');
  expect(css).toContain('.date-navigation > .btn { min-height: 44px; }');
});

it('keeps period actions separate from bounded fields on narrow screens', () => {
  const css = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.structure-row input, .structure-row select { min-width: 0; max-width: 100%; }');
  expect(css).toContain('.day-structure { container-type: inline-size; }');
  const responsive = css.slice(css.indexOf('@container (max-width: 1000px)'));
  expect(responsive).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  expect(responsive).toContain('.structure-row > .icon-button { grid-column: 1 / -1; justify-self: end; min-height: 44px; }');
  expect(responsive).toContain('@media (max-width: 480px)');
  expect(responsive).toContain('.structure-row > label, .structure-row > .period-days-field { grid-column: 1 / -1; }');
});

it('places the new-period Days selector below the time fields in narrower panels', () => {
  const css = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
  const responsive = css.slice(css.indexOf('@container (max-width: 1000px)'), css.indexOf('@media (max-width: 680px)'));
  expect(responsive).toContain('.period-add-row > .period-days-field { grid-column: 1 / -1; }');
  expect(responsive).toContain('.period-days-options { max-width: 100%; }');
});

it('gives mobile period-type cards equal dimensions and aligned action columns', () => {
  const css = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 680px)'));
  expect(mobile).toContain('.period-types { display: grid; grid-template-columns: minmax(0, 1fr); grid-auto-rows: 1fr; }');
  expect(mobile).toContain('.period-types li { display: grid; grid-template-columns: minmax(0, 1fr) 44px 44px; gap: 8px; width: 100%; }');
  expect(mobile).toContain('.period-types .icon-button { width: 44px; height: 44px; }');
});
