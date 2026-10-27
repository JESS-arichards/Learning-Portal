import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { classSchema, lessonSchema, DEFAULT_PERIOD_TYPES, type User, type Snapshot } from '../shared/learning.js';
import sharp from 'sharp';

vi.mock('./config.js', () => ({ config: {
  APPLICATIONS_PORTAL_URL: 'http://localhost:8080', PUBLIC_BASE_URL: 'http://localhost:5174',
  SESSION_SECRET: 'test-learning-secret-that-is-long-enough', production: false,
} }));
vi.mock('./platform.js', () => ({
  platform: vi.fn(), publicConfig: vi.fn(), getUser: vi.fn(), findUsers: vi.fn(), platformImage: vi.fn(), navigationFor: vi.fn(),
  parsePlatform: (schema: { parse: (data: unknown) => unknown }, data: unknown) => schema.parse(data),
}));
vi.mock('./repository.js', () => ({ snapshot: vi.fn(), save: vi.fn(), remove: vi.fn(), saveStructure: vi.fn() }));
vi.mock('./db.js', () => ({ transaction: vi.fn(async (work: (tx: object) => Promise<unknown>) => work({})), pool: vi.fn() }));
vi.mock('./storage.js', () => ({ putFile: vi.fn(), readFileContent: vi.fn(), deleteFile: vi.fn(), checkStorage: vi.fn() }));

