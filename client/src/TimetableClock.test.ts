import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD_TYPES, type Snapshot, type User } from '../../shared/learning';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effect: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: hooks.effect,
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
}));
import { Timetable } from './Timetable';

const data: Snapshot = {
  periodTypes: DEFAULT_PERIOD_TYPES, classes: [], lessons: [],
  slots: [
    { id: 'one', day: 0, name: 'P1', kind: 'lesson', start: '08:00', end: '09:00' },
    { id: 'two', day: 0, name: 'P2', kind: 'lesson', start: '09:00', end: '10:00' },
    { id: 'tomorrow', day: 1, name: 'Tuesday P1', kind: 'lesson', start: '09:00', end: '10:00' },
  ],
};
const user: User = { id: 1, email: 'student@school.test', displayName: 'Student', isActive: true, sessionVersion: 0, roles: ['Student'], studentEmails: [] };
function render() {
  hooks.index = 0;
  return Timetable({ data, user, children: [] });
}
function find(root: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  for (const child of Children.toArray(root)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child.props)) return child.props;
    const nested = find(child.props.children as ReactNode, predicate);
    if (nested) return nested;
  }
  return null;
}
afterEach(() => {
  vi.useRealTimers();
  hooks.values = [];
  hooks.effect.mockClear();
});

it('updates the current period without reloading and cleans up its timer', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T04:59:59Z'));
  const tree = render();
  const current = (props: Record<string, unknown>) => props['aria-current'] === 'time';
  expect(find(tree, current)?.className).toContain('current-period');
  const cleanup = hooks.effect.mock.calls[0][0]();
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(1000);
  const active = find(render(), current);
  expect(find(active?.children as ReactNode, (props) => props.children === '09:00')).not.toBeNull();
  vi.advanceTimersByTime(60 * 60 * 1000);
  expect(find(render(), current)).toBeNull();
  vi.setSystemTime(new Date('2026-10-26T05:30:00Z'));
  vi.advanceTimersByTime(1000);
  expect(find(render(), current)).not.toBeNull();
  const tomorrow = find(render(), (props) => typeof props.onClick === 'function'
    && Children.toArray(props.children as ReactNode).some((child) => isValidElement<{ children: ReactNode }>(child) && child.props.children === 'Tue'));
  expect(tomorrow).not.toBeNull();
  (tomorrow!.onClick as () => void)();
  expect(find(render(), current)).toBeNull();
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
});
