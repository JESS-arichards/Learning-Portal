import { Router } from 'express';
import { z } from 'zod';
import { transaction, sql } from './db.js';
import { snapshot } from './repository.js';
import { HttpError, logger } from './errors.js';
import { createTeamsEvent, cancelTeamsEvent, teamsStatus, validateTeamsEventInput } from './teams.js';
import type { User, Snapshot } from '../shared/learning.js';

function assigned(user: User, data: Snapshot, lessonId: string, occurrenceId: string) {
  const lesson = data.lessons.find((item) => item.id === lessonId);
  const classroom = data.classes.find((item) => item.id === lesson?.classId);
  if (!lesson || !classroom) throw new HttpError(404, 'Lesson not found.');
  if (!user.roles.includes('Staff') || !classroom.teachers.some((teacher) => teacher.id === user.id))
    throw new HttpError(403, 'Only an assigned, signed-in teacher can organise this meeting.');
  const occurrence = lesson.occurrences?.find((item) => item.id === occurrenceId);
  if (!occurrence) throw new HttpError(404, 'Dated lesson occurrence not found.');
  const slot = data.slots.find((item) => item.id === occurrence.slotId);
  if (!slot) throw new HttpError(409, 'The scheduled period no longer exists.');
  return { lesson, classroom, occurrence, slot };
}
function meetingInput(user: User, { lesson, classroom, occurrence, slot }: ReturnType<typeof assigned>) {
  return validateTeamsEventInput(user, {
    transactionId: occurrence.id, subject: lesson.name, description: `${classroom.name}\n\n${lesson.description}`,
    date: occurrence.date, start: slot.start, end: slot.end, attendees: classroom.students,
  });
}
export function createLiveLessonRouter() {
  const router = Router();
  router.post('/lessons/:id/occurrences/:occurrenceId/teams', async (req, res) => {
    const lessonId = z.string().uuid().parse(req.params.id);
    const occurrenceId = z.string().uuid().parse(req.params.occurrenceId);
    const status = await teamsStatus(req.user!);
    if (!status.configured || !status.connected) throw new HttpError(409, 'Connect your Microsoft calendar before creating live meetings.');
    await transaction(async (tx) => {
      const data = await snapshot(tx);
      meetingInput(req.user!, assigned(req.user!, data, lessonId, occurrenceId));
      const meeting = data.meetings?.find((item) => item.occurrenceId === occurrenceId);
      if (meeting && meeting.organizerUserId !== req.user!.id)
        throw new HttpError(403, 'Only the original teacher can manage this meeting.');
      if (meeting?.state === 'cancelled') throw new HttpError(409, "This occurrence's meeting was cancelled. Reschedule the lesson to create a new occurrence.");
      if (!meeting) await tx.request().input('id', sql.UniqueIdentifier, occurrenceId).input('user', sql.Int, req.user!.id)
        .query("INSERT dbo.LearningLiveMeetings(OccurrenceId,OrganizerUserId,State) VALUES(@id,@user,'pending')");
    });
    const meeting = await transaction(async (tx) => {
      const data = await snapshot(tx);
      const context = assigned(req.user!, data, lessonId, occurrenceId);
      const existing = data.meetings?.find((item) => item.occurrenceId === occurrenceId);
      if (existing?.state === 'created') return existing;
      if (!existing || existing.state !== 'pending' || existing.organizerUserId !== req.user!.id)
        throw new HttpError(409, 'Meeting state changed. Reload this lesson.');
      const created = await createTeamsEvent(req.user!, meetingInput(req.user!, context));
      await tx.request().input('id', sql.UniqueIdentifier, occurrenceId)
        .input('eventId', sql.NVarChar(2048), created.eventId).input('url', sql.NVarChar(2000), created.joinUrl)
        .query("UPDATE dbo.LearningLiveMeetings SET State='created',EventId=@eventId,JoinUrl=@url,UpdatedAt=SYSUTCDATETIME() WHERE OccurrenceId=@id");
      return { ...existing, state: 'created' as const, joinUrl: created.joinUrl };
    });
    logger.info({ actorId: req.user!.id, occurrenceId }, 'Live lesson meeting created');
    res.json(meeting);
  });
  router.post('/lessons/:id/occurrences/:occurrenceId/teams/cancel', async (req, res) => {
    const lessonId = z.string().uuid().parse(req.params.id);
    const occurrenceId = z.string().uuid().parse(req.params.occurrenceId);
    await transaction(async (tx) => {
      const data = await snapshot(tx);
      assigned(req.user!, data, lessonId, occurrenceId);
      const existing = data.meetings?.find((item) => item.occurrenceId === occurrenceId);
      if (!existing) throw new HttpError(404, 'Meeting not found.');
      if (existing.organizerUserId !== req.user!.id) throw new HttpError(403, 'Only the original teacher can cancel this meeting.');
      if (existing.state === 'cancelled') return;
      if (existing.state === 'pending') throw new HttpError(409, 'Resolve the pending creation using Retry before cancelling. An invitation may already have been sent.');
      const result = await tx.request().input('id', sql.UniqueIdentifier, occurrenceId)
        .query<{ eventId: string }>('SELECT EventId AS eventId FROM dbo.LearningLiveMeetings WHERE OccurrenceId=@id');
      await cancelTeamsEvent(req.user!, z.string().min(1).parse(result.recordset[0]?.eventId));
      await tx.request().input('id', sql.UniqueIdentifier, occurrenceId)
        .query("UPDATE dbo.LearningLiveMeetings SET State='cancelled',JoinUrl=NULL,UpdatedAt=SYSUTCDATETIME() WHERE OccurrenceId=@id");
    });
    logger.info({ actorId: req.user!.id, occurrenceId }, 'Live lesson meeting cancelled');
    res.json({ ok: true });
  });
  return router;
}