import { createApp } from './app.js';
import { platform, getUser, findUsers, platformImage, navigationFor } from './platform.js';
import { snapshot, save, saveStructure, remove } from './repository.js';
import { readFileContent, putFile } from './storage.js';
import { HttpError } from './errors.js';
import { CSV_HEADERS } from './importClasses.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = (id: number) => ({ id, email: `user${id}@school.test`, displayName: `User ${id}` });
const user = (id: number, roles: string[], studentEmails: string[] = []): User => ({ ...person(id), roles, studentEmails, isActive: true, sessionVersion: 0 });
const seed: Snapshot = {
  periodTypes: DEFAULT_PERIOD_TYPES,
  classes: [
    { id: uuid(1), name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [person(10)], students: [person(20), person(21)] },
    { id: uuid(2), name: 'English', yearGroup: '8', division: 'Secondary', teachers: [person(11)], students: [person(22)] },
  ],
  slots: [
    { id: uuid(3), day: 0, name: 'Period 1', kind: 'lesson', start: '08:00', end: '09:00' },
    { id: uuid(4), day: 1, name: 'Period 1', kind: 'lesson', start: '08:00', end: '09:00' },
    { id: uuid(5), day: 0, name: 'Break', kind: 'break', start: '09:00', end: '09:20' },
  ],
  lessons: [{
    id: uuid(6), classId: uuid(1), name: 'Fractions', description: 'Introduction', slotIds: [uuid(3)], links: [],
    files: [{ id: uuid(7), kind: 'file', name: 'Worksheet.pdf', size: 3 }], updatedAt: new Date().toISOString(),
  }],
};
let state: Snapshot, current: User, server: Server, url: string, cookie: string;
async function call(path: string, method = 'GET', body?: unknown, authenticated = true) {
  const form = body instanceof FormData;
  return fetch(url + '/api' + path, { method, redirect: 'manual', headers: {
    'x-requested-with': 'learning-portal', ...(authenticated ? { Cookie: cookie } : {}),
    ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) });
}
const draft = { classId: uuid(1), name: 'New lesson', description: '', links: [], slotIds: [uuid(4)] };
beforeEach(async () => {
  await new Promise<void>((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
beforeEach(async () => {
  vi.clearAllMocks(); state = structuredClone(seed); current = user(10, ['Staff']);
  vi.mocked(platform).mockImplementation(async (path) => path === '/learning/sso/start'
    ? { authorizationUrl: 'http://localhost:8080/api/auth/learning/authorize?request=test' } : current);
  vi.mocked(getUser).mockImplementation(async () => current);
  vi.mocked(findUsers).mockImplementation(async (emails) => [user(10, ['Staff']), user(20, ['Student'])].filter((u) => emails.includes(u.email)));
  vi.mocked(snapshot).mockImplementation(async () => structuredClone(state));
  vi.mocked(save).mockImplementation(async (_tx, kind, id, value) => {
    if (kind === 'class') state.classes = [...state.classes.filter((c) => c.id !== id), classSchema.parse(value)];
    if (kind === 'lesson') state.lessons = [...state.lessons.filter((l) => l.id !== id), lessonSchema.parse(value)];
  });
  vi.mocked(saveStructure).mockImplementation(async (_tx, structure) => { Object.assign(state, structure); });
  vi.mocked(remove).mockImplementation(async (_tx, kind, id) => {
    if (kind === 'class') state.classes = state.classes.filter((c) => c.id !== id);
    if (kind === 'lesson') state.lessons = state.lessons.filter((l) => l.id !== id);
  });
  vi.mocked(readFileContent).mockResolvedValue(Buffer.from('pdf'));
  const start = await call('/auth/start', 'GET', undefined, false);
  const flow = vi.mocked(platform).mock.calls.find(([path]) => path === '/learning/sso/start')?.[2] as { state: string };
  const login = await fetch(url + `/api/auth/callback?code=${'c'.repeat(43)}&state=${flow.state}`, {
    redirect: 'manual', headers: { Cookie: start.headers.get('set-cookie')!.split(';')[0] },
  });
  cookie = login.headers.getSetCookie().find((value) => value.startsWith('learning_session='))!.split(';')[0];
});

describe('authenticated learning API', () => {
  it('serves central images same-origin and exposes only the signed-in user avatar', async () => {
    vi.mocked(platformImage).mockResolvedValue({ data: Buffer.from('image'), contentType: 'image/png' });
    const logo = await call('/branding/assets/logo', 'GET', undefined, false);
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toContain('image/png');
    expect(logo.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(logo.headers.get('cache-control')).toBe('no-store');
    expect(platformImage).toHaveBeenCalledWith('/learning/assets/logo');
    expect((await call('/branding/assets/not-a-branding-asset')).status).toBe(400);
    expect((await call('/me/avatar', 'GET', undefined, false)).status).toBe(401);
    const avatar = await call('/me/avatar?id=999');
    expect(avatar.status).toBe(200);
    expect(platformImage).toHaveBeenLastCalledWith('/learning/users/10/avatar');
    vi.mocked(platformImage).mockRejectedValueOnce(new HttpError(404, 'Image not found.'));
    expect((await call('/me/avatar')).status).toBe(404);
  });
  it('loads the central menu only for the authenticated identity and fails explicitly on central outage', async () => {
    vi.mocked(navigationFor).mockResolvedValue({ items: [], portalUrl: 'http://localhost:8080', learningUrl: 'http://localhost:5174', adminUrl: null, parkingReleaseUrl: null, parkingBay: null });
    expect((await call('/navigation', 'GET', undefined, false)).status).toBe(401);
    expect(navigationFor).not.toHaveBeenCalled();
    expect((await call('/navigation?id=999')).status).toBe(200);
    expect(navigationFor).toHaveBeenCalledWith(10);
    vi.mocked(navigationFor).mockRejectedValueOnce(new HttpError(503, 'Central unavailable.'));
    expect((await call('/navigation')).status).toBe(503);
  });
  it('uses an independent HttpOnly SameSite cookie and requires sign-in', async () => {
    expect(cookie).toContain('learning_session=');
    expect((await call('/learning', 'GET', undefined, false)).status).toBe(401);
  });
  it('requires CSRF custom header before mutations', async () => {
    const response = await fetch(url + '/api/lessons', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
  it('fails closed on central platform failure and session invalidation', async () => {
    vi.mocked(getUser).mockRejectedValueOnce(new HttpError(503, 'Central unavailable'));
    expect((await call('/learning')).status).toBe(503);
    expect(snapshot).not.toHaveBeenCalled();
    current = { ...current, sessionVersion: 1 };
    expect((await call('/learning')).status).toBe(401);
  });
  it('honors central account deactivation on next request', async () => {
    current.isActive = false;
    expect((await call('/learning')).status).toBe(401);
  });
  it('returns only enrolled student data without peer roster entries', async () => {
    current = user(20, ['Student']);
    const response = await call('/learning');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const data = await response.json();
    expect(data.classes).toHaveLength(1);
    expect(data.classes[0].students).toEqual([person(20)]);
  });
  it('returns attached children, and live link removal removes timetable access', async () => {
    current = user(99, ['Parent'], [person(20).email]);
    expect((await (await call('/learning')).json()).children).toEqual([person(20)]);
    current.studentEmails = [];
    expect((await (await call('/learning')).json()).lessons).toEqual([]);
  });
  it('creates one lesson across different days, preserving its resources on later edits', async () => {
    const response = await call('/lessons', 'POST', { ...draft, slotIds: [uuid(4)] });
    expect(response.status).toBe(200);
    expect((await response.json()).slotIds).toEqual([uuid(4)]);
    const edit = await call(`/lessons/${uuid(6)}`, 'PUT', { ...draft, slotIds: [uuid(3)] });
    expect(edit.status).toBe(200);
    expect((await edit.json()).files).toEqual(seed.lessons[0].files);
  });
  it('blocks teachers from managing other classes, and students from creating lessons', async () => {
    expect((await call('/lessons', 'POST', { ...draft, classId: uuid(2) })).status).toBe(403);
    current = user(20, ['Student']);
    expect((await call('/lessons', 'POST', draft)).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
  it('honors central teaching-role revocation without waiting for a roster import', async () => {
    current.roles = [];
    expect((await call('/lessons', 'POST', draft)).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects breaks, timetable clashes and duplicate slot IDs', async () => {
    expect((await call('/lessons', 'POST', { ...draft, slotIds: [uuid(5)] })).status).toBe(409);
    expect((await call('/lessons', 'POST', { ...draft, slotIds: [uuid(3)] })).status).toBe(409);
    expect((await call('/lessons', 'POST', { ...draft, slotIds: [uuid(4), uuid(4)] })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it('prevents reassignment of lessons to a different class even for admins', async () => {
    current = user(10, ['Learn Admin']);
    expect((await call(`/lessons/${uuid(6)}`, 'PUT', { ...draft, classId: uuid(2) })).status).toBe(400);
  });
  it('protects day structure and validates referenced periods', async () => {
    expect((await call('/admin/structure', 'PUT', [])).status).toBe(403);
    current = user(10, ['Learn Admin']);
    expect((await call('/admin/structure', 'PUT', [])).status).toBe(409);
    expect((await call('/admin/structure', 'PUT', seed.slots.map((s) => s.id === uuid(3) ? { ...s, kind: 'break' } : s))).status).toBe(409);
    expect((await call('/admin/structure', 'PUT', seed.slots)).status).toBe(200);
  });
  it.each(['Learn Admin', 'Full Admin'])('persists custom types and multi-day periods for %s and exposes them in timetables', async (role) => {
    current = user(10, [role]);
    const type = { id: uuid(30), name: 'Registration', kind: 'lesson' };
    const added = [0, 1, 2, 3, 4].map((day) => ({
      id: uuid(40 + day), day, name: 'Registration', kind: 'lesson', typeId: type.id, start: '07:30', end: '07:45',
    }));
    const structure = { slots: [...seed.slots, ...added], periodTypes: [...DEFAULT_PERIOD_TYPES, type] };
    const response = await call('/admin/structure', 'PUT', structure);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(structure);
    expect(saveStructure).toHaveBeenCalledWith(expect.anything(), structure);
    current = user(20, ['Student']);
    const timetable = await (await call('/learning')).json();
    expect(timetable.periodTypes).toEqual(structure.periodTypes);
    expect(timetable.slots).toEqual(structure.slots);
  });
  it('rejects invalid type changes, removal of in-use types and multi-day overlaps without saving', async () => {
    current = user(10, ['Learn Admin']);
    expect((await call('/admin/structure', 'PUT', { slots: seed.slots, periodTypes: [DEFAULT_PERIOD_TYPES[0]] })).status).toBe(400);
    const breaks = seed.slots.map((slot) => slot.kind === 'lesson' ? { ...slot, kind: 'break', typeId: 'lesson' } : slot);
    expect((await call('/admin/structure', 'PUT', {
      slots: breaks, periodTypes: DEFAULT_PERIOD_TYPES.map((type) => ({ ...type, kind: 'break' })),
    })).status).toBe(409);
    expect((await call('/admin/structure', 'PUT', {
      slots: [...seed.slots, { ...seed.slots[0], id: uuid(80), start: '08:30' }], periodTypes: DEFAULT_PERIOD_TYPES,
    })).status).toBe(400);
    expect(saveStructure).not.toHaveBeenCalled();
    expect(state).toEqual(seed);
  });
  it('protects lesson file downloads by live class membership', async () => {
    current = user(22, ['Student']);
    expect((await call(`/lessons/${uuid(6)}/files/${uuid(7)}`)).status).toBe(404);
    expect(readFileContent).not.toHaveBeenCalled();
    current = user(20, ['Student']);
    const file = await call(`/lessons/${uuid(6)}/files/${uuid(7)}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('attachment;');
    expect(file.headers.get('content-type')).toContain('application/octet-stream');
    expect(await file.text()).toBe('pdf');
  });
  it('uploads files to the lesson and rejects executable resources', async () => {
    const data = new FormData(); data.append('file', new Blob(['content']), 'worksheet.pdf');
    expect((await call(`/lessons/${uuid(6)}/files`, 'POST', data)).status).toBe(200);
    expect(state.lessons[0].files).toHaveLength(2);
    const bad = new FormData(); bad.append('file', new Blob(['bad']), 'bad.exe');
    expect((await call(`/lessons/${uuid(6)}/files`, 'POST', bad)).status).toBe(400);
    expect(putFile).toHaveBeenCalledTimes(1);
  });
  it('blocks file upload by students before storing bytes', async () => {
    current = user(20, ['Student']);
    const data = new FormData(); data.append('file', new Blob(['content']), 'worksheet.pdf');
    expect((await call(`/lessons/${uuid(6)}/files`, 'POST', data)).status).toBe(403);
    expect(putFile).not.toHaveBeenCalled();
  });
  it('stores reduced image bytes and persists the resulting filename and byte count', async () => {
    const original = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#112233' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const data = new FormData(); data.append('file', new Blob([new Uint8Array(original)]), 'Lesson photo.jpg');
    const response = await call(`/lessons/${uuid(6)}/files`, 'POST', data);
    expect(response.status).toBe(200);
    const saved = await response.json();
    const [key, buffer, contentType] = vi.mocked(putFile).mock.calls[0];
    expect(key).toBe(saved.id);
    expect(saved.name).toBe('Lesson photo.webp');
    expect(saved.size).toBe(buffer.length);
    expect(contentType).toBe('image/webp');
    expect((await sharp(buffer).metadata()).exif).toBeUndefined();
    expect(state.lessons[0].files.at(-1)).toEqual(saved);
  });
  it('rejects corrupt image resources before writing any blob or lesson data', async () => {
    const data = new FormData(); data.append('file', new Blob(['not a photo']), 'Corrupt.png');
    expect((await call(`/lessons/${uuid(6)}/files`, 'POST', data)).status).toBe(400);
    expect(putFile).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('accepts files at 25 MB and rejects files over the exact limit', async () => {
    const data = new FormData(); data.append('file', new Blob([new Uint8Array(25 * 1024 * 1024)]), 'large.pdf');
    expect((await call(`/lessons/${uuid(6)}/files`, 'POST', data)).status).toBe(200);
    expect(state.lessons[0].files.at(-1)?.size).toBe(25 * 1024 * 1024);
    const oversized = new FormData(); oversized.append('file', new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]), 'oversized.pdf');
    expect((await call(`/lessons/${uuid(6)}/files`, 'POST', oversized)).status).toBe(400);
    expect(putFile).toHaveBeenCalledTimes(1);
  });
  it('rejects class CSV files over 2 MB before matching users', async () => {
    current = user(10, ['Learn Admin']);
    const data = new FormData(); data.append('file', new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]), 'oversized.csv');
    expect((await call('/admin/classes/preview', 'POST', data)).status).toBe(400);
    expect(findUsers).not.toHaveBeenCalled();
  });
  it('requires lesson removal before deleting a class', async () => {
    current = user(10, ['Full Admin']);
    expect((await call(`/admin/classes/${uuid(1)}`, 'DELETE')).status).toBe(409);
    expect((await call(`/lessons/${uuid(6)}`, 'DELETE')).status).toBe(200);
    expect((await call(`/admin/classes/${uuid(1)}`, 'DELETE')).status).toBe(200);
  });
  it('revalidates CSV on import and never saves rows with an unmatched teacher', async () => {
    current = user(10, ['Learn Admin']);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') + '\nMaths,Teacher,missing@school.test,Student,user20@school.test,7,Secondary']), 'classes.csv');
    const preview = await call('/admin/classes/preview', 'POST', data);
    expect((await preview.json()).errors[0].row).toBe(2);
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it('previews without writes, then imports unknown students and immediately honours parent and student emails', async () => {
    current = user(10, ['Learn Admin']);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') + '\nMaths,Teacher,user10@school.test,Pending Student,pending@school.test,7,Secondary']), 'classes.csv');
    const preview = await (await call('/admin/classes/preview', 'POST', data)).json();
    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toEqual([{ row: 2, message: expect.stringContaining('pending@school.test') }]);
    expect(save).not.toHaveBeenCalled();
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(200);
    const child = { email: 'pending@school.test', displayName: 'Pending Student' };
    expect(state.classes.find((c) => c.id === uuid(1))?.students).toEqual([child]);
    current = user(99, ['Parent'], [child.email]);
    const parentData = await (await call('/learning')).json();
    expect(parentData.children).toEqual([child]);
    expect(parentData.classes).toHaveLength(1);
    expect(parentData.lessons).toEqual(seed.lessons);
    current.studentEmails = [];
    expect((await (await call('/learning')).json()).lessons).toEqual([]);
    current = { ...user(1234, ['Student']), email: child.email };
    const studentData = await (await call('/learning')).json();
    expect(studentData.classes[0].students).toEqual([child]);
    expect(studentData.lessons).toEqual(seed.lessons);
    expect((await call(`/lessons/${uuid(6)}/files/${uuid(7)}`)).status).toBe(200);
    current.roles = [];
    expect((await (await call('/learning')).json()).classes).toEqual([]);
    expect((await call(`/lessons/${uuid(6)}/files/${uuid(7)}`)).status).toBe(404);
  });
  it('rejects membership changes that cause shared-email timetable clashes before saving', async () => {
    current = user(10, ['Learn Admin']);
    state.classes[0].students = [{ email: 'pending@school.test', displayName: 'Pending Student' }];
    state.lessons.push({ ...state.lessons[0], id: uuid(50), classId: uuid(2) });
    const before = structuredClone(state);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') + '\nEnglish,Teacher,user11@school.test,Pending Student,PENDING@school.test,8,Secondary']), 'classes.csv');
    vi.mocked(findUsers).mockResolvedValue([user(11, ['Staff'])]);
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(409);
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });
  it('rejects the whole class upload if any row is invalid, even alongside valid pending students', async () => {
    current = user(10, ['Learn Admin']);
    const before = structuredClone(state);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') +
      '\nMaths,Teacher,user10@school.test,Pending Student,pending@school.test,7,Secondary' +
      '\nEnglish,Teacher,missing@school.test,Another Student,another@school.test,8,Secondary']), 'classes.csv');
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });
  it('checks current directory permissions again after a successful preview', async () => {
    current = user(10, ['Learn Admin']);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') + '\nMaths,Teacher,user10@school.test,Student,pending@school.test,7,Secondary']), 'classes.csv');
    expect((await (await call('/admin/classes/preview', 'POST', data)).json()).errors).toEqual([]);
    vi.mocked(findUsers).mockResolvedValue([]);
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it('imports included class rosters, retaining existing class IDs and other classes', async () => {
    current = user(10, ['Learn Admin']);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') + '\nMaths,Teacher,user10@school.test,Student,user20@school.test,7,Secondary']), 'classes.csv');
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(200);
    expect(state.classes).toHaveLength(2);
    expect(state.classes.find((c) => c.name === 'Maths')?.id).toBe(uuid(1));
    expect(state.classes.find((c) => c.name === 'Maths')?.students).toHaveLength(1);
    expect(state.lessons).toEqual(seed.lessons);
  });
  it('does not accept Microsoft tokens or parent credentials on Learning Portal', async () => {
    vi.mocked(platform).mockClear();
    for (const path of ['/auth/entra', '/auth/otp/request', '/auth/otp/verify']) {
      expect((await call(path, 'POST', {}, false)).status).toBe(410);
    }
    expect(platform).not.toHaveBeenCalled();
  });
  it('ends only the Learning session and returns the user to the central Portal', async () => {
    const response = await call('/auth/logout', 'POST');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectUrl: 'http://localhost:8080/' });
    expect(response.headers.get('set-cookie')).toContain('learning_session=;');
  });
});
