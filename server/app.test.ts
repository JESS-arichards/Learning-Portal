import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { classSchema, lessonSchema, DEFAULT_PERIOD_TYPES, type User, type Snapshot } from '../shared/learning.js';
import sharp from 'sharp';

vi.mock('./config.js', () => ({ config: {
  APPLICATIONS_PORTAL_URL: 'http://localhost:8080', PUBLIC_BASE_URL: 'http://localhost:5174',
  SESSION_SECRET: 'test-learning-secret-that-is-long-enough', production: false, SQL_SERVERLESS_ENABLED: false,
  ALLOW_SCHEDULE_RESET: false, TEAMS_ENABLED: false,
} }));
vi.mock('./platform.js', () => ({
  platform: vi.fn(), publicConfig: vi.fn(), getUser: vi.fn(), findUsers: vi.fn(), platformImage: vi.fn(), navigationFor: vi.fn(),
  parsePlatform: (schema: { parse: (data: unknown) => unknown }, data: unknown) => schema.parse(data),
}));
vi.mock('./repository.js', () => ({ snapshot: vi.fn(), save: vi.fn(), saveLessonType: vi.fn(), remove: vi.fn(), saveStructure: vi.fn(), saveCalendar: vi.fn() }));
vi.mock('./db.js', () => ({ transaction: vi.fn(async (work: (tx: object) => Promise<unknown>) => work({})), pool: vi.fn() }));
vi.mock('./storage.js', () => ({ putFile: vi.fn(), readFileContent: vi.fn(), deleteFile: vi.fn(), checkStorage: vi.fn() }));

