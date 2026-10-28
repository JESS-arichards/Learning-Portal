import { useEffect, useRef, useState } from 'react';
import { meetingRequestSchema, type Lesson, type Snapshot, type User, type MeetingRequest } from '../../shared/learning';
import { formatDate } from '../../shared/dateFormatting';
import { api, errorMessage } from './api';

export function LessonTeams({ lesson, data, user, refresh, onBusyChange, staged, onStage }: {
  lesson: Lesson; data: Snapshot; user: User; refresh: () => Promise<void>; onBusyChange: (busy: boolean) => void;
  staged: MeetingRequest | null; onStage: (request: MeetingRequest | null) => void;
}) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean; meetingOptionsReady: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [meetings, setMeetings] = useState(data.meetings ?? []);
  const existingSeries = meetings.find((item) => item.lessonId === lesson.id && item.state !== 'cancelled');
  const [title, setTitle] = useState(existingSeries?.title ?? staged?.title ?? lesson.name);
  const [allowBreakoutRooms, setAllowBreakoutRooms] = useState(existingSeries?.options?.allowBreakoutRooms ?? staged?.options.allowBreakoutRooms ?? false);
  const working = useRef(false);
  const classroom = data.classes.find((item) => item.id === lesson.classId);
  const assigned = user.roles.includes('Staff') && classroom?.teachers.some((item) => item.id === user.id);
  useEffect(() => { setMeetings(data.meetings ?? []); }, [data.meetings]);
  useEffect(() => {
    if (!assigned) return;
    let active = true;
    const load = () => {
      void api<{ configured: boolean; connected: boolean; meetingOptionsReady: boolean }>('/teams/status')
        .then((result) => { if (active) { setStatus(result); setError(''); } })
        .catch((error: unknown) => { if (active) setError(errorMessage(error)); });
    };
    load(); window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [assigned]);
  async function cancel(onlyId?: string) {
    if (working.current) return;
    working.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      for (const meeting of meetings.filter((item) => item.lessonId === lesson.id && item.state === 'created' && item.organizerUserId === user.id && (!onlyId || item.occurrenceId === onlyId))) {
        await api(`/lessons/${lesson.id}/occurrences/${meeting.occurrenceId}/teams/cancel`, 'POST');
        setMeetings((current) => current.map((item) => item.occurrenceId === meeting.occurrenceId ? { ...item, state: 'cancelled', joinUrl: null } : item));
      }
      await refresh();
    } catch (error) { setError(`Cancellation was not fully completed: ${errorMessage(error)} Retry cancellation to resolve remaining invitations.`); }
    finally { working.current = false; setBusy(false); onBusyChange(false); }
  }
  function stage() {
    setError('');
    try { onStage(meetingRequestSchema.parse({ title, options: { allowBreakoutRooms } })); }
    catch (error) { setError(errorMessage(error)); }
  }
  return <section>
    <p>Configure meetings for every dated period in this lesson series. No invitations are sent until Save lesson is clicked. You will be the organiser and the class students will receive calendar invitations.</p>
    {!assigned ? <p className="alert">Only an assigned class teacher can connect their calendar and create or cancel meetings.</p>
      : <>
        <label>Meeting name<input required maxLength={200} value={title} disabled={busy || Boolean(existingSeries)} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="checkbox"><input type="checkbox" checked={allowBreakoutRooms} disabled={busy || Boolean(existingSeries)} onChange={(event) => setAllowBreakoutRooms(event.target.checked)} /> Allow breakout rooms</label>
        <p className="small muted">Enables breakout rooms for student groups. Create and assign the actual rooms in Teams. Existing meetings retain their original title and options on retry; school policies still apply.</p>
        {!status && !error && <p role="status">Checking Microsoft calendar connection...</p>}
        {status && !status.configured && <p className="alert">Teams is not configured. An administrator must configure the Entra settings and delegated calendar and online-meeting permissions.</p>}
        {status?.configured && <p><a className="btn secondary" href="/api/teams/connect" target="_blank" rel="noopener noreferrer">Connect / reconnect my Microsoft calendar</a><span className="small muted"> Opens in another tab to preserve this lesson. Return here after connecting.</span></p>}
        {status?.connected && !status.meetingOptionsReady && <p className="alert">Reconnect your calendar to approve meeting options. An administrator may first need to grant delegated OnlineMeetings.ReadWrite permission.</p>}
        <div className="form-actions">
          <button type="button" className="btn primary" disabled={busy || !title.trim()} onClick={stage}>Add Teams meetings on save</button>
          {staged && <button type="button" className="btn secondary" disabled={busy} onClick={() => onStage(null)}>Remove pending Teams setup</button>}
        </div>
        <p className="small muted">You can configure meetings before connecting, but must connect before saving. Save lesson creates or retries all eligible occurrences without duplicating invitations. A failure is reported explicitly with remaining setup retained.</p>
        {meetings.some((m) => m.lessonId === lesson.id) && <>
          <p className="small muted">Cancellation of existing invitations is immediate and requires confirmation. Cancel live meetings before changing lesson details or its class roster. Cancelled occurrences are not recreated unless rescheduled.</p>
          <button type="button" className="btn secondary" disabled={busy || !status?.connected || !meetings.some((m) => m.lessonId === lesson.id && m.state === 'created' && m.organizerUserId === user.id)} onClick={() => {
            if (window.confirm("Cancel this series' existing Teams invitations now?")) void cancel();
          }}>Cancel existing series meetings now</button>
          <div className="table-scroll"><table><thead><tr><th>Date / period</th><th>Meeting</th><th>Action</th></tr></thead><tbody>{(lesson.occurrences ?? []).map((item) => {
            const meeting = meetings.find((meeting) => meeting.occurrenceId === item.id);
            return <tr key={item.id}><td>{formatDate(item.date)} / {data.slots.find((slot) => slot.id === item.slotId)?.name}</td>
              <td>{meeting?.title && <strong>{meeting.title}: </strong>}{meeting?.state === 'created' && meeting.optionsApplied === false ? 'Created; options need retry' : meeting?.state ?? 'Not created'}
                {meeting?.joinUrl && meeting.optionsApplied !== false && <> <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer">{meeting.title ?? 'Join meeting'}</a></>}</td>
              <td>{status?.connected && meeting?.state === 'created' && meeting.organizerUserId === user.id && <button type="button" className="text-button" disabled={busy} onClick={() => {
                if (window.confirm('Cancel this existing meeting invitation now?')) void cancel(item.id);
              }}>Cancel now</button>}</td></tr>;
          })}</tbody></table></div>
        </>}
      </>}
    {busy && <p role="status">Cancelling existing invitations. Keep this dialog open.</p>}
    {error && <p role="alert" className="alert error">{error}</p>}
  </section>;
}
