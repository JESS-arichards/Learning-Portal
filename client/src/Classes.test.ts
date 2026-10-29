import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD_TYPES, type Snapshot, type User } from '../../shared/learning';

const state = vi.hoisted(() => ({ index: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = state.index++;
    return [index === 1 ? 'new' : typeof initial === 'function' ? initial() : initial, vi.fn()];
  },
}));
import { Classes } from './Classes';

beforeEach(() => { state.index = 0; });
it('places Save lesson after the resource buttons and associates it with the lesson form', () => {
  const user: User = { id: 1, email: 'teacher@school.test', displayName: 'Teacher', roles: ['Staff'],
    isActive: true, sessionVersion: 0, studentEmails: [] };
  const data: Snapshot = { periodTypes: DEFAULT_PERIOD_TYPES, lessons: [], slots: [],
    classes: [{ id: 'class', name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [user], students: [] }] };
  const html = renderToStaticMarkup(createElement(Classes, { data, user, refresh: async () => {} }));
  const formId = html.match(/<form id="([^"]+)"/)?.[1];
  expect(formId).toBeTruthy();
  expect(html).toContain(`<button type="submit" form="${formId}" class="btn primary">Save lesson</button>`);
  expect(html.indexOf('Save lesson</button>')).toBeGreaterThan(html.indexOf('Teams</button>'));
  expect(html.indexOf('</form>')).toBeLessThan(html.indexOf('aria-label="Lesson resources"'));
  expect(html).toContain('Lesson type<select required=""');
  expect(html).toContain('<option value="" selected="">Select a lesson type</option>');
  expect(html).toContain('Ask a Learning administrator to add lesson types');
});
it('offers configured lesson types without automatically selecting one and displays published badges', () => {
  const user: User = { id: 1, email: 'teacher@school.test', displayName: 'Teacher', roles: ['Staff'],
    isActive: true, sessionVersion: 0, studentEmails: [] };
  const type = { id: 'type', name: 'Seesaw', colour: '#FFC83D', icon: 'book' as const };
  const data: Snapshot = { periodTypes: DEFAULT_PERIOD_TYPES, slots: [], lessonTypes: [type],
    classes: [{ id: 'class', name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [user], students: [] }],
    lessons: [{ id: 'lesson', classId: 'class', name: 'Published', description: '', files: [], links: [], slotIds: [], updatedAt: '', lessonTypeId: type.id }] };
  const html = renderToStaticMarkup(createElement(Classes, { data, user, refresh: async () => {} }));
  expect(html).toContain('<option value="type">Seesaw</option>');
  expect(html).toContain('<option value="" selected="">Select a lesson type</option>');
  expect(html).toContain('class="lesson-type-badge"');
  expect(html).toContain('color:#FFC83D;background-color:#FFC83D26');
});
