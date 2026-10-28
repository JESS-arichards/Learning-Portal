import { Router } from 'express';
import { z } from 'zod';
import { transaction, sql } from './db.js';
import { snapshot } from './repository.js';
import { HttpError, logger } from './errors.js';
import { createTeamsEvent, cancelTeamsEvent, teamsStatus, validateTeamsEventInput, applyTeamsMeetingOptions } from './teams.js';
import { meetingRequestSchema, type User, type Snapshot, type MeetingRequest } from '../shared/learning.js';

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
function meetingInput(user: User, { lesson, classroom, occurrence, slot }: ReturnType<typeof assigned>, title = lesson.name) {
  return validateTeamsEventInput(user, {
    transactionId: occurrence.id, subject: title, description: `${classroom.name}\n\n${lesson.description}`,
    date: occurrence.date, start: slot.start, end: slot.end, attendees: classroom.students,
  });
}
export function createLiveLessonRouter() {
  const router = Router();
  router.post('/lessons/:id/occurrences/:occurrenceId/teams', async (req, res) => {
    const lessonId = z.string().uuid().parse(req.params.id);
    const occurrenceId = z.string().uuid().parse(req.params.occurrenceId);
    const requested: MeetingRequest | undefined = req.body === undefined ? undefined : meetingRequestSchema.parse(req.body);
    const status = await teamsStatus(req.user!);
    if (!status.configured || !status.connected) throw new HttpError(409, 'Connect your Microsoft calendar before creating live meetings.');
    if (requested && status.meetingOptionsReady === false)
      throw new HttpError(409, 'Reconnect your Microsoft calendar after an administrator grants delegated OnlineMeetings.ReadWrite permission.');
    await transaction(async (tx) => {
      const data = await snapshot(tx);
      const context = assigned(req.user!, data, lessonId, occurrenceId);
      const meeting = data.meetings?.find((item) => item.occurrenceId === occurrenceId);
      if (meeting && meeting.organizerUserId !== req.user!.id)
        throw new HttpError(403, 'Only the original teacher can manage this meeting.');
      if (meeting?.state === 'cancelled') throw new HttpError(409, "This occurrence's meeting was cancelled. Reschedule the lesson to create a new occurrence.");
      if (meeting && requested && (requested.title !== meeting.title || requested.options.allowBreakoutRooms !== meeting.options?.allowBreakoutRooms))
        throw new HttpError(409, 'Retry with the original meeting name and options. Cancel and reschedule to change an existing meeting.');
      const title = meeting?.title ?? requested?.title ?? context.lesson.name;
      meetingInput(req.user!, context, title);
      if (!meeting) await tx.request().input('id', sql.UniqueIdentifier, occurrenceId).input('user', sql.Int, req.user!.id)
        .input('title', sql.NVarChar(200), title).input('options', sql.NVarChar(sql.MAX), requested ? JSON.stringify(requested.options) : null)
        .input('applied', sql.Bit, !requested)
        .query("INSERT dbo.LearningLiveMeetings(OccurrenceId,OrganizerUserId,State,Title,Options,OptionsApplied) VALUES(@id,@user,'pending',@title,@options,@applied)");
    });
    await transaction(async (tx) => {
      const data = await snapshot(tx);
      const context = assigned(req.user!, data, lessonId, occurrenceId);
      const existing = data.meetings?.find((item) => item.occurrenceId === occurrenceId);
      if (existing?.state === 'created' && existing.organizerUserId === req.user!.id) return;
      if (!existing || existing.state !== 'pending' || existing.organizerUserId !== req.user!.id)
        throw new HttpError(409, 'Meeting state changed. Reload this lesson.');
      const created = await createTeamsEvent(req.user!, meetingInput(req.user!, context, existing.title ?? context.lesson.name));
      await tx.request().input('id', sql.UniqueIdentifier, occurrenceId)
        .input('eventId', sql.NVarChar(2048), created.eventId).input('url', sql.NVarChar(2000), created.joinUrl)
        .query("UPDATE dbo.LearningLiveMeetings SET State='created',EventId=@eventId,JoinUrl=@url,UpdatedAt=SYSUTCDATETIME() WHERE OccurrenceId=@id");
    });
    // Persist the calendar event before applying settings: a failed PATCH must not resend invitations.
    const meeting = await transaction(async (tx) => {
      const data = await snapshot(tx);
      assigned(req.user!, data, lessonId, occurrenceId);
      const existing = data.meetings?.find((item) => item.occurrenceId === occurrenceId);
      if (!existing || existing.state !== 'created' || existing.organizerUserId !== req.user!.id)
        throw new HttpError(409, 'Meeting state changed. Reload this lesson.');
      if (existing.options && !existing.optionsApplied) {
        if (!existing.joinUrl) throw new HttpError(409, 'The created meeting has no join link. Contact an administrator.');
        await applyTeamsMeetingOptions(req.user!, existing.joinUrl, existing.options);
        await tx.request().input('id', sql.UniqueIdentifier, occurrenceId)
          .query('UPDATE dbo.LearningLiveMeetings SET OptionsApplied=1,UpdatedAt=SYSUTCDATETIME() WHERE OccurrenceId=@id');
        return { ...existing, optionsApplied: true };
      }
      return existing;
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
