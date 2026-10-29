import { Children, isValidElement, createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Lesson, LiveMeeting } from '../../shared/learning';

const state = vi.hoisted(() => ({ expanded: false, dialog: null as 'links' | 'images' | null, index: 0, failedImageId: '' }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => typeof initial === 'boolean'
    ? [state.expanded, (value: boolean) => { state.expanded = value; }]
    : typeof initial === 'number' ? [state.index, (value: number) => { state.index = value; }]
      : typeof initial === 'string' ? [state.failedImageId, (value: string) => { state.failedImageId = value; }]
        : [state.dialog, (value: typeof state.dialog) => { state.dialog = value; }],
  useId: () => 'lesson-resource-test',
}));
vi.mock('react-dom', async (original) => ({
  ...await original<typeof import('react-dom')>(),
  createPortal: (children: ReactNode) => children,
}));
import { LessonImages, Resources } from './Timetable';

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
beforeEach(() => {
  state.expanded = false; state.dialog = null; state.index = 0; state.failedImageId = '';
  vi.stubGlobal('document', { body: {} });
});
afterEach(() => vi.unstubAllGlobals());
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
  expect(opened).toContain('Links (1)');
  expect(opened).not.toContain('https://bbc.co.uk/');
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
it('opens external links in a dialog without moving Teams into the list', () => {
  state.expanded = true;
  const button = find(Resources({ lesson }), (props) => props['aria-haspopup'] === 'dialog')!;
  (button.onClick as () => void)();
  const opened = html();
  expect(opened).toContain('role="dialog"');
  expect(opened).toContain('aria-label="Fractions - Links"');
  expect(opened).toContain('href="https://bbc.co.uk/" target="_blank" rel="noopener noreferrer"');
  expect(opened.match(/https:\/\/teams.microsoft.com\/legacy/g)).toHaveLength(1);
});
const images: Lesson['files'] = [
  { id: 'one', kind: 'file', name: 'First.PNG', size: 1024 },
  { id: 'two', kind: 'file', name: 'Second.webp', size: 1024 },
  { id: 'three', kind: 'file', name: 'Third.jpg', size: 1024 },
];
it('groups all images behind one button while preserving document downloads', () => {
  state.expanded = true;
  const value = { ...lesson, files: [...lesson.files, ...images] };
  expect(html([], value)).toContain('Images (3)');
  expect(html([], value)).not.toContain('files/one');
  expect(html([], value)).toContain('files/file');
  state.dialog = 'images';
  expect(html([], value)).toContain('aria-label="Fractions - Images"');
  expect(html([], value)).toContain('files/one?preview=1');
});
it('cycles through every image in both directions and supports arrow keys', () => {
  const carousel = () => LessonImages({ lessonId: 'lesson', images });
  const markup = () => renderToStaticMarkup(createElement(LessonImages, { lessonId: 'lesson', images }));
  const click = (label: string) => {
    const button = find(carousel(), (props) => props['aria-label'] === label)!;
    (button.onClick as () => void)();
  };
  expect(markup()).toContain('1 of 3: First.PNG');
  click('Next image'); expect(markup()).toContain('2 of 3: Second.webp');
  click('Next image'); expect(markup()).toContain('3 of 3: Third.jpg');
  click('Next image'); expect(markup()).toContain('1 of 3: First.PNG');
  click('Previous image'); expect(markup()).toContain('3 of 3: Third.jpg');
  const preventDefault = vi.fn();
  carousel().props.onKeyDown({ key: 'ArrowRight', preventDefault });
  expect(markup()).toContain('1 of 3: First.PNG');
  expect(preventDefault).toHaveBeenCalled();
});
it('disables carousel navigation when there is just one image', () => {
  const markup = renderToStaticMarkup(createElement(LessonImages, { lessonId: 'lesson', images: images.slice(0, 1) }));
  expect(markup).toContain('aria-label="Previous image" disabled=""');
  expect(markup).toContain('aria-label="Next image" disabled=""');
});
it('shows image failures explicitly and clears them when navigating', () => {
  const carousel = () => LessonImages({ lessonId: 'lesson', images });
  const image = find(carousel(), (props) => props.alt === 'First.PNG')!;
  (image.onError as () => void)();
  expect(renderToStaticMarkup(createElement(LessonImages, { lessonId: 'lesson', images }))).toContain('This image could not be loaded.');
  const next = find(carousel(), (props) => props['aria-label'] === 'Next image')!;
  (next.onClick as () => void)();
  expect(state.failedImageId).toBe('');
  expect(renderToStaticMarkup(createElement(LessonImages, { lessonId: 'lesson', images }))).toContain('files/two?preview=1');
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
