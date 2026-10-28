import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD_TYPES, type Lesson, type Snapshot, type User } from '../../shared/learning';

const state = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0, api: vi.fn(), fileBody: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(), useEffect: vi.fn(),
  useRef: (initial: unknown) => { const index = state.refIndex++; return state.refs[index] ?? (state.refs[index] = { current: initial }); },
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial;
    return [state.values[index], (value: unknown) => { state.values[index] = typeof value === 'function' ? value(state.values[index]) : value; }];
  },
}));
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('./api', () => ({ api: state.api, fileBody: state.fileBody, errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
import { LessonResources } from './LessonResources';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user: User = { id: 1, email: 'teacher@school.test', displayName: 'Teacher', roles: ['Staff'], isActive: true, sessionVersion: 0, studentEmails: [] };
let lesson: Lesson | undefined;
const data: Snapshot = { classes: [], lessons: [], slots: [], periodTypes: DEFAULT_PERIOD_TYPES };
const refresh = vi.fn(async () => {});
const onBusyChange = vi.fn();
const onChange = vi.fn((updated: Lesson) => { lesson = updated; });
function render() {
  state.index = 0; state.refIndex = 0;
  return LessonResources({ lesson, data, user, disabled: false, onChange, onBusyChange, refresh });
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
beforeEach(() => {
  state.values = []; state.refs = []; state.api.mockReset(); state.fileBody.mockReset().mockReturnValue('upload-body');
  refresh.mockClear(); onChange.mockClear(); onBusyChange.mockClear();
  lesson = { id: uuid(1), classId: uuid(2), name: 'Fractions', description: '', slotIds: [uuid(3)], links: [], files: [], updatedAt: '' };
  vi.stubGlobal('document', { body: {} }); vi.stubGlobal('window', { confirm: () => true });
});
afterEach(() => vi.unstubAllGlobals());
it.each([['Files', 'Lesson files'], ['External Link', 'External link'], ['Teams', 'Teams meeting']])('opens the %s dialog', (button, title) => {
  click(button);
  expect(find(render(), (props) => props.title === title)).not.toBeNull();
  expect(state.api).not.toHaveBeenCalled();
});
it('explains that an unsaved lesson must be saved before attaching resources', () => {
  lesson = undefined; click('Teams');
  expect(find(render(), (props) => props.role === undefined && props.className === 'alert')?.children).toContain('Save the lesson first');
  expect(state.api).not.toHaveBeenCalled();
});
it('adds a named external link and updates saved resources immediately', async () => {
  click('External Link'); input(200, 'Reading'); input(2000, 'https://school.test/reading');
  state.api.mockImplementation(async (_path, _method, body) => ({ ...lesson, links: [body] }));
  submit();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(state.api).toHaveBeenCalledWith(`/lessons/${uuid(1)}/links`, 'POST', expect.objectContaining({ kind: 'link', name: 'Reading', url: 'https://school.test/reading' }));
  expect(lesson?.links[0].name).toBe('Reading');
});
it('keeps entered values and shows invalid HTTPS URLs without an API write', async () => {
  click('External Link'); input(200, 'Unsafe'); input(2000, 'http://school.test');
  submit();
  await vi.waitFor(() => expect(find(render(), (props) => props.role === 'alert')).not.toBeNull());
  expect(state.api).not.toHaveBeenCalled();
  expect(find(render(), (props) => props.value === 'Unsafe')).not.toBeNull();
});
it('keeps the same resource ID when retrying an ambiguous add failure', async () => {
  click('External Link'); input(200, 'Reading'); input(2000, 'https://school.test/reading');
  state.api.mockRejectedValueOnce(new Error('Network failed'));
  submit();
  await vi.waitFor(() => expect(find(render(), (props) => props.role === 'alert')?.children).toBe('Network failed'));
  const first = state.api.mock.calls[0][2];
  state.api.mockImplementation(async (_path, _method, body) => ({ ...lesson, links: [body] }));
  submit();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(state.api.mock.calls[1][2]).toEqual(first);
});
it('edits an existing link using its identity and removes it without saving lesson details', async () => {
  const link = { id: uuid(4), kind: 'link' as const, name: 'Old reading', url: 'https://school.test/old' };
  lesson!.links = [link];
  click('External Link'); click('Edit'); input(200, 'New reading');
  state.api.mockImplementation(async (_path, method, body) => ({ ...lesson, links: method === 'DELETE' ? [] : [body] }));
  submit();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(state.api).toHaveBeenCalledWith(`/lessons/${uuid(1)}/links/${link.id}`, 'PUT', { ...link, name: 'New reading' });
  click('Remove');
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  expect(lesson?.links).toEqual([]);
});
it('uploads through the existing private file API and refreshes the saved attachment list', async () => {
  click('Files');
  const file = new File(['PDF'], 'Worksheet.pdf', { type: 'application/pdf' });
  const updated = { ...lesson!, files: [{ id: uuid(5), kind: 'file' as const, name: file.name, size: 3 }] };
  state.api.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ...data, lessons: [updated] });
  const props = find(render(), (props) => props.type === 'file')!;
  (props.onChange as (event: { target: { files: File[]; value: string } }) => void)({ target: { files: [file], value: file.name } });
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(state.fileBody).toHaveBeenCalledWith(file);
  expect(state.api).toHaveBeenCalledWith(`/lessons/${uuid(1)}/files`, 'POST', 'upload-body');
  expect(lesson?.files).toEqual(updated.files);
});
it('prevents closing the dialog during an in-flight resource operation', async () => {
  click('External Link'); input(200, 'Reading'); input(2000, 'https://school.test/reading');
  let resolve!: (value: Lesson) => void;
  state.api.mockImplementation(() => new Promise<Lesson>((done) => { resolve = done; }));
  submit();
  const modal = find(render(), (props) => props.title === 'External link')!;
  (modal.onClose as () => void)();
  expect(find(render(), (props) => props.title === 'External link')).not.toBeNull();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  resolve(lesson!);
  await vi.waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  (find(render(), (props) => props.title === 'External link')!.onClose as () => void)();
  expect(find(render(), (props) => props.title === 'External link')).toBeNull();
});
