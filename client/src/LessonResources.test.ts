import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD_TYPES, type Lesson, type Snapshot, type User, type LinkResource } from '../../shared/learning';
import { emptyResources, type StagedResources } from './lessonSetup';

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, api: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(), useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial;
    return [state.values[index], (value: unknown) => { state.values[index] = typeof value === 'function' ? value(state.values[index]) : value; }];
  },
}));
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('./api', () => ({ api: state.api, errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
import { LessonResources } from './LessonResources';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user: User = { id: 1, email: 'teacher@school.test', displayName: 'Teacher', roles: ['Staff'], isActive: true, sessionVersion: 0, studentEmails: [] };
let lesson: Lesson;
let links: LinkResource[];
let resources: StagedResources;
const data: Snapshot = { classes: [], lessons: [], slots: [], periodTypes: DEFAULT_PERIOD_TYPES };
function render(disabled = false) {
  state.index = 0;
  return LessonResources({ lesson, links, resources, data, user, disabled,
    onLinksChange: (value) => { links = value; }, onResourcesChange: (value) => { resources = value; },
    onBusyChange: vi.fn(), refresh: vi.fn() });
}
function find(root: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  for (const child of Children.toArray(root)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child.props)) return child.props;
    const result = find(child.props.children as ReactNode, predicate);
    if (result) return result;
  }
  return null;
}
function click(name: string) {
  const props = find(render(), (props) => typeof props.onClick === 'function' && Children.toArray(props.children as ReactNode).some((item) => typeof item === 'string' && item.trim() === name));
  if (!props) throw new Error(`Missing button: ${name}`);
  (props.onClick as () => void)();
}
function input(maxLength: number, value: string) {
  const props = find(render(), (props) => props.maxLength === maxLength)!;
  (props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}
function submit() {
  (find(render(), (props) => typeof props.onSubmit === 'function')!.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
}
function choose(files: File[]) {
  const props = find(render(), (props) => props.type === 'file')!;
  (props.onChange as (event: { target: { files: File[]; value: string } }) => void)({ target: { files, value: '' } });
}
beforeEach(() => {
  state.values = []; state.api.mockReset(); resources = emptyResources(); links = [];
  lesson = { id: uuid(1), classId: uuid(2), name: '', description: '', slotIds: [], links: [], files: [], updatedAt: '' };
  vi.stubGlobal('document', { body: {} });
});
afterEach(() => vi.unstubAllGlobals());
it.each([['Files', 'Lesson files'], ['External Link', 'External link'], ['Teams', 'Teams meeting']])('opens %s before the lesson has been saved', (button, title) => {
  click(button);
  expect(find(render(), (props) => props.title === title)).not.toBeNull();
  expect(state.api).not.toHaveBeenCalled();
});
it('stages and edits a named link without any API write', () => {
  click('External Link'); input(200, 'Reading'); input(2000, 'https://school.test/reading'); submit();
  expect(links).toEqual([expect.objectContaining({ kind: 'link', name: 'Reading', url: 'https://school.test/reading' })]);
  const id = links[0].id;
  click('Edit'); input(200, 'New reading'); submit();
  expect(links[0]).toMatchObject({ id, name: 'New reading' });
  click('Remove'); expect(links).toEqual([]);
  expect(state.api).not.toHaveBeenCalled();
});
it('confirms queued links and files honestly and provides an explicit Close button', () => {
  click('External Link'); input(200, 'Reading'); input(2000, 'https://school.test/reading'); submit();
  expect(find(render(), (props) => props.role === 'status')?.children).toContain('"Reading" added successfully. Click Save lesson');
  click('Close');
  expect(find(render(), (props) => props.title === 'External link')).toBeNull();
  expect(links).toHaveLength(1);
  click('Files');
  choose([new File(['PDF'], 'Worksheet.pdf')]);
  expect(find(render(), (props) => props.role === 'status')?.children).toContain('Queued for upload; click Save lesson to upload');
  click('Close');
  expect(find(render(), (props) => props.title === 'Lesson files')).toBeNull();
  expect(resources.files).toHaveLength(1);
  expect(state.api).not.toHaveBeenCalled();
});
it('confirms persisted uploads and links when reopening their dialogs after Save lesson', () => {
  lesson.files = [{ id: uuid(9), kind: 'file', name: 'Worksheet.pdf', size: 3 }];
  lesson.links = [{ id: uuid(10), kind: 'link', name: 'Reading', url: 'https://school.test/reading' }];
  links = lesson.links;
  click('Files');
  expect(find(render(), (props) => props.role === 'status')?.children).toEqual([1, ' ', 'file uploaded', ' successfully and saved to this lesson.']);
  click('Close'); click('External Link');
  expect(find(render(), (props) => props.role === 'status')?.children).toEqual([1, ' ', 'link saved', ' successfully to this lesson.']);
  click('Edit'); input(200, 'Changed reading'); submit();
  expect(find(render(), (props) => props.children === 'Saved')).toBeNull();
  expect(find(render(), (props) => props.children === 'Pending Save lesson')).not.toBeNull();
});
it('keeps entered values and rejects non-HTTPS links before staging', () => {
  click('External Link'); input(200, 'Unsafe'); input(2000, 'http://school.test'); submit();
  expect(find(render(), (props) => props.role === 'alert')).not.toBeNull();
  expect(links).toEqual([]);
  expect(state.api).not.toHaveBeenCalled();
});
it('stages multiple files and preserves their stable IDs across reopening the dialog', () => {
  click('Files');
  const files = [new File(['PDF'], 'Worksheet.pdf'), new File(['Text'], 'Notes.txt')];
  choose(files);
  expect(resources.files.map((item) => item.file)).toEqual(files);
  const ids = resources.files.map((item) => item.id);
  (find(render(), (props) => props.title === 'Lesson files')!.onClose as () => void)();
  click('Files');
  expect(resources.files.map((item) => item.id)).toEqual(ids);
  click('Remove');
  expect(resources.files).toHaveLength(1);
  expect(state.api).not.toHaveBeenCalled();
});
it('stages removal of existing files without deleting their blob', () => {
  lesson.files = [{ id: uuid(9), kind: 'file', name: 'Old.pdf', size: 3 }];
  click('Files'); click('Remove on save');
  expect(resources.removedFileIds).toEqual([uuid(9)]);
  expect(lesson.files).toHaveLength(1);
  expect(state.api).not.toHaveBeenCalled();
});
it('enforces file count, size and supported extensions before staging', () => {
  click('Files');
  choose(Array.from({ length: 21 }, () => new File(['PDF'], 'Worksheet.pdf')));
  expect(find(render(), (props) => props.role === 'alert')?.children).toContain('20 files');
  choose([new File(['script'], 'script.exe')]);
  expect(find(render(), (props) => props.role === 'alert')?.children).toContain('Supported files');
  const large = new File([], 'Large.pdf'); Object.defineProperty(large, 'size', { value: 25 * 1024 * 1024 + 1 });
  choose([large]);
  expect(find(render(), (props) => props.role === 'alert')?.children).toContain('25 MB');
  expect(resources.files).toEqual([]);
  expect(find(render(), (props) => props.role === 'status')).toBeNull();
});
it('keeps the dialog open while saving, whether Close or the header X is used', () => {
  click('Files');
  const tree = render(true);
  const closeButton = find(tree, (props) => props.children === 'Close' && typeof props.onClick === 'function')!;
  expect(closeButton.disabled).toBe(true);
  (closeButton.onClick as () => void)();
  (find(tree, (props) => props.title === 'Lesson files')!.onClose as () => void)();
  expect(find(render(), (props) => props.title === 'Lesson files')).not.toBeNull();
  expect(resources).toEqual(emptyResources());
});
