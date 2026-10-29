import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DEFAULT_PERIOD_TYPES, LESSON_TYPE_ICONS, type LessonType, type Snapshot } from '../../shared/learning';
import { LessonTypeBadge } from './LessonTypeBadge';
import { LessonTypes } from './LessonTypes';

const type: LessonType = { id: '00000000-0000-4000-8000-000000000090', name: 'Seesaw', colour: '#FFC83D', icon: null };
it('renders a pill with the configured text and translucent highlight colours and no icon by default', () => {
  const html = renderToStaticMarkup(createElement(LessonTypeBadge, { type }));
  expect(html).toContain('color:#FFC83D;background-color:#FFC83D26');
  expect(html).toContain('<span>Seesaw</span>');
  expect(html).not.toContain('<svg');
  expect(renderToStaticMarkup(createElement(LessonTypeBadge, {}))).toBe('');
});
it.each(LESSON_TYPE_ICONS)('renders the optional %s icon to the left of the text', (icon) => {
  const html = renderToStaticMarkup(createElement(LessonTypeBadge, { type: { ...type, icon } }));
  expect(html).toContain('<svg');
  expect(html).toContain('aria-hidden="true"');
  expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('<span>Seesaw'));
});
it('provides name, colour and optional icon controls with a preview and prevents deleting used types', () => {
  const data: Snapshot = {
    periodTypes: DEFAULT_PERIOD_TYPES, classes: [], slots: [], lessonTypes: [type],
    lessons: [{ id: 'lesson', classId: 'class', name: 'Sample', description: '', links: [], files: [], slotIds: [], updatedAt: '', lessonTypeId: type.id }],
  };
  const html = renderToStaticMarkup(createElement(LessonTypes, { data, refresh: async () => {} }));
  expect(html).toContain('type="color" required=""');
  expect(html).toContain('Icon (optional)');
  expect(html).toContain('No icon');
  expect(html).toContain('Preview:');
  expect(html).toContain('aria-label="Delete lesson type Seesaw"');
  expect(html).toMatch(/disabled="" aria-label="Delete lesson type Seesaw"/);
  expect(html).toContain('Reassign them before deleting.');
});
it('explains why teachers cannot save when no types have been configured', () => {
  const data: Snapshot = { periodTypes: DEFAULT_PERIOD_TYPES, classes: [], slots: [], lessons: [], lessonTypes: [] };
  const html = renderToStaticMarkup(createElement(LessonTypes, { data, refresh: async () => {} }));
  expect(html).toContain('No lesson types configured. Add a type before teachers can save lessons.');
});
