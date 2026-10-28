import { Children, isValidElement, createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Lesson, LiveMeeting } from '../../shared/learning';

const state = vi.hoisted(() => ({ expanded: false }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [state.expanded, (value: boolean) => { state.expanded = value; }],
  useId: () => 'lesson-resource-test',
}));
import { Resources } from './Timetable';

const lesson: Lesson = { id: 'lesson', classId: 'class', name: 'Fractions', description: 'Read this before joining.',
  slotIds: ['period'], updatedAt: '', links: [
    { id: 'link', kind: 'link', name: 'BBC', url: 'https://bbc.co.uk/' },
    { id: 'legacy', kind: 'teams', name: 'Class meeting', url: 'https://teams.microsoft.com/legacy' },
  ], files: [{ id: 'file', kind: 'file', name: 'Worksheet.pdf', size: 1024 }],
  occurrences: [{ id: 'occurrence', date: '2026-10-28', slotId: 'period' }] };
const meeting: LiveMeeting = { lessonId: 'lesson', occurrenceId: 'occurrence', organizerUserId: 1,
  state: 'created', optionsApplied: true, joinUrl: 'https://teams.microsoft.com/live', title: 'Live fractions' };
function find(root: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  for (const child of Children.toArray(root)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child.props)) return child.props;
    const result = find(child.props.children as ReactNode, predicate);
    if (result) return result;
  }
  return null;
}
function html(meetings = [meeting], value = lesson) {
  return renderToStaticMarkup(createElement(Resources, { lesson: value, meetings }));
}
beforeEach(() => { state.expanded = false; });
it('initially hides every resource behind one accessible toggle', () => {
  const markup = html();
  expect(markup).toContain('Open Lesson Resources');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('aria-controls="lesson-resource-test"');
  expect(markup).toContain('id="lesson-resource-test" class="resource-list" hidden=""');
  expect(markup).not.toContain('href=');
  expect(markup).not.toContain('Live fractions');
});
it('opens and closes resource buttons without losing file URLs or meeting titles', () => {
  const toggle = () => find(Resources({ lesson, meetings: [meeting] }), (props) => props['aria-controls'] === 'lesson-resource-test')!;
  (toggle().onClick as () => void)();
  const opened = html();
  expect(opened).toContain('Hide Lesson Resources');
  expect(opened).toContain('aria-expanded="true"');
  expect(opened).toContain('class="btn secondary resource link" href="https://bbc.co.uk/"');
  expect(opened).toContain('class="btn secondary resource file" href="/api/lessons/lesson/files/file"');
  expect(opened).toContain('Live fractions');
  expect(opened).toContain('28/10/2026');
  expect(opened.match(/alt="Microsoft Teams"/g)).toHaveLength(2);
  expect(opened).toContain('lucide-external-link');
  expect(opened).toContain('lucide-file-down');
  expect(opened).toContain('target="_blank" rel="noopener noreferrer"');
  (toggle().onClick as () => void)();
  expect(html()).not.toContain('href=');
  expect(html()).toContain('Open Lesson Resources');
});
it('never exposes cancelled, pending, unconfirmed or other-lesson meeting links', () => {
  state.expanded = true;
  for (const changed of [{ state: 'cancelled' as const }, { state: 'pending' as const }, { optionsApplied: false }, { lessonId: 'other' }, { joinUrl: null }]) {
    expect(html([{ ...meeting, ...changed }])).not.toContain('https://teams.microsoft.com/live');
  }
});
it('shows a resource toggle for a meeting-only lesson, but none for a lesson without resources', () => {
  const empty = { ...lesson, links: [], files: [] };
  expect(html([meeting], empty)).toContain('Open Lesson Resources');
  expect(html([], empty)).toBe('');
  expect(html([{ ...meeting, optionsApplied: false }], empty)).toBe('');
});
