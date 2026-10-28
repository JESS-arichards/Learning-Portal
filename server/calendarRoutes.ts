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
import { formatDate } from '../shared/dateFormatting.js';

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
      const conflicts: string[] = [];
      for (const lesson of current.lessons.filter((lesson) => lesson.schedule)) {
        const label = `"${lesson.name}" (${current.classes.find((item) => item.id === lesson.classId)?.name ?? lesson.classId})`;
        let next;
        try { next = previewSchedule(calendar, current.slots, lesson.slotIds, lesson.schedule!); }
        catch (error) {
          if (!(error instanceof Error)) throw error;
          conflicts.push(`${label}, starting ${formatDate(lesson.schedule!.startDate)}: ${error.message}`);
          continue;
        }
        const key = (value: { date: string; slotId: string }) => `${value.date}/${value.slotId}`;
        const existing = lesson.occurrences ?? [];
        if (JSON.stringify(next.occurrences.map(key).sort()) !== JSON.stringify(existing.map(key).sort())) {
          const changed = existing.find((item) => !next.occurrences.some((other) => key(item) === key(other)))
            ?? next.occurrences.find((item) => !existing.some((other) => key(item) === key(other)));
          conflicts.push(`${label}: scheduled dates would change${changed ? ` on ${formatDate(changed.date)}` : ''}.`);
        }
      }
      if (conflicts.length) throw new HttpError(409, `Calendar changes would affect existing lessons: ${conflicts.join(' ')} Reschedule or remove the affected lessons first; cancel their Teams meetings before doing so.`);
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
