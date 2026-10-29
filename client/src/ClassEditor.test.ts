import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassInput, LearningClass } from '../../shared/learning';

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, api: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
}));
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('./api', () => ({ api: state.api, errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
import { ClassEditor } from './ClassEditor';

const input: ClassInput = {
  name: 'Maths', yearGroup: '7', division: 'Secondary',
  teachers: [{ displayName: 'Teacher', email: 'teacher@school.test' }],
  students: [{ displayName: 'Pending', email: 'pending@school.test' }],
};
const classroom: LearningClass = { ...input, id: '00000000-0000-4000-8000-000000000001', teachers: [{ ...input.teachers[0], id: 10 }] };
const preview = { classes: [classroom], rowCount: 1, errors: [], warnings: [{ row: 2, message: 'Pending enrolment' }] };
const onClose = vi.fn(), onSaved = vi.fn(async () => {});
function render(editing: LearningClass | null = null) {
  state.index = 0;
  return ClassEditor({ classroom: editing, onClose, onSaved });
}
function find(root: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  for (const child of Children.toArray(root)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child.props)) return child.props;
    const found = find(child.props.children as ReactNode, predicate);
    if (found) return found;
  }
  return null;
}
function submit(editing: LearningClass | null = null) {
  const form = find(render(editing), (props) => typeof props.onSubmit === 'function')!;
  (form.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
}
beforeEach(() => {
  state.values = []; state.index = 0; state.api.mockReset(); onClose.mockClear(); onSaved.mockClear();
  vi.stubGlobal('document', { body: {} });
});
afterEach(() => vi.unstubAllGlobals());
describe('manual class editor', () => {
  it('validates first without writing, shows pending enrolments, then saves', async () => {
    render(); state.values[0] = structuredClone(input);
    state.api.mockResolvedValueOnce(preview).mockResolvedValueOnce({ classroom, warnings: preview.warnings });
    submit();
    await vi.waitFor(() => expect(state.values[1]).toEqual(preview));
    expect(state.api).toHaveBeenCalledWith('/admin/classes/validate', 'POST', input);
    expect(onSaved).not.toHaveBeenCalled();
    expect(find(render(), (props) => props.children === 'Pending student enrolments (do not prevent saving)')).not.toBeNull();
    submit();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(state.api).toHaveBeenLastCalledWith('/admin/classes', 'POST', input);
    expect(onSaved).toHaveBeenCalledOnce();
  });
  it('populates existing details without sending teacher database IDs back as input', async () => {
    render(classroom);
    expect(state.values[0]).toEqual(input);
    state.values[1] = preview; state.api.mockResolvedValue({});
    submit(classroom);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(state.api).toHaveBeenCalledWith(`/admin/classes/${classroom.id}`, 'PUT', input);
  });
  it('invalidates validation when details change', () => {
    render(classroom); state.values[1] = preview;
    const field = find(render(classroom), (props) => props.value === 'Maths')!;
    (field.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Science' } });
    expect(state.values[1]).toBeNull();
    expect(state.values[0]).toMatchObject({ name: 'Science' });
  });
  it('keeps entered details and reports rejected saves', async () => {
    render(classroom); state.values[1] = preview;
    state.api.mockRejectedValue(new Error('Timetable clash'));
    submit(classroom);
    await vi.waitFor(() => expect(find(render(classroom), (props) => props.role === 'alert')?.children).toBe('Timetable clash'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(state.values[0]).toEqual(input);
  });
  it('does not save or close after validation errors', async () => {
    render(); state.values[0] = structuredClone(input);
    state.api.mockResolvedValue({ ...preview, errors: [{ row: 2, message: 'Teacher must be Staff' }] });
    submit();
    await vi.waitFor(() => expect(state.values[1]).toMatchObject({ errors: [{ row: 2, message: 'Teacher must be Staff' }] }));
    expect(state.api).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
