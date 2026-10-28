import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps period actions separate from bounded fields on narrow screens', () => {
  const css = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.structure-row input, .structure-row select { min-width: 0; max-width: 100%; }');
  const responsive = css.slice(css.indexOf('@media (max-width: 900px)'));
  expect(responsive).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  expect(responsive).toContain('.structure-row > .icon-button { grid-column: 1 / -1; justify-self: end; min-height: 44px; }');
  expect(responsive).toContain('@media (max-width: 480px)');
  expect(responsive).toContain('.structure-row > label, .structure-row > .period-days-field { grid-column: 1 / -1; }');
});

it('places the new-period Days selector below the time fields on smaller screens', () => {
  const css = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
  const responsive = css.slice(css.indexOf('@media (max-width: 900px)'), css.indexOf('@media (max-width: 680px)'));
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