import { createApp } from './app.js';
import { platform, getUser, findUsers, platformImage, navigationFor, publicConfig } from './platform.js';
import { pool } from './db.js';
import { snapshot, save, saveLessonType, saveStructure, remove, saveCalendar } from './repository.js';
import { readFileContent, putFile, deleteFile, checkStorage } from './storage.js';
import { HttpError } from './errors.js';
import { config } from './config.js';
import { CSV_HEADERS } from './importClasses.js';
import { academicCalendarSchema, SUNDAY_TEACHING_WEEK, DEFAULT_TEACHING_WEEK } from '../shared/calendar.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = (id: number) => ({ id, email: `user${id}@school.test`, displayName: `User ${id}` });
const user = (id: number, roles: string[], studentEmails: string[] = []): User => ({
  ...person(id), roles, studentEmails, department: roles.includes('Student') ? 'Primary Student' : null,
  isActive: true, sessionVersion: 0,
});
const seed: Snapshot = {
  lessonTypes: [{ id: uuid(90), name: 'Seesaw', colour: '#FFC83D', icon: null }],
  calendar: {
    years: [{ id: uuid(70), name: '2026/27', start: '2026-09-01', end: '2027-07-01' }],
    terms: [{ id: uuid(71), yearId: uuid(70), name: 'Term 1', start: '2026-09-01', end: '2026-12-11' }],
    holidays: [],
  },
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
const draft = { classId: uuid(1), lessonTypeId: uuid(90), name: 'New lesson', description: '', links: [], slotIds: [uuid(4)], schedule: { startDate: '2026-10-27', frequency: 'once', count: 1 } };
const resourceLink = { id: uuid(80), kind: 'link', name: 'Lesson reading', url: 'https://school.test/reading' };
beforeEach(async () => {
  config.SQL_SERVERLESS_ENABLED = false;
  config.ALLOW_SCHEDULE_RESET = false;
  config.TEAMS_ENABLED = false;
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
  vi.mocked(saveLessonType).mockImplementation(async (_tx, type) => {
    state.lessonTypes = [...(state.lessonTypes ?? []).filter((item) => item.id !== type.id), type];
  });
  vi.mocked(saveCalendar).mockImplementation(async (_tx, calendar) => { state.calendar = academicCalendarSchema.parse(calendar); });
  vi.mocked(remove).mockImplementation(async (_tx, kind, id) => {
    if (kind === 'class') state.classes = state.classes.filter((c) => c.id !== id);
    if (kind === 'lessonType') state.lessonTypes = state.lessonTypes?.filter((type) => type.id !== id);
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
  it.each([
    { roles: ['Parent'], department: 'Primary Student' },
    { roles: ['Learn Admin'], department: null },
    { roles: ['Learn User'], department: null },
    { roles: ['Student'], department: 'Secondary Student' },
    { roles: ['Student'], department: null },
  ])('blocks direct data, administration and resource requests for ineligible $roles / $department', async (changes) => {
    current = { ...user(20, changes.roles), ...changes };
    for (const path of ['/me', '/navigation', '/learning', `/lessons/${uuid(6)}/files/${uuid(7)}`]) {
      expect((await call(path)).status).toBe(403);
    }
    expect((await call('/admin/structure', 'PUT', seed.slots)).status).toBe(403);
    expect(snapshot).not.toHaveBeenCalled();
    expect(readFileContent).not.toHaveBeenCalled();
    expect(saveStructure).not.toHaveBeenCalled();
  });
  it.each(['Jumeirah Student', 'Primary Student'])('revokes %s access immediately when its department changes', async (department) => {
    current = { ...user(20, ['Student']), department };
    expect((await call('/learning')).status).toBe(200);
    vi.mocked(snapshot).mockClear();
    current.department = 'Secondary Student';
    expect((await call('/learning')).status).toBe(403);
    expect((await call(`/lessons/${uuid(6)}/files/${uuid(7)}`)).status).toBe(403);
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('only allows Teams framing when explicitly enabled and retains the browser default otherwise', async () => {
    const ordinary = await call('/live');
    expect(ordinary.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(ordinary.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(ordinary.headers.get('content-security-policy')).not.toContain('https://teams.microsoft.com');
    config.TEAMS_ENABLED = true;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not start');
    url = `http://127.0.0.1:${address.port}`;
    const embedded = await call('/live');
    expect(embedded.headers.has('x-frame-options')).toBe(false);
    expect(embedded.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft",
    );
    expect(embedded.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
    expect(embedded.headers.get('content-security-policy')).toContain("img-src 'self' http://localhost:8080 data: blob:");
  });
  it.each(['Full Admin', 'Learn Admin'])('allows %s to create, edit and delete unused lesson types', async (role) => {
    current = user(10, ['Staff', role]);
    const input = { name: 'Workshop', colour: '#FFC83D', icon: 'pencil' };
    const response = await call('/admin/lesson-types', 'POST', input);
    expect(response.status).toBe(200);
    const type = await response.json();
    expect(state.lessonTypes).toContainEqual(type);
    const updated = await call(`/admin/lesson-types/${type.id}`, 'PUT', { ...input, name: 'Seesaw', icon: null });
    expect(updated.status).toBe(409);
    expect((await call(`/admin/lesson-types/${type.id}`, 'PUT', { ...input, name: 'Seminar', icon: null })).status).toBe(200);
    expect(state.lessonTypes?.find((item) => item.id === type.id)?.icon).toBeNull();
    expect((await call(`/admin/lesson-types/${type.id}`, 'DELETE')).status).toBe(200);
    expect(state.lessonTypes?.some((item) => item.id === type.id)).toBe(false);
  });
  it.each(['Staff', 'Student', 'Parent'])('prevents %s from managing lesson types', async (role) => {
    current = user(10, [role]);
    const input = { name: 'Workshop', colour: '#FFC83D', icon: null };
    expect((await call('/admin/lesson-types', 'POST', input)).status).toBe(403);
    expect((await call(`/admin/lesson-types/${uuid(90)}`, 'PUT', input)).status).toBe(403);
    expect((await call(`/admin/lesson-types/${uuid(90)}`, 'DELETE')).status).toBe(403);
    expect(saveLessonType).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it('validates type configuration and prevents deletion of a used type', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    const input = { name: 'Workshop', colour: '#FFC83D', icon: null };
    for (const change of [{ name: '' }, { colour: 'red' }, { icon: 'invalid' }]) {
      expect((await call('/admin/lesson-types', 'POST', { ...input, ...change })).status).toBe(400);
    }
    expect((await call('/admin/lesson-types', 'POST', { ...input, name: ' seesaw ' })).status).toBe(409);
    expect((await call(`/admin/lesson-types/${uuid(99)}`, 'PUT', input)).status).toBe(404);
    expect((await call(`/admin/lesson-types/${uuid(99)}`, 'DELETE')).status).toBe(404);
    state.lessons[0].lessonTypeId = uuid(90);
    expect((await call(`/admin/lesson-types/${uuid(90)}`, 'DELETE')).status).toBe(409);
    expect(remove).not.toHaveBeenCalled();
  });
  it('requires a valid selected type for new and existing lessons and exposes configuration to teachers', async () => {
    expect((await (await call('/learning')).json()).lessonTypes).toEqual(seed.lessonTypes);
    for (const lessonTypeId of [undefined, null, '', uuid(99)]) {
      expect((await call('/lessons', 'POST', { ...draft, lessonTypeId })).status).toBe(400);
      expect((await call(`/lessons/${uuid(6)}`, 'PUT', { ...draft, lessonTypeId })).status).toBe(400);
    }
    expect(save).not.toHaveBeenCalled();
    const response = await call('/lessons', 'POST', draft);
    expect(response.status).toBe(200);
    expect((await response.json()).lessonTypeId).toBe(uuid(90));
  });
  it('preserves untyped legacy lessons until an edit selects a type', async () => {
    expect(state.lessons[0].lessonTypeId).toBeUndefined();
    const response = await call(`/lessons/${uuid(6)}`, 'PUT', {
      ...draft, slotIds: [uuid(3)], schedule: { ...draft.schedule, startDate: '2026-10-26' },
    });
    expect(response.status).toBe(200);
    expect(state.lessons[0].lessonTypeId).toBe(uuid(90));
  });
  it('allows type-only changes without changing occurrences or Teams meetings', async () => {
    const created = await (await call('/lessons', 'POST', draft)).json();
    const type = { id: uuid(91), name: 'Workshop', colour: '#00AAFF', icon: null };
    state.lessonTypes?.push(type);
    state.meetings = [{ lessonId: created.id, occurrenceId: created.occurrences[0].id, organizerUserId: 10, state: 'created', joinUrl: 'https://teams.microsoft.com/test' }];
    const response = await call(`/lessons/${created.id}`, 'PUT', { ...draft, lessonTypeId: type.id });
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.lessonTypeId).toBe(type.id);
    expect(updated.occurrences).toEqual(created.occurrences);
    expect(state.meetings).toHaveLength(1);
    expect((await call('/lessons', 'POST', { ...draft, id: created.id })).status).toBe(409);
  });
  it('saves files and links to a newly created hexadecimal lesson ID and accepts mixed-case URLs on retry', async () => {
    const lessonId = 'abcdef01-abcd-4abc-8def-abcdef012345';
    const fileId = 'abcdef02-abcd-4abc-8def-abcdef012345';
    const linkId = 'abcdef03-abcd-4abc-8def-abcdef012345';
    const response = await call('/lessons', 'POST', { ...draft, id: lessonId.toUpperCase() });
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(lessonId);
    const form = () => {
      const body = new FormData(); body.append('file', new Blob(['PDF']), 'Worksheet.pdf');
      body.append('resourceId', fileId.toUpperCase()); return body;
    };
    expect((await call(`/lessons/${lessonId.toUpperCase()}/files`, 'POST', form())).status).toBe(200);
    expect((await call(`/lessons/${lessonId}/files`, 'POST', form())).status).toBe(200);
    expect(putFile).toHaveBeenCalledOnce();
    const link = { id: linkId.toUpperCase(), kind: 'link', name: 'Reading', url: 'https://school.test/' };
    expect((await call(`/lessons/${lessonId.toUpperCase()}/links`, 'POST', link)).status).toBe(200);
    expect((await call(`/lessons/${lessonId}/links/${linkId.toUpperCase()}`, 'PUT', { ...link, name: 'New reading' })).status).toBe(200);
    expect(state.lessons.find((item) => item.id === lessonId)).toMatchObject({
      files: [{ id: fileId, name: 'Worksheet.pdf' }], links: [{ id: linkId, name: 'New reading' }],
    });
    expect((await call(`/lessons/${lessonId.toUpperCase()}/files/${fileId.toUpperCase()}`)).status).toBe(200);
    expect(readFileContent).toHaveBeenCalledWith(fileId);
  });
  it('uses a stable client lesson ID to reconcile a lost creation response without new occurrences', async () => {
    const body = { ...draft, id: uuid(83) };
    const first = await call('/lessons', 'POST', body);
    expect(first.status).toBe(200);
    const created = await first.json();
    const retry = await call('/lessons', 'POST', body);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: body.id, occurrences: created.occurrences });
    expect(state.lessons.filter((lesson) => lesson.id === body.id)).toHaveLength(1);
    expect((await call('/lessons', 'POST', { ...body, name: 'Different lesson' })).status).toBe(409);
  });
  it('allows saving links with live invitations but forbids changing lesson details or rescheduling', async () => {
    const response = await call('/lessons', 'POST', draft);
    const created = await response.json();
    const occurrenceId = created.occurrences[0].id;
    state.meetings = [{ occurrenceId, lessonId: created.id, organizerUserId: 10, state: 'created',
      title: 'Maths workshop', joinUrl: 'https://teams.microsoft.com/test', optionsApplied: false }];
    const linksOnly = { ...draft, links: [resourceLink] };
    const updated = await call(`/lessons/${created.id}`, 'PUT', linksOnly);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ occurrences: created.occurrences, links: [resourceLink] });
    expect(state.meetings[0].occurrenceId).toBe(occurrenceId);
    expect((await call(`/lessons/${created.id}`, 'PUT', { ...linksOnly, name: 'Changed workshop' })).status).toBe(409);
    expect((await call(`/lessons/${created.id}`, 'PUT', { ...linksOnly, schedule: { ...draft.schedule, count: 2, frequency: 'weekly' } })).status).toBe(409);
  });
  it('preserves cancelled occurrence IDs on a resource-only save, instead of creating replacement invitations', async () => {
    const response = await call('/lessons', 'POST', draft);
    const created = await response.json();
    state.meetings = [{ occurrenceId: created.occurrences[0].id, lessonId: created.id, organizerUserId: 10, state: 'cancelled', joinUrl: null }];
    const result = await call(`/lessons/${created.id}`, 'PUT', { ...draft, links: [resourceLink] });
    expect(result.status).toBe(200);
    expect((await result.json()).occurrences).toEqual(created.occurrences);
  });
  it('retries a stable file upload ID without duplicate resources or overwriting another lesson blob', async () => {
    const form = () => {
      const body = new FormData();
      body.append('file', new Blob(['PDF']), 'Worksheet.pdf'); body.append('resourceId', uuid(84)); return body;
    };
    const path = `/lessons/${uuid(6)}/files`;
    const first = await call(path, 'POST', form());
    expect(first.status).toBe(200);
    expect((await first.json()).id).toBe(uuid(84));
    expect((await call(path, 'POST', form())).status).toBe(200);
    expect(state.lessons[0].files.filter((file) => file.id === uuid(84))).toHaveLength(1);
    expect(putFile).toHaveBeenCalledOnce();
    state.lessons.push({ ...state.lessons[0], id: uuid(85), files: [] });
    expect((await call(`/lessons/${uuid(85)}/files`, 'POST', form())).status).toBe(409);
    expect(putFile).toHaveBeenCalledOnce();
    expect(deleteFile).not.toHaveBeenCalled();
  });
  it('does not delete a committed blob when an upload commit response is lost', async () => {
    const original = vi.mocked(save).getMockImplementation()!;
    vi.mocked(save).mockImplementationOnce(async (...args) => { await original(...args); throw new Error('Commit response lost'); });
    const body = new FormData(); body.append('file', new Blob(['PDF']), 'Worksheet.pdf'); body.append('resourceId', uuid(86));
    expect((await call(`/lessons/${uuid(6)}/files`, 'POST', body)).status).toBe(500);
    expect(state.lessons[0].files.some((file) => file.id === uuid(86))).toBe(true);
    expect(deleteFile).not.toHaveBeenCalled();
    expect((await call(`/lessons/${uuid(6)}/files`, 'POST', body)).status).toBe(200);
    expect(putFile).toHaveBeenCalledOnce();
  });
  it('adds, edits and removes named links without changing a live lesson schedule or its meetings', async () => {
    state.lessons[0].schedule = { startDate: '2026-10-26', frequency: 'once', count: 1 };
    state.lessons[0].occurrences = [{ id: uuid(81), date: '2026-10-26', slotId: uuid(3) }];
    state.meetings = [{ occurrenceId: uuid(81), lessonId: uuid(6), organizerUserId: 10, state: 'created',
      joinUrl: 'https://teams.microsoft.com/test', title: 'Maths live', optionsApplied: true }];
    const before = structuredClone(state);
    expect((await call(`/lessons/${uuid(6)}/links`, 'POST', resourceLink)).status).toBe(200);
    expect((await call(`/lessons/${uuid(6)}/links`, 'POST', resourceLink)).status).toBe(200);
    expect(state.lessons[0].links).toEqual([resourceLink]);
    const edited = { ...resourceLink, name: 'Updated reading', url: 'https://school.test/new-reading' };
    expect((await call(`/lessons/${uuid(6)}/links/${resourceLink.id}`, 'PUT', edited)).status).toBe(200);
    expect(state.lessons[0].links).toEqual([edited]);
    expect((await call(`/lessons/${uuid(6)}/links/${resourceLink.id}`, 'DELETE')).status).toBe(200);
    expect(state.lessons[0]).toMatchObject({ ...before.lessons[0], links: [], updatedAt: expect.any(String) });
    expect(state.meetings).toEqual(before.meetings);
    expect(state.lessons[0].files).toEqual(before.lessons[0].files);
  });
  it('enforces resource-link authorization for students, parents and unassigned teachers', async () => {
    state.lessons[0].links = [resourceLink];
    for (const actor of [user(20, ['Student']), user(30, ['Parent'], [person(20).email]), user(11, ['Staff'])]) {
      current = actor;
      expect((await call(`/lessons/${uuid(6)}/links`, 'POST', resourceLink)).status).toBe(403);
      expect((await call(`/lessons/${uuid(6)}/links/${resourceLink.id}`, 'PUT', resourceLink)).status).toBe(403);
      expect((await call(`/lessons/${uuid(6)}/links/${resourceLink.id}`, 'DELETE')).status).toBe(403);
    }
    expect(state.lessons[0].links).toEqual([resourceLink]);
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects invalid URLs, mismatched IDs, missing links and duplicate-ID conflicts', async () => {
    const endpoint = `/lessons/${uuid(6)}/links`;
    for (const url of ['http://school.test', 'javascript:alert(1)', 'https://user:password@school.test/'])
      expect((await call(endpoint, 'POST', { ...resourceLink, url })).status).toBe(400);
    expect((await call(`${endpoint}/${uuid(82)}`, 'PUT', resourceLink)).status).toBe(400);
    expect((await call(`${endpoint}/${resourceLink.id}`, 'PUT', resourceLink)).status).toBe(404);
    expect((await call(`${endpoint}/${resourceLink.id}`, 'DELETE')).status).toBe(404);
    expect((await call(endpoint, 'POST', resourceLink)).status).toBe(200);
    expect((await call(endpoint, 'POST', { ...resourceLink, name: 'Different' })).status).toBe(409);
  });
  it('enforces the resource limit on additions but permits edits at the limit', async () => {
    state.lessons[0].links = Array.from({ length: 30 }, (_, index) => ({ ...resourceLink, id: uuid(100 + index) }));
    expect((await call(`/lessons/${uuid(6)}/links`, 'POST', resourceLink)).status).toBe(400);
    const edit = { ...state.lessons[0].links[0], name: 'Updated at limit' };
    expect((await call(`/lessons/${uuid(6)}/links/${edit.id}`, 'PUT', edit)).status).toBe(200);
    expect(state.lessons[0].links[0].name).toBe(edit.name);
  });
  it('withholds the join URL while settings are unconfirmed, without hiding teacher recovery status', async () => {
    state.meetings = [{ occurrenceId: uuid(81), lessonId: uuid(6), organizerUserId: 10, state: 'created',
      joinUrl: 'https://teams.microsoft.com/test', title: 'Maths live', optionsApplied: false }];
    for (const actor of [user(10, ['Staff']), user(20, ['Student'])]) {
      current = actor;
      const response = await call('/learning');
      expect(response.status).toBe(200);
      expect((await response.json()).meetings[0]).toMatchObject({ joinUrl: null, optionsApplied: false, title: 'Maths live' });
    }
  });
  it('serves standalone liveness without SQL, storage, platform or authentication calls', async () => {
    vi.clearAllMocks();
    const response = await call('/live', 'GET', undefined, false);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    for (const fn of [pool, checkStorage, publicConfig, getUser, platform]) expect(fn).not.toHaveBeenCalled();
  });
  it('gates dependent APIs and deep health until initialized, but keeps liveness available', async () => {
    const readiness = { ready: false };
    const waiting = createApp(readiness).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => waiting.once('listening', resolve));
    const address = waiting.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    const base = `http://127.0.0.1:${address.port}`;
    vi.clearAllMocks();
    try {
      for (const path of ['/api/health', '/api/learning', '/api/config', '/api/auth/start']) {
        const response = await fetch(base + path);
        expect(response.status).toBe(503);
        expect(response.headers.get('retry-after')).toBe('10');
      }
      const post = await fetch(base + '/api/admin/classes', { method: 'POST' });
      expect(post.status).toBe(503);
      expect((await fetch(base + '/api/live')).status).toBe(200);
      for (const fn of [pool, checkStorage, publicConfig, getUser, platform, save]) expect(fn).not.toHaveBeenCalled();
      readiness.ready = true;
      expect((await fetch(base + '/api/me', { headers: { Cookie: cookie } })).status).toBe(200);
    } finally { await new Promise<void>((resolve) => waiting.close(() => resolve())); }
  });
  it('retains the deep health dependency checks after initialization', async () => {
    const query = vi.fn().mockResolvedValue({});
    vi.mocked(pool).mockResolvedValueOnce({ request: () => ({ query }) } as unknown as Awaited<ReturnType<typeof pool>>);
    const response = await call('/health', 'GET', undefined, false);
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith('SELECT 1 AS ok');
    expect(checkStorage).toHaveBeenCalledOnce();
    expect(publicConfig).toHaveBeenCalledOnce();
  });
  it('keeps valid sessions through SQL and central outages, without retrying writes', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    config.SQL_SERVERLESS_ENABLED = true;
    await new Promise<void>((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    url = `http://127.0.0.1:${address.port}`;
    vi.mocked(snapshot).mockRejectedValueOnce({ originalError: { info: { number: 40613 } } });
    const sql = await call('/learning');
    expect(sql.status).toBe(503);
    expect(sql.headers.get('retry-after')).toBe('10');
    expect(sql.headers.get('set-cookie')).toBeNull();
    vi.mocked(getUser).mockRejectedValueOnce(new HttpError(503, 'Central Portal is waking.'));
    const central = await call('/me');
    expect(central.status).toBe(503);
    expect(central.headers.get('retry-after')).toBe('10');
    expect(central.headers.get('set-cookie')).toBeNull();
    expect((await call('/me')).status).toBe(200);
    vi.mocked(save).mockRejectedValueOnce({ code: 'ESOCKET' });
    const write = await call('/lessons', 'POST', draft);
    expect(write.status).toBe(503);
    expect(save).toHaveBeenCalledOnce();
  });
  it('preserves normal SQL runtime errors without serverless opt-in', async () => {
    vi.mocked(snapshot).mockRejectedValueOnce({ number: 40613 });
    const response = await call('/learning');
    expect(response.status).toBe(500);
    expect(response.headers.get('retry-after')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  const manual = {
    name: 'Science', yearGroup: '7', division: 'Secondary',
    teachers: [{ displayName: 'Science Teacher', email: 'user10@school.test' }],
    students: [{ displayName: 'Pending Student', email: 'pending@school.test' }],
  };
  it.each(['Learn Admin', 'Full Admin'])('validates and creates a manual class with pending students as %s', async (role) => {
    current = user(10, ['Staff', role]);
    const preview = await call('/admin/classes/validate', 'POST', manual);
    expect(preview.status).toBe(200);
    const details = await preview.json();
    expect(details.errors).toEqual([]);
    expect(details.warnings[0].message).toContain('pending@school.test');
    expect(save).not.toHaveBeenCalled();
    const response = await call('/admin/classes', 'POST', manual);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.classroom).toMatchObject({ name: 'Science', teachers: [{ ...person(10), displayName: 'Science Teacher' }], students: manual.students });
    expect(state.classes).toHaveLength(3);
    expect(state.lessons).toEqual(seed.lessons);
    current = { ...user(99, ['Student']), email: 'pending@school.test' };
    expect((await (await call('/learning')).json()).classes.map((c: { name: string }) => c.name)).toEqual(['Science']);
  });
  it.each(['Staff', 'Student', 'Parent'])('denies manual class changes to %s', async (role) => {
    current = user(10, [role]);
    for (const [path, method] of [['/admin/classes', 'POST'], [`/admin/classes/${uuid(1)}`, 'PUT'], ['/admin/classes/validate', 'POST']]) {
      expect((await call(path, method, manual)).status).toBe(403);
    }
    expect(save).not.toHaveBeenCalled();
  });
  it('updates all class details while retaining the class ID, lessons and files', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    vi.mocked(findUsers).mockImplementation(async (emails) => [user(11, ['Staff']), user(22, ['Student'])].filter((u) => emails.includes(u.email)));
    const input = {
      name: 'Renamed Maths', yearGroup: '9', division: 'Primary',
      teachers: [{ displayName: 'New Teacher', email: ' USER11@school.test ' }],
      students: [{ displayName: 'New Student', email: 'USER22@school.test' }],
    };
    const response = await call(`/admin/classes/${uuid(1)}`, 'PUT', input);
    expect(response.status).toBe(200);
    expect(state.classes.find((c) => c.id === uuid(1))).toMatchObject({
      name: 'Renamed Maths', yearGroup: '9', division: 'Primary',
      teachers: [{ id: 11, email: 'user11@school.test', displayName: 'New Teacher' }],
      students: [{ email: 'user22@school.test', displayName: 'New Student' }],
    });
    expect(state.lessons).toEqual(seed.lessons);
    current = user(10, ['Staff']);
    expect((await (await call('/learning')).json()).classes).toEqual([]);
    current = user(11, ['Staff']);
    expect((await (await call('/learning')).json()).lessons).toEqual(seed.lessons);
  });
  it('rejects duplicate class identity and unknown edit IDs without overwriting classes', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    const duplicate = { ...manual, name: ' MATHS ', yearGroup: '7', division: 'secondary' };
    expect((await call('/admin/classes', 'POST', duplicate)).status).toBe(409);
    expect((await call(`/admin/classes/${uuid(2)}`, 'PUT', duplicate)).status).toBe(409);
    expect((await call(`/admin/classes/${uuid(99)}`, 'PUT', manual)).status).toBe(404);
    expect(save).not.toHaveBeenCalled();
    expect(state.classes).toEqual(seed.classes);
  });
  it('revalidates staff and student accounts on save, rejecting invalid or duplicate rosters', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    expect((await call('/admin/classes/validate', 'POST', manual)).status).toBe(200);
    vi.mocked(findUsers).mockResolvedValue([{ ...user(10, ['Staff']), isActive: false }]);
    expect((await call('/admin/classes', 'POST', manual)).status).toBe(400);
    vi.mocked(findUsers).mockResolvedValue([user(10, ['Staff']), { ...user(20, ['Parent']), email: 'pending@school.test' }]);
    expect((await call('/admin/classes', 'POST', manual)).status).toBe(400);
    expect((await call('/admin/classes', 'POST', { ...manual, students: [] })).status).toBe(400);
    expect((await call('/admin/classes', 'POST', { ...manual, teachers: [...manual.teachers, ...manual.teachers] })).status).toBe(400);
    expect((await call('/admin/classes', 'POST', { ...manual, students: [...manual.students, { ...manual.students[0], email: 'PENDING@school.test' }] })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it.each(['teacher', 'student'])('rejects roster edits that cause a shared %s timetable clash', async (shared) => {
    current = user(10, ['Staff', 'Learn Admin']);
    state.lessons.push({ ...seed.lessons[0], id: uuid(90), classId: uuid(2) });
    vi.mocked(findUsers).mockImplementation(async (emails) => [user(10, ['Staff']), user(11, ['Staff']), user(22, ['Student'])].filter((u) => emails.includes(u.email)));
    const input = { ...manual, teachers: [person(shared === 'teacher' ? 11 : 10)], students: shared === 'student' ? [person(22)] : manual.students };
    const response = await call(`/admin/classes/${uuid(1)}`, 'PUT', input);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Timetable clash') });
    expect(save).not.toHaveBeenCalled();
    expect(state.classes).toEqual(seed.classes);
  });
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
  it('denies Parent-only users even with linked children', async () => {
    current = user(99, ['Parent'], [person(20).email]);
    expect((await call('/learning')).status).toBe(403);
    current.studentEmails = [];
    expect((await call('/learning')).status).toBe(403);
  });
  it('creates dated lessons, preserving resources when converting a legacy lesson', async () => {
    const response = await call('/lessons', 'POST', { ...draft, slotIds: [uuid(4)] });
    expect(response.status).toBe(200);
    expect((await response.json()).slotIds).toEqual([uuid(4)]);
    const edit = await call(`/lessons/${uuid(6)}`, 'PUT', { ...draft, slotIds: [uuid(3)], schedule: { ...draft.schedule, startDate: '2026-10-26' } });
    expect(edit.status).toBe(200);
    expect((await edit.json()).files).toEqual(seed.lessons[0].files);
  });
  it('previews term-limited repeats with actual dates and no writes', async () => {
    const response = await call('/lessons/preview', 'POST', { ...draft, schedule: { startDate: '2026-12-08', frequency: 'weekly', count: 5 } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ actualEnd: '2026-12-08', termEnd: '2026-12-11', truncated: true });
    expect(save).not.toHaveBeenCalled();
  });
  it('protects the calendar and blocks edits that would silently change dated lessons', async () => {
    expect((await call('/admin/calendar', 'PUT', seed.calendar)).status).toBe(403);
    await call('/lessons', 'POST', draft);
    current = user(10, ['Staff', 'Learn Admin']);
    expect((await call('/admin/calendar', 'PUT', seed.calendar)).status).toBe(200);
    const calendar = { ...seed.calendar, holidays: [{ id: uuid(72), yearId: uuid(70), name: 'Closure', start: '2026-10-27', end: '2026-10-27' }] };
    expect((await call('/admin/calendar', 'PUT', calendar)).status).toBe(409);
  });
  it('requires explicit development configuration and confirmation for clearing lessons', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    expect((await call('/admin/schedules/reset', 'POST', { confirmation: 'CLEAR DEVELOPMENT LESSONS' })).status).toBe(403);
    config.ALLOW_SCHEDULE_RESET = true;
    expect((await call('/admin/schedules/reset', 'POST', { confirmation: 'yes' })).status).toBe(400);
    expect(state.lessons).toHaveLength(1);
    expect((await call('/admin/schedules/reset', 'POST', { confirmation: 'CLEAR DEVELOPMENT LESSONS' })).status).toBe(200);
    expect(state.lessons).toHaveLength(0);
    expect(state.classes).toHaveLength(2);
    expect(state.slots).toEqual(seed.slots);
  });
  it('blocks year and term day exclusions, naming all affected lessons and dates without changing meetings', async () => {
    const first = await (await call('/lessons', 'POST', draft)).json();
    const second = await (await call('/lessons', 'POST', { ...draft, name: 'Following week', schedule: { ...draft.schedule, startDate: '2026-11-03' } })).json();
    state.meetings = [{ occurrenceId: first.occurrences[0].id, lessonId: first.id, organizerUserId: 10, state: 'created', joinUrl: 'https://teams.microsoft.com/test' }];
    const original = structuredClone(state);
    current = user(10, ['Staff', 'Learn Admin']);
    const week = { days: [0, 2, 3, 4], startsOn: 0 };
    for (const calendar of [
      { ...seed.calendar, years: seed.calendar!.years.map((year) => ({ ...year, week })) },
      { ...seed.calendar, terms: seed.calendar!.terms.map((term) => ({ ...term, week })) },
    ]) {
      const response = await call('/admin/calendar', 'PUT', calendar);
      expect(response.status).toBe(409);
      const { error } = await response.json();
      expect(error).toContain('"New lesson" (Maths)');
      expect(error).toContain('"Following week" (Maths)');
      expect(error).toContain('27/10/2026');
      expect(error).toContain('03/11/2026');
      expect(error).toContain('cancel their Teams meetings');
    }
    expect(second.occurrences).toHaveLength(1);
    expect(saveCalendar).not.toHaveBeenCalled();
    expect(state).toEqual(original);
  });
  it('blocks removing a later occurrence in a daily series even when its start remains eligible', async () => {
    state.lessons = [];
    for (const day of [2, 3, 4]) state.slots.push({ ...state.slots[0], id: uuid(100 + day), day });
    expect((await call('/lessons', 'POST', { ...draft, schedule: { ...draft.schedule, frequency: 'daily', count: 8 } })).status).toBe(200);
    current = user(10, ['Staff', 'Learn Admin']);
    const calendar = { ...seed.calendar, terms: seed.calendar!.terms.map((term) => ({ ...term, week: { days: [1, 2, 3, 4], startsOn: 0 } })) };
    const response = await call('/admin/calendar', 'PUT', calendar);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('02/11/2026');
    expect(saveCalendar).not.toHaveBeenCalled();
  });
  it('saves year defaults and multiple term overrides with admin authorization and strict day validation', async () => {
    const calendar = { ...seed.calendar, years: seed.calendar!.years.map((year) => ({ ...year, week: SUNDAY_TEACHING_WEEK })),
      terms: [...seed.calendar!.terms, { id: uuid(73), yearId: uuid(70), name: 'Term 2', start: '2027-01-03', end: '2027-03-26', week: DEFAULT_TEACHING_WEEK },
        { id: uuid(74), yearId: uuid(70), name: 'Term 3', start: '2027-04-04', end: '2027-06-25', week: DEFAULT_TEACHING_WEEK }] };
    expect((await call('/admin/calendar', 'PUT', calendar)).status).toBe(403);
    current = user(10, ['Staff', 'Learn Admin']);
    const response = await call('/admin/calendar', 'PUT', calendar);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(calendar);
    expect(state.calendar).toEqual(calendar);
    expect((await call('/admin/calendar', 'PUT', { ...calendar, years: [{ ...calendar.years[0], week: { days: [], startsOn: 0 } }] })).status).toBe(400);
    expect(saveCalendar).toHaveBeenCalledOnce();
  });
  it('previews and saves Sunday lessons on a configured teaching week, rejecting excluded Friday dates', async () => {
    state.calendar = { ...seed.calendar!, years: seed.calendar!.years.map((year) => ({ ...year, week: SUNDAY_TEACHING_WEEK })) };
    state.slots.push({ ...state.slots[0], id: uuid(75), day: 6 }, { ...state.slots[0], id: uuid(76), day: 4 });
    const sunday = { ...draft, slotIds: [uuid(75)], schedule: { startDate: '2026-10-25', frequency: 'weekly', count: 2 } };
    const preview = await call('/lessons/preview', 'POST', sunday);
    expect(preview.status).toBe(200);
    expect((await preview.json()).occurrences.map((item: { date: string }) => item.date)).toEqual(['2026-10-25', '2026-11-01']);
    expect((await call('/lessons', 'POST', sunday)).status).toBe(200);
    const friday = { ...draft, slotIds: [uuid(76)], schedule: { startDate: '2026-10-30', frequency: 'once', count: 1 } };
    expect((await call('/lessons/preview', 'POST', friday)).status).toBe(400);
    expect((await call('/lessons', 'POST', friday)).status).toBe(400);
    expect(save).toHaveBeenCalledOnce();
  });
  it('requires cancelling live meetings before deleting lessons or changing class rosters', async () => {
    state.meetings = [{ occurrenceId: uuid(90), lessonId: uuid(6), organizerUserId: 10, state: 'pending', joinUrl: null }];
    expect((await call(`/lessons/${uuid(6)}`, 'DELETE')).status).toBe(409);
    expect((await call(`/lessons/${uuid(6)}`, 'PUT', draft)).status).toBe(409);
    current = user(10, ['Staff', 'Learn Admin']);
    expect((await call(`/admin/classes/${uuid(1)}`, 'PUT', {
      name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [person(10)], students: [{ email: 'new@school.test', displayName: 'New' }],
    })).status).toBe(409);
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
    expect((await call('/lessons', 'POST', { ...draft, slotIds: [uuid(5)] })).status).toBe(400);
    expect((await call('/lessons', 'POST', { ...draft, slotIds: [uuid(3)], schedule: { ...draft.schedule, startDate: '2026-10-26' } })).status).toBe(409);
    expect((await call('/lessons', 'POST', { ...draft, slotIds: [uuid(4), uuid(4)] })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it('prevents reassignment of lessons to a different class even for admins', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    expect((await call(`/lessons/${uuid(6)}`, 'PUT', { ...draft, classId: uuid(2) })).status).toBe(400);
  });
  it('protects day structure and validates referenced periods', async () => {
    expect((await call('/admin/structure', 'PUT', [])).status).toBe(403);
    current = user(10, ['Staff', 'Learn Admin']);
    expect((await call('/admin/structure', 'PUT', [])).status).toBe(409);
    expect((await call('/admin/structure', 'PUT', seed.slots.map((s) => s.id === uuid(3) ? { ...s, kind: 'break' } : s))).status).toBe(409);
    expect((await call('/admin/structure', 'PUT', seed.slots)).status).toBe(200);
  });
  it.each(['Learn Admin', 'Full Admin'])('persists custom types and multi-day periods for %s and exposes them in timetables', async (role) => {
    current = user(10, ['Staff', role]);
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
    current = user(10, ['Staff', 'Learn Admin']);
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
  it.each([
    { field: 'name', value: 'Renamed' }, { field: 'start', value: '08:05' },
    { field: 'end', value: '08:55' }, { field: 'day', value: 2 },
  ])('locks the $field of a period already used by a lesson', async ({ field, value }) => {
    current = user(10, ['Staff', 'Learn Admin']);
    const slots = seed.slots.map((slot) => slot.id === uuid(3) ? { ...slot, [field]: value } : slot);
    const response = await call('/admin/structure', 'PUT', { slots, periodTypes: DEFAULT_PERIOD_TYPES });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('cannot be edited or deleted') });
    expect(saveStructure).not.toHaveBeenCalled();
  });
  it('locks the type of used periods even when both types are schedulable', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    const custom = { id: uuid(30), name: 'Registration', kind: 'lesson' };
    const slots = seed.slots.map((slot) => slot.id === uuid(3) ? { ...slot, typeId: custom.id } : slot);
    expect((await call('/admin/structure', 'PUT', { slots, periodTypes: [...DEFAULT_PERIOD_TYPES, custom] })).status).toBe(409);
    expect(saveStructure).not.toHaveBeenCalled();
  });
  it('saves pending period edits and new multi-day periods together, keeping used periods unchanged', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    const slots = [
      ...seed.slots.filter((slot) => slot.id !== uuid(5)).map((slot) => slot.id === uuid(4) ? { ...slot, name: 'Edited period' } : slot),
      ...[0, 1, 2, 3, 4].map((day) => ({ id: uuid(80 + day), day, name: 'New period', kind: 'lesson', start: '10:00', end: '11:00' })),
    ];
    const response = await call('/admin/structure', 'PUT', { slots, periodTypes: DEFAULT_PERIOD_TYPES });
    expect(response.status).toBe(200);
    expect(state.slots).toEqual(slots);
    expect(state.lessons).toEqual(seed.lessons);
  });
  it('saves types immediately without changing the saved periods and enforces admin access', async () => {
    const type = { id: uuid(30), name: 'Registration', kind: 'lesson' };
    const types = [...DEFAULT_PERIOD_TYPES, type];
    expect((await call('/admin/period-types', 'PUT', types)).status).toBe(403);
    expect(saveStructure).not.toHaveBeenCalled();
    current = user(10, ['Staff', 'Learn Admin']);
    expect((await call('/admin/period-types', 'PUT', types)).status).toBe(200);
    expect(state.periodTypes).toEqual(types);
    expect(state.slots).toEqual(seed.slots);
    expect((await (await call('/learning')).json()).periodTypes).toEqual(types);
    expect((await call('/admin/period-types', 'PUT', [...types, { ...type, id: uuid(31) }])).status).toBe(400);
    expect(state.periodTypes).toEqual(types);
  });
  it('edits unused types but refuses editing types used by lessons or deleting types in use', async () => {
    current = user(10, ['Full Admin']);
    expect((await call('/admin/period-types', 'PUT', [DEFAULT_PERIOD_TYPES[0]])).status).toBe(409);
    const renamed = DEFAULT_PERIOD_TYPES.map((type) => type.id === 'lesson' ? { ...type, name: 'Renamed' } : type);
    expect((await call('/admin/period-types', 'PUT', renamed)).status).toBe(409);
    const editedBreak = DEFAULT_PERIOD_TYPES.map((type) => type.id === 'break' ? { ...type, name: 'Lunch' } : type);
    expect((await call('/admin/period-types', 'PUT', editedBreak)).status).toBe(200);
    expect(state.periodTypes).toEqual(editedBreak);
    expect(state.lessons).toEqual(seed.lessons);
  });
  it('previews supported images inline but retains downloads and membership checks', async () => {
    const path = `/lessons/${uuid(6)}/files/${uuid(7)}`;
    for (const [name, type] of [['Photo.PNG', 'image/png'], ['Photo.jpg', 'image/jpeg'], ['Photo.jpeg', 'image/jpeg'], ['Photo.gif', 'image/gif'], ['Photo.webp', 'image/webp']]) {
      state.lessons[0].files[0].name = name;
      const preview = await call(`${path}?preview=1`);
      expect(preview.status).toBe(200);
      expect(preview.headers.get('content-type')).toContain(type);
      expect(preview.headers.get('content-disposition')).toBe('inline');
    }
    expect((await call(path)).headers.get('content-disposition')).toContain('attachment;');
    state.lessons[0].files[0].name = 'Worksheet.pdf';
    expect((await call(`${path}?preview=1`)).headers.get('content-disposition')).toContain('attachment;');
    current = user(22, ['Student']);
    vi.mocked(readFileContent).mockClear();
    expect((await call(`${path}?preview=1`)).status).toBe(404);
    expect(readFileContent).not.toHaveBeenCalled();
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
    current = user(10, ['Staff', 'Learn Admin']);
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
    current = user(10, ['Staff', 'Learn Admin']);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') + '\nMaths,Teacher,missing@school.test,Student,user20@school.test,7,Secondary']), 'classes.csv');
    const preview = await call('/admin/classes/preview', 'POST', data);
    expect((await preview.json()).errors[0].row).toBe(2);
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it('imports pending students, denies Parent-only access and honours eligible student emails', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') + '\nMaths,Teacher,user10@school.test,Pending Student,pending@school.test,7,Secondary']), 'classes.csv');
    const preview = await (await call('/admin/classes/preview', 'POST', data)).json();
    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toEqual([{ row: 2, message: expect.stringContaining('pending@school.test') }]);
    expect(save).not.toHaveBeenCalled();
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(200);
    const child = { email: 'pending@school.test', displayName: 'Pending Student' };
    expect(state.classes.find((c) => c.id === uuid(1))?.students).toEqual([child]);
    current = user(99, ['Parent'], [child.email]);
    expect((await call('/learning')).status).toBe(403);
    current.studentEmails = [];
    expect((await call('/learning')).status).toBe(403);
    current = { ...user(1234, ['Student']), email: child.email };
    const studentData = await (await call('/learning')).json();
    expect(studentData.classes[0].students).toEqual([child]);
    expect(studentData.lessons).toEqual(seed.lessons);
    expect((await call(`/lessons/${uuid(6)}/files/${uuid(7)}`)).status).toBe(200);
    current.roles = [];
    expect((await call('/learning')).status).toBe(403);
    expect((await call(`/lessons/${uuid(6)}/files/${uuid(7)}`)).status).toBe(403);
  });
  it('rejects membership changes that cause shared-email timetable clashes before saving', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
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
    current = user(10, ['Staff', 'Learn Admin']);
    const before = structuredClone(state);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') +
      '\nMaths,Teacher,user10@school.test,Pending Student,pending@school.test,7,Secondary' +
      '\nEnglish,Teacher,missing@school.test,Another Student,another@school.test,8,Secondary']), 'classes.csv');
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });
  it('checks current directory permissions again after a successful preview', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
    const data = new FormData(); data.append('file', new Blob([CSV_HEADERS.join(',') + '\nMaths,Teacher,user10@school.test,Student,pending@school.test,7,Secondary']), 'classes.csv');
    expect((await (await call('/admin/classes/preview', 'POST', data)).json()).errors).toEqual([]);
    vi.mocked(findUsers).mockResolvedValue([]);
    expect((await call('/admin/classes/import', 'POST', data)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it('imports included class rosters, retaining existing class IDs and other classes', async () => {
    current = user(10, ['Staff', 'Learn Admin']);
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
