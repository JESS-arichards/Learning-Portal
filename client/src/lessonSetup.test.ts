import { beforeEach, expect, it, vi } from 'vitest';
import type { Lesson, LessonInput, FileResource } from '../../shared/learning';
import { emptyResources, saveLessonSetup, type StagedResources } from './lessonSetup';

const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('./api', () => ({
  api: mock.api, errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
  fileBody: (file: File) => { const body = new FormData(); body.append('file', file); return body; },
}));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input: LessonInput = { classId: uuid(1), name: 'Fractions', description: '', slotIds: [uuid(2)],
  links: [{ id: uuid(3), kind: 'link', name: 'Reading', url: 'https://school.test/reading' }],
  schedule: { startDate: '2026-10-28', frequency: 'weekly', count: 2 } };
let saved: Lesson | undefined;
let resources: StagedResources;
const initial: Lesson = { ...input, id: uuid(4), files: [], updatedAt: '', occurrences: [
  { id: uuid(5), slotId: uuid(2), date: '2026-10-28' }, { id: uuid(6), slotId: uuid(2), date: '2026-11-04' },
] };
const progress = vi.fn();
const uploaded = { id: uuid(7), kind: 'file' as const, name: 'Worksheet.pdf', size: 3 };
function save() {
  return saveLessonSetup({ id: initial.id, saved, input, resources, onSaved: (lesson) => { saved = lesson; },
    onUploaded: (file: FileResource) => { resources = { ...resources, files: resources.files.filter((item) => item.id !== file.id) }; },
    onRemoved: (id) => { resources = { ...resources, removedFileIds: resources.removedFileIds.filter((item) => item !== id) }; },
    onTeamsSaved: () => { resources = { ...resources, teams: null }; }, onProgress: progress });
}
beforeEach(() => {
  mock.api.mockReset(); progress.mockReset(); saved = undefined; resources = emptyResources();
  mock.api.mockImplementation(async (path: string) => {
    if (path === '/teams/status') return { configured: true, connected: true, meetingOptionsReady: true };
    if (path === '/lessons' || path === `/lessons/${initial.id}`) return { ...initial, files: saved?.files ?? [] };
    if (path === '/learning') return { meetings: [] };
    if (path.endsWith('/files')) return uploaded;
    return { ok: true };
  });
});
it('saves details and links, then uploads files, then creates every Teams occurrence', async () => {
  resources = { files: [{ id: uploaded.id, file: new File(['PDF'], uploaded.name) }], removedFileIds: [],
    teams: { title: 'Group workshop', options: { allowBreakoutRooms: true } } };
  await save();
  expect(mock.api.mock.calls.map(([path]) => path)).toEqual(['/teams/status', '/lessons', `/lessons/${initial.id}/files`, '/learning',
    ...initial.occurrences!.map((item) => `/lessons/${initial.id}/occurrences/${item.id}/teams`)]);
  expect(mock.api).toHaveBeenCalledWith('/lessons', 'POST', { ...input, id: initial.id });
  const body = mock.api.mock.calls[2][2] as FormData;
  expect(body.get('resourceId')).toBe(uploaded.id);
  expect(saved?.files).toEqual([uploaded]);
  expect(resources).toEqual(emptyResources());
  expect(progress).toHaveBeenCalledWith('Creating Teams meeting for 28/10/2026...');
});
it('does not upload files or create meetings when lesson validation/save fails', async () => {
  resources.files = [{ id: uploaded.id, file: new File(['PDF'], uploaded.name) }];
  mock.api.mockRejectedValueOnce(new Error('Schedule conflict'));
  await expect(save()).rejects.toThrow('Schedule conflict');
  expect(mock.api).toHaveBeenCalledOnce();
  expect(resources.files).toHaveLength(1);
});
it('checks consent before creating any lesson, uploads or invitations', async () => {
  resources.teams = { title: 'Workshop', options: { allowBreakoutRooms: false } };
  mock.api.mockResolvedValueOnce({ configured: true, connected: true, meetingOptionsReady: false });
  await expect(save()).rejects.toThrow('approve meeting options');
  expect(mock.api).toHaveBeenCalledExactlyOnceWith('/teams/status');
});
it('retains failed uploads and retries the same file and lesson identities', async () => {
  resources.files = [{ id: uploaded.id, file: new File(['PDF'], uploaded.name) }];
  mock.api.mockImplementationOnce(async () => initial).mockRejectedValueOnce(new Error('Upload timed out'));
  await expect(save()).rejects.toThrow('Lesson details were saved, but setup is incomplete');
  expect(saved?.id).toBe(initial.id);
  expect(resources.files[0].id).toBe(uploaded.id);
  await save();
  expect(mock.api).toHaveBeenCalledWith(`/lessons/${initial.id}`, 'PUT', input);
  expect(mock.api.mock.calls.filter(([path]) => path === '/lessons')).toHaveLength(1);
  expect(resources.files).toEqual([]);
});
it('keeps a stable creation ID even when the first response was lost', async () => {
  mock.api.mockRejectedValueOnce(new Error('Response lost'));
  await expect(save()).rejects.toThrow('Response lost');
  await save();
  expect(mock.api.mock.calls.slice(0, 2).map((call) => call[2].id)).toEqual([initial.id, initial.id]);
});
it('does not repeat uploaded files or completed meetings when a later meeting fails', async () => {
  resources.files = [{ id: uploaded.id, file: new File(['PDF'], uploaded.name) }];
  resources.teams = { title: 'Workshop', options: { allowBreakoutRooms: true } };
  let created = false;
  mock.api.mockImplementation(async (path: string) => {
    if (path === '/teams/status') return { configured: true, connected: true, meetingOptionsReady: true };
    if (path === '/lessons' || path === `/lessons/${initial.id}`) return { ...initial, files: saved?.files ?? [] };
    if (path.endsWith('/files')) return uploaded;
    if (path === '/learning') return { meetings: created ? [{ occurrenceId: uuid(5), state: 'created', optionsApplied: true }] : [] };
    if (path.includes(uuid(5))) { created = true; return { ok: true }; }
    if (path.includes(uuid(6)) && mock.api.mock.calls.filter(([p]) => p.includes(uuid(6))).length === 1) throw new Error('Graph timeout');
    return { ok: true };
  });
  await expect(save()).rejects.toThrow('Remaining resources are retained');
  expect(resources.files).toEqual([]);
  expect(resources.teams).not.toBeNull();
  await save();
  expect(mock.api.mock.calls.filter(([path]) => path.endsWith('/files'))).toHaveLength(1);
  expect(mock.api.mock.calls.filter(([path]) => path.includes(uuid(5)))).toHaveLength(1);
  expect(resources.teams).toBeNull();
});
it('skips file removals already applied and cancelled meetings during recovery', async () => {
  saved = initial; resources.removedFileIds = [uuid(9)];
  resources.teams = { title: 'Workshop', options: { allowBreakoutRooms: false } };
  mock.api.mockImplementation(async (path: string) => path === '/teams/status' ? { configured: true, connected: true, meetingOptionsReady: true }
    : path === '/learning' ? { meetings: initial.occurrences!.map((item) => ({ occurrenceId: item.id, state: 'cancelled' })) } : initial);
  await save();
  expect(mock.api.mock.calls.map(([path]) => path)).toEqual(['/teams/status', `/lessons/${initial.id}`, '/learning']);
  expect(resources).toEqual(emptyResources());
});
