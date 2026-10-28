import express from 'express';
import type { Server } from 'node:http';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Snapshot, User } from '../shared/learning.js';
import { DEFAULT_PERIOD_TYPES } from '../shared/learning.js';
import { HttpError, createErrorHandler } from './errors.js';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), create: vi.fn(), cancel: vi.fn(), status: vi.fn(), validate: vi.fn(), query: vi.fn(), options: vi.fn() }));
vi.mock('./repository.js', () => ({ snapshot: mocks.snapshot }));
vi.mock('./teams.js', () => ({ createTeamsEvent: mocks.create, cancelTeamsEvent: mocks.cancel, teamsStatus: mocks.status, validateTeamsEventInput: mocks.validate, applyTeamsMeetingOptions: mocks.options }));
vi.mock('./db.js', async () => ({
  sql: (await import('mssql')).default,
  transaction: async (work: (tx: object) => Promise<unknown>) => {
    const parameters = new Map<string, unknown>();
    const request = {
      input(name: string, _type: unknown, value: unknown) { parameters.set(name, value); return request; },
      query: (query: string) => mocks.query(query, parameters),
    };
    return work({ request: () => request });
  },
}));
import { createLiveLessonRouter } from './liveLessons.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let data: Snapshot;
let actor: User;
let server: Server;
let origin: string;
const path = `/lessons/${uuid(1)}/occurrences/${uuid(3)}/teams`;
beforeEach(async () => {
  vi.clearAllMocks();
  actor = { id: 10, email: 'teacher@school.test', displayName: 'Teacher', roles: ['Staff'], studentEmails: [], isActive: true, sessionVersion: 0 };
  data = {
    classes: [{ id: uuid(4), name: 'Maths', yearGroup: '7', division: 'Secondary', teachers: [actor], students: [{ email: 'student@school.test', displayName: 'Student' }] }],
    periodTypes: DEFAULT_PERIOD_TYPES,
    slots: [{ id: uuid(2), name: 'P1', day: 0, kind: 'lesson', start: '08:00', end: '09:00' }],
    lessons: [{ id: uuid(1), classId: uuid(4), name: 'Fractions', description: 'Learn fractions', slotIds: [uuid(2)], links: [], files: [], updatedAt: '',
      schedule: { startDate: '2026-10-26', frequency: 'once', count: 1 }, occurrences: [{ id: uuid(3), date: '2026-10-26', slotId: uuid(2) }] }],
    meetings: [],
  };
  mocks.snapshot.mockImplementation(async () => structuredClone(data));
  mocks.status.mockResolvedValue({ configured: true, connected: true });
  mocks.validate.mockImplementation((_user, input) => input);
  mocks.create.mockResolvedValue({ eventId: 'event-one', joinUrl: 'https://teams.microsoft.com/l/meetup-join/test' });
  mocks.cancel.mockResolvedValue({ status: 'cancelled' });
  mocks.options.mockReset().mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (query: string, parameters: Map<string, unknown>) => {
    if (query.startsWith('INSERT')) data.meetings!.push({ occurrenceId: uuid(3), lessonId: uuid(1), organizerUserId: actor.id, state: 'pending', joinUrl: null,
      title: String(parameters.get('title')), options: parameters.get('options') ? JSON.parse(String(parameters.get('options'))) : null, optionsApplied: Boolean(parameters.get('applied')) });
    if (query.includes("SET State='created'")) Object.assign(data.meetings![0], { state: 'created', joinUrl: parameters.get('url') });
    if (query.includes("SET State='cancelled'")) Object.assign(data.meetings![0], { state: 'cancelled', joinUrl: null });
    if (query.includes('SET OptionsApplied=1')) Object.assign(data.meetings![0], { optionsApplied: true });
    return { recordset: [{ eventId: 'event-one' }] };
  });
  const app = express();
  app.use(express.json(), (req, _res, next) => { req.user = actor; next(); });
  app.use(createLiveLessonRouter());
  app.use(createErrorHandler());
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server missing');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
async function post(suffix = '', body?: unknown) { return fetch(origin + path + suffix, { method: 'POST',
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); }
it('creates an event from the server roster and durable occurrence ID, then avoids duplicates', async () => {
  expect((await post()).status).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith(actor, expect.objectContaining({ transactionId: uuid(3), date: '2026-10-26', attendees: data.classes[0].students, start: '08:00' }));
  expect((await post()).status).toBe(200);
  expect(mocks.create).toHaveBeenCalledOnce();
});
it('keeps pending state after ambiguous Graph failure and retries with the same transaction ID', async () => {
  mocks.create.mockRejectedValueOnce(new HttpError(504, 'Retry with the same transaction ID.'));
  expect((await post()).status).toBe(504);
  expect(data.meetings![0].state).toBe('pending');
  expect((await post()).status).toBe(200);
  expect(mocks.create.mock.calls.map((call) => call[1].transactionId)).toEqual([uuid(3), uuid(3)]);
});
it('does not reserve a pending meeting before Microsoft application access is configured', async () => {
  mocks.status.mockResolvedValue({ configured: false, connected: false });
  expect((await post()).status).toBe(409);
  expect(data.meetings).toEqual([]);
});
it('does not reserve pending state for locally invalid invitation details', async () => {
  mocks.validate.mockImplementationOnce(() => { throw new HttpError(400, 'Split this class: more than 500 attendees.'); });
  expect((await post()).status).toBe(400);
  expect(data.meetings).toEqual([]);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('does not allow admin impersonation, students, or unassigned staff to organise', async () => {
  for (const roles of [['Full Admin'], ['Student'], ['Staff']]) {
    actor = { ...actor, id: 99, roles };
    expect((await post()).status).toBe(403);
  }
  expect(mocks.create).not.toHaveBeenCalled();
});
it('rejects unknown occurrences and invalid IDs without a Graph write', async () => {
  data.lessons[0].occurrences = [];
  expect((await post()).status).toBe(404);
  expect((await fetch(origin + '/lessons/bad/occurrences/bad/teams', { method: 'POST' })).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('only lets the original organiser cancel and makes cancellation idempotent', async () => {
  await post();
  data.classes[0].teachers.push({ id: 11, email: 'other@school.test', displayName: 'Other' });
  actor = { ...actor, id: 11 };
  expect((await post('/cancel')).status).toBe(403);
  actor = { ...actor, id: 10 };
  expect((await post('/cancel')).status).toBe(200);
  expect((await post('/cancel')).status).toBe(200);
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(data.meetings![0].joinUrl).toBeNull();
});
it('requires resolving ambiguous pending creation before cancellation', async () => {
  mocks.create.mockRejectedValueOnce(new HttpError(504, 'Ambiguous creation'));
  await post();
  expect((await post('/cancel')).status).toBe(409);
  expect(mocks.cancel).not.toHaveBeenCalled();
});
it('leaves meeting state unchanged when Microsoft rejects cancellation', async () => {
  await post();
  mocks.cancel.mockRejectedValueOnce(new HttpError(503, 'Graph unavailable'));
  expect((await post('/cancel')).status).toBe(503);
  expect(data.meetings![0].state).toBe('created');
});
const request = { title: 'Fractions live workshop', options: { allowBreakoutRooms: true } };
it('persists the requested title and options, using the meeting name for the calendar event', async () => {
  const response = await post('', request);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ title: request.title, options: request.options, optionsApplied: true });
  expect(mocks.create).toHaveBeenCalledWith(actor, expect.objectContaining({ subject: request.title }));
  expect(mocks.options).toHaveBeenCalledWith(actor, 'https://teams.microsoft.com/l/meetup-join/test', request.options);
  expect((await post('', request)).status).toBe(200);
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.options).toHaveBeenCalledOnce();
});
it('persists a created event before settings fail and retries settings without another invitation', async () => {
  mocks.options.mockRejectedValueOnce(new HttpError(503, 'Meeting options unavailable'));
  expect((await post('', request)).status).toBe(503);
  expect(data.meetings![0]).toMatchObject({ state: 'created', optionsApplied: false, title: request.title });
  expect((await post('', request)).status).toBe(200);
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.options).toHaveBeenCalledTimes(2);
  expect(data.meetings![0].optionsApplied).toBe(true);
});
it('allows cancelling the known calendar event when settings failed', async () => {
  mocks.options.mockRejectedValueOnce(new HttpError(503, 'Meeting options unavailable'));
  await post('', request);
  expect((await post('/cancel')).status).toBe(200);
  expect(mocks.cancel).toHaveBeenCalledOnce();
});
it('rejects changed retry parameters for both pending and created meetings', async () => {
  mocks.create.mockRejectedValueOnce(new HttpError(504, 'Ambiguous creation'));
  expect((await post('', request)).status).toBe(504);
  expect((await post('', { ...request, title: 'Changed name' })).status).toBe(409);
  expect((await post('', request)).status).toBe(200);
  expect((await post('', { ...request, options: { allowBreakoutRooms: false } })).status).toBe(409);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});
it('validates names and options before reserving or sending invitations', async () => {
  for (const body of [{ ...request, title: '  ' }, { title: 'Title', options: { allowBreakoutRooms: 'yes' } }, { ...request, extra: true }])
    expect((await post('', body)).status).toBe(400);
  expect(data.meetings).toEqual([]);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('requires application meeting-options access before sending invitations', async () => {
  mocks.status.mockResolvedValue({ configured: true, connected: true, meetingOptionsReady: false });
  expect((await post('', request)).status).toBe(409);
  expect(data.meetings).toEqual([]);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('surfaces the central verified-identity failure before reserving pending state', async () => {
  mocks.status.mockResolvedValue({ configured: true, connected: false, meetingOptionsReady: false, error: 'Teacher has no verified school Microsoft identity.' });
  const response = await post('', request);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: 'Teacher has no verified school Microsoft identity.' });
  expect(data.meetings).toEqual([]);
  expect(mocks.create).not.toHaveBeenCalled();
});
