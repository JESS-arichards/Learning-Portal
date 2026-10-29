import express, { Router } from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { z } from 'zod';
import { config } from './config.js';
import { HttpError, createErrorHandler, logger } from './errors.js';
import { requireUser, requireAdmin, signOut } from './auth.js';
import { publicConfig, findUsers, navigationFor, platformImage } from './platform.js';
import { createSsoRouter } from './sso.js';
import { transaction, pool } from './db.js';
import { snapshot, save, saveStructure, saveLessonType, remove } from './repository.js';
import { previewClasses, previewManualClass, CSV_HEADERS } from './importClasses.js';
import { visibleSnapshot, childrenFor } from './access.js';
import { putFile, readFileContent, deleteFile, checkStorage } from './storage.js';
import { prepareResource } from './optimizeImage.js';
import { canManage, classKey, classInputSchema, lessonInputSchema, lessonTypeInputSchema, linkSchema, dayStructureSchema, periodTypesSchema, periodTypeId, validateStructureChange, validateSchedule, type Lesson, type Snapshot } from '../shared/learning.js';
import { EMPTY_CALENDAR, previewSchedule } from '../shared/calendar.js';
import { createCalendarRouter } from './calendarRoutes.js';
import { createTeamsRouter } from './teams.js';
import { createLiveLessonRouter } from './liveLessons.js';
import { uuidSchema } from '../shared/identifiers.js';

const idSchema = uuidSchema;
function id(value: unknown) { return idSchema.parse(value); }
function editable(user: NonNullable<express.Request['user']>, data: Snapshot, classId: string) {
  const classroom = data.classes.find((c) => c.id === classId);
  if (!classroom) throw new HttpError(404, 'Class not found.');
  if (!canManage(user, classroom)) throw new HttpError(403, 'You can manage only your assigned classes.');
  return classroom;
}
function lessonById(data: Snapshot, lessonId: string) {
  const lesson = data.lessons.find((l) => l.id === lessonId);
  if (!lesson) throw new HttpError(404, 'Lesson not found.');
  return lesson;
}
function checkSchedule(...args: Parameters<typeof validateSchedule>) {
  try { validateSchedule(...args); }
  catch (error) { if (error instanceof Error) throw new HttpError(409, error.message); throw error; }
}
function checkStructureChange(...args: Parameters<typeof validateStructureChange>) {
  try { validateStructureChange(...args); }
  catch (error) { if (error instanceof Error) throw new HttpError(409, error.message); throw error; }
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 1, fieldSize: 36 } });
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 } });

