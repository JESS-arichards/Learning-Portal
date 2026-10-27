import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD_TYPES, type Snapshot } from '../../shared/learning';

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, api: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: vi.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => {
      state.values[index] = typeof value === 'function' ? value(state.values[index]) : value;
    }];
  },
}));
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('./api', () => ({ api: state.api, errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
import { DayStructure } from './DayStructure';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const data: Snapshot = {
  periodTypes: DEFAULT_PERIOD_TYPES, classes: [], lessons: [],
  slots: [{ id: uuid(1), day: 0, name: 'P1', kind: 'lesson', start: '08:00', end: '09:00' }],
};
const refresh = vi.fn(async () => {});
function render(snapshot = data) { state.index = 0; return DayStructure({ data: snapshot, refresh }); }
function find(root: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  for (const child of Children.toArray(root)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child.props)) return child.props;
    const nested = find(child.props.children as ReactNode, predicate);
    if (nested) return nested;
  }
  return null;
}
function click(name: string) {
  const props = find(render(), (props) => props['aria-label'] === name || (props.type === 'button'
    && Children.toArray(props.children as ReactNode).some((child) => typeof child === 'string' && child.trim() === name)));
  if (!props) throw new Error(`Missing ${name}`);
  (props.onClick as () => void)();
}
function submit() {
  const form = find(render(), (props) => typeof props.onSubmit === 'function');
  if (!form) throw new Error('Missing form');
  (form.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
}
beforeEach(() => {
  state.values = []; state.index = 0; state.api.mockReset(); refresh.mockClear();
  vi.stubGlobal('document', { body: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('day structure immediate saves', () => {
  it('opens the type dialog without creating a draft type in the list', async () => {
    click('Add type');
    let tree = render();
    expect(find(tree, (props) => props.title === 'Add period type')).not.toBeNull();
    expect(state.api).not.toHaveBeenCalled();
    const input = find(tree, (props) => props.maxLength === 100 && props.required === true && props.value === '');
    (input!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Registration' } });
    state.api.mockResolvedValue({ slots: data.slots, periodTypes: [...DEFAULT_PERIOD_TYPES, { id: uuid(9), name: 'Registration', kind: 'lesson' }] });
    tree = render();
    const modal = find(tree, (props) => props.title === 'Add period type')!;
    const form = find(modal.children as ReactNode, (props) => typeof props.onSubmit === 'function')!;
    (form.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(state.api).toHaveBeenCalledWith('/admin/period-types', 'PUT', expect.arrayContaining([expect.objectContaining({ name: 'Registration' })]));
    expect(find(render(), (props) => props.title === 'Add period type')).toBeNull();
  });
  it('saves edits only without adding the blank new-period row', async () => {
    const input = find(render(), (props) => props.value === 'P1')!;
    (input.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Renamed' } });
    const slots = [{ ...data.slots[0], name: 'Renamed' }];
    state.api.mockResolvedValue({ slots, periodTypes: DEFAULT_PERIOD_TYPES });
    submit();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(state.api).toHaveBeenCalledWith('/admin/structure', 'PUT', { slots, periodTypes: DEFAULT_PERIOD_TYPES });
  });
  it('saves a multi-day addition and pending edits in a single request', async () => {
    render();
    state.values[0] = [{ ...data.slots[0], name: 'Edited' }];
    state.values[4] = [1, 3];
    state.values[5] = { name: 'New', typeId: 'lesson', start: '10:00', end: '11:00' };
    state.api.mockImplementation(async (_path, _method, body) => body);
    submit();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(state.api).toHaveBeenCalledOnce();
    const saved = state.api.mock.calls[0][2];
    expect(saved.slots).toHaveLength(3);
    expect(saved.slots[0].name).toBe('Edited');
    expect(saved.slots.slice(1).map((slot: { day: number }) => slot.day)).toEqual([1, 3]);
  });
  it('retains pending edits and displays an explicit save failure', async () => {
    render();
    state.values[0] = [{ ...data.slots[0], name: 'Edited' }];
    state.api.mockRejectedValue(new Error('Database unavailable'));
    submit();
    await vi.waitFor(() => expect(find(render(), (props) => props.role === 'alert')?.children).toBe('Database unavailable'));
    expect(find(render(), (props) => props.value === 'Edited')).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('disables every field and delete control of used periods and removes whole-week saving', () => {
    const used: Snapshot = { ...data, lessons: [{ id: uuid(2), classId: uuid(3), name: 'Lesson', description: '', links: [], files: [], slotIds: [uuid(1)], updatedAt: '' }] };
    const tree = render(used);
    for (const value of ['P1', '08:00', '09:00']) expect(find(tree, (props) => props.value === value)?.disabled).toBe(true);
    expect(find(tree, (props) => props['aria-label'] === 'Remove P1')?.disabled).toBe(true);
    expect(find(tree, (props) => props['aria-label'] === 'Edit type Lesson')?.disabled).toBe(true);
    expect(find(tree, (props) => props.children === 'Save whole week')).toBeNull();
  });
});
