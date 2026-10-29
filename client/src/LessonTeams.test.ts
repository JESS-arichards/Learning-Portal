import { Children, isValidElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD_TYPES, type Lesson, type Snapshot, type User } from '../../shared/learning';

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, api: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(), useEffect: vi.fn(), useRef: (current: unknown) => ({ current }),
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
const lesson: Lesson = { id: uuid(1), classId: uuid(2), name: 'Fractions', description: '', slotIds: [], links: [], files: [], updatedAt: '' };
let data: Snapshot;
const onStage = vi.fn();
function render() {
  state.index = 0;
  return LessonTeams({ lesson, data, user, refresh: vi.fn(), onBusyChange: vi.fn(), staged: null, onStage });
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
beforeEach(() => {
  state.values = []; state.api.mockReset(); onStage.mockReset();
  data = { classes: [{ id: uuid(2), name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [user], students: [] }],
    lessons: [], slots: [], periodTypes: DEFAULT_PERIOD_TYPES, meetings: [] };
});
it('stages meeting name and breakout options before the lesson exists without sending invitations', () => {
  (find(render(), (props) => props.maxLength === 200)!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Group workshop' } });
  (find(render(), (props) => props.type === 'checkbox')!.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
  (find(render(), (props) => props.children === 'Add Teams meetings on save')!.onClick as () => void)();
  expect(onStage).toHaveBeenCalledExactlyOnceWith({ title: 'Group workshop', options: { allowBreakoutRooms: true } });
  expect(state.api).not.toHaveBeenCalled();
});
it('permits staging without teacher connection and directs application access failures to administrators', () => {
  render(); state.values[0] = { configured: true, connected: true, meetingOptionsReady: false };
  expect(find(render(), (props) => props.children === 'Add Teams meetings on save')?.disabled).toBe(false);
  expect(find(render(), (props) => props.className === 'alert')?.children).toContain('application permissions');
  expect(find(render(), (props) => props.href === '/api/teams/connect')).toBeNull();
});
it('shows actionable central identity and application access errors', () => {
  render(); state.values[0] = { configured: true, connected: false, meetingOptionsReady: false, error: 'Teacher has no verified school Microsoft identity.' };
  expect(find(render(), (props) => props.role === 'alert')?.children).toBe('Teacher has no verified school Microsoft identity.');
});
it('does not expose meeting configuration to unassigned staff', () => {
  data.classes[0].teachers = [];
  expect(find(render(), (props) => props.children === 'Add Teams meetings on save')).toBeNull();
});
