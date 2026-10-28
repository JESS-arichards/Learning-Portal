import { Router } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { requireAdmin } from './auth.js';
import { transaction } from './db.js';
import { snapshot, saveCalendar, remove } from './repository.js';
import { HttpError, logger } from './errors.js';
import { deleteFile } from './storage.js';
import { academicCalendarSchema, EMPTY_CALENDAR, previewSchedule } from '../shared/calendar.js';
import { canManage, lessonInputSchema } from '../shared/learning.js';

export function createCalendarRouter() {
  const router = Router();
  router.post('/lessons/preview', async (req, res) => {
    const input = lessonInputSchema.parse(req.body);
    if (!input.schedule) throw new HttpError(400, 'Choose a dated lesson schedule.');
    const data = await snapshot();
    const classroom = data.classes.find((item) => item.id === input.classId);
    if (!classroom || !canManage(req.user!, classroom)) throw new HttpError(403, 'Choose an assigned class.');
    try { res.json(previewSchedule(data.calendar ?? EMPTY_CALENDAR, data.slots, input.slotIds, input.schedule)); }
    catch (error) { if (error instanceof Error) throw new HttpError(400, error.message); throw error; }
  });
  router.put('/admin/calendar', requireAdmin, async (req, res) => {
    const calendar = academicCalendarSchema.parse(req.body);
    await transaction(async (tx) => {
      const current = await snapshot(tx);
      for (const lesson of current.lessons.filter((lesson) => lesson.schedule)) {
        let next;
        try { next = previewSchedule(calendar, current.slots, lesson.slotIds, lesson.schedule!); }
        catch (error) { if (error instanceof Error) throw new HttpError(409, `Calendar would invalidate "${lesson.name}": ${error.message}`); throw error; }
        const key = (value: { date: string; slotId: string }) => `${value.date}/${value.slotId}`;
        if (JSON.stringify(next.occurrences.map(key).sort()) !== JSON.stringify((lesson.occurrences ?? []).map(key).sort()))
          throw new HttpError(409, `Calendar changes would alter "${lesson.name}". Reschedule or remove that lesson first (cancel its Teams meetings before doing so).`);
      }
      await saveCalendar(tx, calendar);
    });
    logger.info({ actorId: req.user!.id }, 'Academic calendar saved');
    res.json(calendar);
  });
  router.post('/admin/schedules/reset', requireAdmin, async (req, res) => {
    if (!config.ALLOW_SCHEDULE_RESET) throw new HttpError(403, 'Schedule reset is disabled. Enable ALLOW_SCHEDULE_RESET only on the development web app.');
    z.object({ confirmation: z.literal('CLEAR DEVELOPMENT LESSONS') }).strict().parse(req.body);
    const files = await transaction(async (tx) => {
      const data = await snapshot(tx);
      if (data.meetings?.some((meeting) => meeting.state !== 'cancelled'))
        throw new HttpError(409, 'Cancel all Teams meetings before clearing schedules.');
      for (const lesson of data.lessons) await remove(tx, 'lesson', lesson.id);
      return data.lessons.flatMap((lesson) => lesson.files);
    });
    await Promise.all(files.map((file) => deleteFile(file.id)));
    logger.warn({ actorId: req.user!.id }, 'Development lesson schedules and resources explicitly cleared');
    res.json({ ok: true });
  });
  return router;
}