export function createApp(readiness: { ready: boolean } = { ready: true }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      'connect-src': ["'self'"],
      'frame-src': ["'none'"],
      'frame-ancestors': ["'self'", ...(config.TEAMS_ENABLED ? [
        'https://teams.microsoft.com', 'https://*.teams.microsoft.com', 'https://*.cloud.microsoft',
      ] : [])],
      'img-src': ["'self'", new URL(config.APPLICATIONS_PORTAL_URL).origin, 'data:', ...(config.TEAMS_ENABLED ? ['blob:'] : [])],
      'upgrade-insecure-requests': config.production ? [] : null,
    } },
    strictTransportSecurity: config.production,
    frameguard: config.TEAMS_ENABLED ? false : { action: 'sameorigin' },
    crossOriginOpenerPolicy: { policy: config.TEAMS_ENABLED ? 'same-origin-allow-popups' : 'same-origin' },
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '300kb' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/live', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', (_req, _res, next) => {
    if (!readiness.ready) throw new HttpError(503, 'Learning Portal is initializing. Please try again shortly.');
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'learning-portal') {
      throw new HttpError(403, 'Invalid request origin.');
    }
    next();
  });
  app.get('/api/config', async (_req, res) => res.json(await publicConfig()));
  app.get('/api/branding/assets/:asset', async (req, res) => {
    const asset = z.enum(['logo', 'icon', 'background', 'footerLogo']).parse(req.params.asset);
    const image = await platformImage(`/learning/assets/${asset}`);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.type(image.contentType).send(image.data);
  });
  app.get('/api/health', async (_req, res) => {
    await (await pool()).request().query('SELECT 1 AS ok');
    await publicConfig();
    await checkStorage();
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', createSsoRouter());
  app.use('/api/teams', createTeamsRouter());
  app.post(['/api/auth/entra', '/api/auth/otp/request', '/api/auth/otp/verify'], (_req, _res) => {
    throw new HttpError(410, 'Sign-in is managed by Applications Portal. Open Learning Portal to be redirected.');
  });
  app.post('/api/auth/logout', (_req, res) => signOut(res));
  const api = Router();
  api.use(requireUser);
  api.get('/me', (req, res) => res.json(req.user));
  api.get('/navigation', async (req, res) => res.json(await navigationFor(req.user!.id)));
  api.get('/me/avatar', async (req, res) => {
    const image = await platformImage(`/learning/users/${req.user!.id}/avatar`);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.type(image.contentType).send(image.data);
  });
  api.get('/learning', async (req, res) => {
    const all = await snapshot();
    res.json({ ...visibleSnapshot(req.user!, all), children: childrenFor(req.user!, all), allowScheduleReset: config.ALLOW_SCHEDULE_RESET });
  });
  api.use(createCalendarRouter());
  api.use(createLiveLessonRouter());
  api.get('/admin/template.csv', requireAdmin, (_req, res) => {
    res.type('text/csv').attachment('learning-classes-template.csv').send(CSV_HEADERS.join(',') + '\r\n');
  });
  api.post('/admin/classes/preview', requireAdmin, csvUpload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a CSV file.');
    const data = await snapshot();
    res.json(await previewClasses(req.file.buffer.toString('utf8'), data.classes, findUsers));
  });
  api.post('/admin/classes/validate', requireAdmin, async (req, res) => {
    res.json(await previewManualClass(classInputSchema.parse(req.body), findUsers));
  });
  async function writeClass(req: express.Request, res: express.Response) {
    const input = classInputSchema.parse(req.body);
    const classId = req.params.id ? id(req.params.id) : randomUUID();
    const preview = await previewManualClass(input, findUsers);
    if (preview.errors.length) throw new HttpError(400, preview.errors.map((error) => error.message).join(' '));
    const classroom = preview.classes[0];
    if (!classroom) throw new HttpError(400, 'Enter at least one valid teacher and student.');
    const saved = { ...classroom, id: classId };
    await transaction(async (tx) => {
      const current = await snapshot(tx);
      if (current.meetings?.some((meeting) => meeting.state !== 'cancelled' && current.lessons.some((l) => l.id === meeting.lessonId && l.classId === classId)))
        throw new HttpError(409, 'Cancel live meetings for this class before changing its roster.');
      if (req.params.id && !current.classes.some((item) => item.id === classId)) throw new HttpError(404, 'Class not found.');
      if (current.classes.some((item) => item.id !== classId && classKey(item) === classKey(saved)))
        throw new HttpError(409, 'A class with this name, year group and division already exists. Edit that class instead.');
      const classes = [...current.classes.filter((item) => item.id !== classId), saved];
      for (const lesson of current.lessons) checkSchedule(lesson, current.lessons, classes, current.slots, lesson.id);
      await save(tx, 'class', classId, saved);
    });
    logger.info({ actorId: req.user!.id, classId, teachers: saved.teachers.length, students: saved.students.length }, 'Learning class saved manually');
    res.status(req.params.id ? 200 : 201).json({ classroom: saved, warnings: preview.warnings });
  }
  api.post('/admin/classes', requireAdmin, writeClass);
  api.put('/admin/classes/:id', requireAdmin, writeClass);
  api.post('/admin/classes/import', requireAdmin, csvUpload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a CSV file.');
    // Resolve live directory matches before taking the database lock.
    const preview = await previewClasses(req.file.buffer.toString('utf8'), (await snapshot()).classes, findUsers);
    if (preview.errors.length) throw new HttpError(400, `Import rejected. ${preview.errors.length} row(s) require correction; preview the CSV for details.`);
    await transaction(async (tx) => {
      const current = await snapshot(tx);
      const incoming = preview.classes.map((c) => ({ ...c, id: current.classes.find((old) => classKey(old) === classKey(c))?.id ?? c.id }));
      if (current.meetings?.some((meeting) => meeting.state !== 'cancelled'
        && current.lessons.some((l) => l.id === meeting.lessonId && incoming.some((c) => c.id === l.classId))))
        throw new HttpError(409, 'Cancel live meetings for the imported classes before replacing their rosters.');
      const classes = [...current.classes.filter((c) => !incoming.some((n) => n.id === c.id)), ...incoming];
      for (const lesson of current.lessons) checkSchedule(lesson, current.lessons, classes, current.slots, lesson.id);
      for (const classroom of incoming) await save(tx, 'class', classroom.id, classroom);
    });
    logger.info({ actorId: req.user!.id, classes: preview.classes.length, rows: preview.rowCount }, 'Learning class import committed');
    res.json({ classes: preview.classes.length, rows: preview.rowCount });
  });
  api.delete('/admin/classes/:id', requireAdmin, async (req, res) => {
    const classId = id(req.params.id);
    await transaction(async (tx) => {
      const data = await snapshot(tx);
      editable(req.user!, data, classId);
      if (data.lessons.some((l) => l.classId === classId)) throw new HttpError(409, 'Delete this class\'s lessons before deleting the class.');
      await remove(tx, 'class', classId);
    });
    logger.info({ actorId: req.user!.id, classId }, 'Learning class deleted');
    res.json({ ok: true });
  });
  api.put('/admin/structure', requireAdmin, async (req, res) => {
    const structure = await transaction(async (tx) => {
      const data = await snapshot(tx);
      const next = dayStructureSchema.parse(Array.isArray(req.body) ? { slots: req.body, periodTypes: data.periodTypes } : req.body);
      checkStructureChange(data, next);
      for (const lesson of data.lessons) checkSchedule(lesson, data.lessons, data.classes, next.slots, lesson.id);
      await saveStructure(tx, next);
      return next;
    });
    logger.info({ actorId: req.user!.id, periods: structure.slots.length, types: structure.periodTypes.length }, 'Learning week structure updated');
    res.json(Array.isArray(req.body) ? structure.slots : structure);
  });
  api.put('/admin/period-types', requireAdmin, async (req, res) => {
    const periodTypes = periodTypesSchema.parse(req.body);
    const structure = await transaction(async (tx) => {
      const current = await snapshot(tx);
      const slots = current.slots.map((slot) => {
        const type = periodTypes.find((type) => type.id === periodTypeId(slot));
        if (!type) throw new HttpError(409, 'Types used by periods cannot be removed. Reassign or remove those periods first.');
        return { ...slot, kind: type.kind };
      });
      const next = dayStructureSchema.parse({ slots, periodTypes });
      checkStructureChange(current, next);
      for (const lesson of current.lessons) checkSchedule(lesson, current.lessons, current.classes, next.slots, lesson.id);
      await saveStructure(tx, next);
      return next;
    });
    logger.info({ actorId: req.user!.id, types: periodTypes.length }, 'Learning period types updated');
    res.json(structure);
  });
  async function writeLessonType(req: express.Request, res: express.Response) {
    const input = lessonTypeInputSchema.parse(req.body);
    const typeId = req.params.id ? id(req.params.id) : randomUUID();
    const result = { ...input, id: typeId };
    await transaction(async (tx) => {
      const data = await snapshot(tx);
      if (req.params.id && !data.lessonTypes?.some((type) => type.id === typeId))
        throw new HttpError(404, 'Lesson type not found.');
      if (data.lessonTypes?.some((type) => type.id !== typeId && type.name.toLowerCase() === input.name.toLowerCase()))
        throw new HttpError(409, 'A lesson type with this name already exists.');
      await saveLessonType(tx, result);
    });
    logger.info({ actorId: req.user!.id, typeId }, 'Learning lesson type saved');
    res.json(result);
  }
  api.post('/admin/lesson-types', requireAdmin, writeLessonType);
  api.put('/admin/lesson-types/:id', requireAdmin, writeLessonType);
  api.delete('/admin/lesson-types/:id', requireAdmin, async (req, res) => {
    const typeId = id(req.params.id);
    await transaction(async (tx) => {
      const data = await snapshot(tx);
      if (!data.lessonTypes?.some((type) => type.id === typeId)) throw new HttpError(404, 'Lesson type not found.');
      if (data.lessons.some((lesson) => lesson.lessonTypeId === typeId))
        throw new HttpError(409, 'This lesson type is in use. Change the lessons to another type before deleting it.');
      await remove(tx, 'lessonType', typeId);
    });
    logger.info({ actorId: req.user!.id, typeId }, 'Learning lesson type deleted');
    res.json({ ok: true });
  });
  async function writeLesson(req: express.Request, res: express.Response) {
    const parsed = req.params.id ? { ...lessonInputSchema.parse(req.body), id: undefined }
      : lessonInputSchema.extend({ id: idSchema.optional() }).parse(req.body);
    const { id: creationId, ...input } = parsed;
    const lessonId = req.params.id ? id(req.params.id) : creationId ?? randomUUID();
    const lesson = await transaction(async (tx) => {
      const data = await snapshot(tx);
      editable(req.user!, data, input.classId);
      if (!data.lessonTypes?.some((type) => type.id === input.lessonTypeId))
        throw new HttpError(400, 'Choose an existing lesson type. Ask a Learning administrator to configure lesson types if none are available.');
      const previous = req.params.id ? lessonById(data, lessonId) : data.lessons.find((item) => item.id === lessonId);
      if (previous) {
        editable(req.user!, data, previous.classId);
        if (previous.classId !== input.classId) throw new HttpError(400, 'A lesson cannot be moved to a different class.');
      }
      const sameDetails = previous && previous.name === input.name && previous.description === input.description
        && JSON.stringify(previous.slotIds) === JSON.stringify(input.slotIds) && JSON.stringify(previous.schedule) === JSON.stringify(input.schedule);
      if (!req.params.id && previous && (!sameDetails || previous.lessonTypeId !== input.lessonTypeId || JSON.stringify(previous.links) !== JSON.stringify(input.links)))
        throw new HttpError(409, 'This lesson creation ID is already in use with different details. Reload before continuing.');
      if (!sameDetails && data.meetings?.some((meeting) => meeting.lessonId === lessonId && meeting.state !== 'cancelled'))
        throw new HttpError(409, "Cancel this lesson's live meetings before editing it. Meeting invitations must not become out of sync.");
      if (!input.schedule) throw new HttpError(400, 'Choose a date and recurrence for this lesson.');
      if (sameDetails && previous) {
        const result = { ...previous, lessonTypeId: input.lessonTypeId, links: input.links, updatedAt: new Date().toISOString() };
        await save(tx, 'lesson', lessonId, result);
        return result;
      }
      let preview;
      try { preview = previewSchedule(data.calendar ?? EMPTY_CALENDAR, data.slots, input.slotIds, input.schedule); }
      catch (error) { if (error instanceof Error) throw new HttpError(400, error.message); throw error; }
      const occurrences = preview.occurrences.map((item) => ({ ...item, id: previous?.occurrences?.find((old) => old.date === item.date && old.slotId === item.slotId
        && !data.meetings?.some((meeting) => meeting.occurrenceId === old.id && meeting.state === 'cancelled'))?.id ?? randomUUID() }));
      const result: Lesson = { ...input, occurrences, id: lessonId, files: previous?.files ?? [], updatedAt: new Date().toISOString() };
      checkSchedule(result, data.lessons, data.classes, data.slots, lessonId);
      await save(tx, 'lesson', lessonId, result);
      return result;
    });
    logger.info({ actorId: req.user!.id, lessonId }, 'Learning lesson saved');
    res.json(lesson);
  }
  api.post('/lessons', writeLesson);
  api.put('/lessons/:id', writeLesson);
  const writeLink = async (req: express.Request, res: express.Response) => {
    const link = linkSchema.parse(req.body);
    const editing = req.method === 'PUT';
    if (editing && id(req.params.linkId) !== link.id) throw new HttpError(400, 'The resource ID must match the link being edited.');
    const lesson = await transaction(async (tx) => {
      const data = await snapshot(tx);
      const previous = lessonById(data, id(req.params.id));
      editable(req.user!, data, previous.classId);
      if (editing) {
        if (!previous.links.some((item) => item.id === link.id)) throw new HttpError(404, 'Link not found.');
      } else if (previous.links.some((item) => item.id === link.id)) {
        const existing = previous.links.find((item) => item.id === link.id);
        if (existing?.name !== link.name || existing.url !== link.url || existing.kind !== link.kind)
          throw new HttpError(409, 'This resource ID is already in use. Reload the lesson.');
        return previous;
      }
      if (!editing && previous.links.length >= 30) throw new HttpError(400, 'A lesson can have at most 30 links.');
      const result = { ...previous, links: editing ? previous.links.map((item) => item.id === link.id ? link : item) : [...previous.links, link], updatedAt: new Date().toISOString() };
      await save(tx, 'lesson', result.id, result);
      return result;
    });
    logger.info({ actorId: req.user!.id, lessonId: lesson.id, linkId: link.id }, 'Learning link saved');
    res.json(lesson);
  };
  api.post('/lessons/:id/links', writeLink);
  api.put('/lessons/:id/links/:linkId', writeLink);
  api.delete('/lessons/:id/links/:linkId', async (req, res) => {
    const linkId = id(req.params.linkId);
    const lesson = await transaction(async (tx) => {
      const data = await snapshot(tx);
      const previous = lessonById(data, id(req.params.id));
      editable(req.user!, data, previous.classId);
      if (!previous.links.some((item) => item.id === linkId)) throw new HttpError(404, 'Link not found.');
      const result = { ...previous, links: previous.links.filter((item) => item.id !== linkId), updatedAt: new Date().toISOString() };
      await save(tx, 'lesson', result.id, result);
      return result;
    });
    logger.info({ actorId: req.user!.id, lessonId: lesson.id, linkId }, 'Learning link removed');
    res.json(lesson);
  });
  api.delete('/lessons/:id', async (req, res) => {
    const lessonId = id(req.params.id);
    const files = await transaction(async (tx) => {
      const data = await snapshot(tx);
      const lesson = lessonById(data, lessonId);
      editable(req.user!, data, lesson.classId);
      if (data.meetings?.some((meeting) => meeting.lessonId === lessonId && meeting.state !== 'cancelled'))
        throw new HttpError(409, "Cancel this lesson's live meetings before deleting it.");
      await remove(tx, 'lesson', lessonId);
      return lesson.files;
    });
    await Promise.all(files.map((file) => deleteFile(file.id)));
    logger.info({ actorId: req.user!.id, lessonId }, 'Learning lesson deleted');
    res.json({ ok: true });
  });
  api.post('/lessons/:id/files', async (req, _res, next) => {
    const data = await snapshot();
    editable(req.user!, data, lessonById(data, id(req.params.id)).classId);
    next();
  }, upload.single('file'), async (req, res) => {
    const uploadInput = z.object({ resourceId: idSchema.optional() }).strict().parse(req.body);
    if (!req.file) throw new HttpError(400, 'Choose a resource file (maximum 25 MB).');
    const name = req.file.originalname.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200);
    if (!/\.(pdf|docx?|pptx?|xlsx?|txt|csv|png|jpe?g|gif|webp|mp3|mp4)$/i.test(name)) {
      throw new HttpError(400, 'Supported files: PDF, Office documents, text/CSV, images, MP3 and MP4.');
    }
    const resource = await prepareResource(name, req.file.buffer);
    const file = { id: uploadInput.resourceId ?? randomUUID(),
      kind: 'file' as const, name: resource.name, size: resource.data.length };
    let uploaded = false;
    try {
      await transaction(async (tx) => {
        const data = await snapshot(tx);
        const lesson = lessonById(data, id(req.params.id));
        editable(req.user!, data, lesson.classId);
        const existing = data.lessons.find((item) => item.files.some((resource) => resource.id === file.id));
        if (existing) {
          const previous = existing.files.find((resource) => resource.id === file.id)!;
          if (existing.id !== lesson.id || previous.name !== file.name || previous.size !== file.size)
            throw new HttpError(409, 'This upload ID is already in use. Remove the pending file and select it again.');
          return;
        }
        if (lesson.files.length >= 20) throw new HttpError(400, 'A lesson can have at most 20 files.');
        await putFile(file.id, resource.data, resource.contentType);
        uploaded = true;
        await save(tx, 'lesson', lesson.id, { ...lesson, files: [...lesson.files, file], updatedAt: new Date().toISOString() });
      });
    } catch (error) {
      if (uploaded) {
        try {
          const current = await snapshot();
          if (!current.lessons.some((lesson) => lesson.files.some((resource) => resource.id === file.id)))
            await deleteFile(file.id);
        } catch (cleanupError) { logger.error({ err: cleanupError, fileId: file.id }, 'Could not verify upload cleanup; retained blob for safe retry'); }
      }
      throw error;
    }
    logger.info({ actorId: req.user!.id, lessonId: req.params.id, fileId: file.id }, 'Learning resource uploaded');
    res.json(file);
  });
  api.get('/lessons/:id/files/:fileId', async (req, res) => {
    const data = visibleSnapshot(req.user!, await snapshot());
    const lesson = lessonById(data, id(req.params.id));
    const file = lesson.files.find((f) => f.id === id(req.params.fileId));
    if (!file) throw new HttpError(404, 'Resource not found.');
    const buffer = await readFileContent(file.id);
    const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
    const imageType = imageTypes[file.name.split('.').pop()!.toLowerCase()];
    if (req.query.preview === '1' && imageType) {
      res.setHeader('Content-Disposition', 'inline');
      res.type(imageType).send(buffer);
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="resource"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`);
    res.type('application/octet-stream').send(buffer);
  });
  api.delete('/lessons/:id/files/:fileId', async (req, res) => {
    const fileId = id(req.params.fileId);
    await transaction(async (tx) => {
      const data = await snapshot(tx);
      const lesson = lessonById(data, id(req.params.id));
      editable(req.user!, data, lesson.classId);
      if (!lesson.files.some((f) => f.id === fileId)) throw new HttpError(404, 'Resource not found.');
      await save(tx, 'lesson', lesson.id, { ...lesson, files: lesson.files.filter((f) => f.id !== fileId), updatedAt: new Date().toISOString() });
    });
    await deleteFile(fileId);
    logger.info({ actorId: req.user!.id, fileId }, 'Learning resource deleted');
    res.json({ ok: true });
  });
  app.use('/api', api);
  app.use('/api', (_req, _res) => { throw new HttpError(404, 'API route not found.'); });
  const client = path.resolve('dist', 'client');
  app.use(express.static(client, { index: false }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(client, 'index.html')));
  app.use(createErrorHandler(config.SQL_SERVERLESS_ENABLED));
  return app;
}
