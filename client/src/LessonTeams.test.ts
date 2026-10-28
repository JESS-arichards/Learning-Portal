import { Children, isValidElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD_TYPES, type Lesson, type Snapshot, type User } from '../../shared/learning';

const state = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0, api: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(), useEffect: vi.fn(),
  useRef: (initial: unknown) => { const index = state.refIndex++; return state.refs[index] ?? (state.refs[index] = { current: initial }); },
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial;
    return [state.values[index], (value: unknown) => { state.values[index] = typeof value === 'function' ? value(state.values[index]) : value; }];
  },
}));
vi.mock('./api', () => ({ api: state.api, errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
import { LessonTeams } from './LessonTeams';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user: User = { id: 1, email: 'teacher@school.test', displayName: 'Teacher', roles: ['Staff'], isActive: true, sessionVersion: 0, studentEmails: [] };
const lesson: Lesson = { id: uuid(1), classId: uuid(2), name: 'Fractions', description: '', slotIds: [uuid(3)], links: [], files: [], updatedAt: '',
  schedule: { startDate: '2026-10-26', frequency: 'weekly', count: 2 },
  occurrences: [{ id: uuid(4), date: '2026-10-26', slotId: uuid(3) }, { id: uuid(5), date: '2026-11-02', slotId: uuid(3) }] };
let data: Snapshot;
const refresh = vi.fn(async () => {});
const onBusyChange = vi.fn();
function render() {
  state.index = 0; state.refIndex = 0;
  return LessonTeams({ lesson, data, user, refresh, onBusyChange });
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
function clickCreate() {
  (find(render(), (props) => props.children === 'Create / retry all meetings')!.onClick as () => void)();
}
beforeEach(() => {
  state.values = []; state.refs = []; state.api.mockReset(); refresh.mockClear(); onBusyChange.mockClear();
  data = { classes: [{ id: uuid(2), name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [user], students: [] }],
    lessons: [lesson], slots: [{ id: uuid(3), day: 0, name: 'P1', kind: 'lesson', start: '08:00', end: '09:00' }], periodTypes: DEFAULT_PERIOD_TYPES, meetings: [] };
  render(); state.values[0] = { configured: true, connected: true, meetingOptionsReady: true };
});
it('sends the meeting name and breakout setting for every occurrence in the series', async () => {
  (find(render(), (props) => props.maxLength === 200)!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Group workshop' } });
  (find(render(), (props) => props.type === 'checkbox')!.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
  state.api.mockImplementation(async (path: string) => ({ occurrenceId: path.includes(uuid(4)) ? uuid(4) : uuid(5), lessonId: lesson.id, organizerUserId: 1,
    title: 'Group workshop', state: 'created', optionsApplied: true, joinUrl: 'https://teams.microsoft.com/test' }));
  clickCreate();
  await vi.waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(state.api).toHaveBeenCalledTimes(2);
  for (const occurrence of lesson.occurrences!)
    expect(state.api).toHaveBeenCalledWith(`/lessons/${lesson.id}/occurrences/${occurrence.id}/teams`, 'POST', { title: 'Group workshop', options: { allowBreakoutRooms: true } });
  expect(refresh).toHaveBeenCalledOnce();
});
it('skips completed and cancelled occurrences rather than recreating invitations', async () => {
  state.values[4] = lesson.occurrences!.map((item, index) => ({ occurrenceId: item.id, lessonId: lesson.id, organizerUserId: 1,
    state: index ? 'cancelled' : 'created', joinUrl: null, optionsApplied: true }));
  clickCreate();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(state.api).not.toHaveBeenCalled();
});
it('retries the original settings on partial creation without changing the saved title', async () => {
  const existing = { occurrenceId: uuid(4), lessonId: lesson.id, organizerUserId: 1, state: 'created',
    title: 'Original workshop', options: { allowBreakoutRooms: true }, optionsApplied: false, joinUrl: null };
  state.values[4] = [existing, { ...existing, occurrenceId: uuid(5), state: 'cancelled' }];
  state.api.mockResolvedValue({ ...existing, optionsApplied: true });
  clickCreate();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(state.api).toHaveBeenCalledExactlyOnceWith(`/lessons/${lesson.id}/occurrences/${uuid(4)}/teams`, 'POST', { title: existing.title, options: existing.options });
});
it('reports partial series failures and skips local completed results on retry', async () => {
  state.api.mockResolvedValueOnce({ occurrenceId: uuid(4), lessonId: lesson.id, organizerUserId: 1, state: 'created', optionsApplied: true, joinUrl: 'https://teams.microsoft.com/one' })
    .mockRejectedValueOnce(new Error('Microsoft unavailable'));
  clickCreate();
  await vi.waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(find(render(), (props) => props.role === 'alert')?.children).toContain('1 meetings completed');
  state.api.mockResolvedValue({ occurrenceId: uuid(5), lessonId: lesson.id, organizerUserId: 1, state: 'created', optionsApplied: true, joinUrl: 'https://teams.microsoft.com/two' });
  clickCreate();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  expect(state.api.mock.calls.filter(([path]) => path.includes(uuid(4)))).toHaveLength(1);
});
it('requires refreshed consent before enabling meeting creation', () => {
  state.values[0] = { configured: true, connected: true, meetingOptionsReady: false };
  expect(find(render(), (props) => props.children === 'Create / retry all meetings')?.disabled).toBe(true);
  expect(find(render(), (props) => props.className === 'alert')?.children).toContain('OnlineMeetings.ReadWrite');
  expect(find(render(), (props) => props.href === '/api/teams/connect')?.target).toBe('_blank');
});
it('does not expose meeting creation to unassigned staff', () => {
  data.classes[0].teachers = [];
  expect(find(render(), (props) => props.children === 'Create / retry all meetings')).toBeNull();
  expect(find(render(), (props) => props.className === 'alert')?.children).toContain('Only an assigned class teacher');
});
