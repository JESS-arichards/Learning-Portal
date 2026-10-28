import { useEffect, useRef, useState } from 'react';
import { meetingRequestSchema, type Lesson, type Snapshot, type User, type LiveMeeting } from '../../shared/learning';
import { api, errorMessage } from './api';

export function LessonTeams({ lesson, data, user, refresh, onBusyChange }: {
  lesson: Lesson; data: Snapshot; user: User; refresh: () => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean; meetingOptionsReady?: boolean } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [meetings, setMeetings] = useState(data.meetings ?? []);
  const existingSeries = meetings.find((item) => item.lessonId === lesson.id && item.state !== 'cancelled');
  const [title, setTitle] = useState(existingSeries?.title ?? lesson.name);
  const [allowBreakoutRooms, setAllowBreakoutRooms] = useState(existingSeries?.options?.allowBreakoutRooms ?? false);
  const working = useRef(false);
  const classroom = data.classes.find((item) => item.id === lesson.classId);
  const assigned = user.roles.includes('Staff') && classroom?.teachers.some((item) => item.id === user.id);
  useEffect(() => { setMeetings(data.meetings ?? []); }, [data.meetings]);
  useEffect(() => {
    if (!assigned) return;
    let active = true;
    const load = () => {
      void api<{ configured: boolean; connected: boolean; meetingOptionsReady?: boolean }>('/teams/status')
        .then((result) => { if (active) setStatus(result); })
        .catch((error: unknown) => { if (active) setError(errorMessage(error)); });
    };
    load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [assigned]);
  const occurrences = lesson.occurrences ?? [];
  async function run(cancel: boolean, onlyId?: string) {
    if (working.current) return;
    working.current = true; setBusy(true); onBusyChange(true); setError(''); setNotice('');
    let completed = 0;
    try {
      const request = cancel ? undefined : meetingRequestSchema.parse({ title, options: { allowBreakoutRooms } });
      for (const occurrence of occurrences.filter((item) => !onlyId || item.id === onlyId)) {
        const existing = meetings.find((item) => item.occurrenceId === occurrence.id);
        if (cancel ? existing?.state !== 'created' : (existing?.state === 'created' && existing.optionsApplied !== false) || existing?.state === 'cancelled') continue;
        const path = `/lessons/${lesson.id}/occurrences/${occurrence.id}/teams`;
        let result: LiveMeeting;
        if (cancel && existing) {
          await api<{ ok: boolean }>(`${path}/cancel`, 'POST');
          result = { ...existing, state: 'cancelled', joinUrl: null };
        } else {
          const body = existing ? existing.options ? { title: existing.title, options: existing.options } : undefined : request;
          result = await api<LiveMeeting>(path, 'POST', body);
        }
        setMeetings((current) => [...current.filter((item) => item.occurrenceId !== occurrence.id), result]);
        completed++;
        setNotice(`${completed} meeting invitations ${cancel ? 'cancelled' : 'created with their options applied'}.`);
      }
    } catch (error) {
      setError(`${completed} meetings completed before this error: ${errorMessage(error)} Retry keeps the original title and options and will not duplicate completed invitations. If settings failed after creation, you can retry or cancel that meeting.`);
    } finally {
      try { await refresh(); }
      catch (error) { setError((current) => `${current ? `${current} ` : ''}Could not reload meeting status: ${errorMessage(error)} Close the editor and reload before retrying.`); }
      working.current = false; setBusy(false); onBusyChange(false);
    }
  }
  return <section>
    <p>Creates a meeting for every dated period in this lesson series. You are the organiser and the class students receive calendar invitations. Each meeting's name and link are attached to the matching lesson date.</p>
    {!assigned ? <p className="alert">Only an assigned class teacher can connect their calendar and create or cancel meetings.</p>
      : !lesson.schedule ? <p className="alert">Save a dated lesson schedule first.</p>
      : <>
        <label>Meeting name<input required maxLength={200} value={title} disabled={busy || Boolean(existingSeries)} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="checkbox"><input type="checkbox" checked={allowBreakoutRooms} disabled={busy || Boolean(existingSeries)} onChange={(event) => setAllowBreakoutRooms(event.target.checked)} /> Allow breakout rooms</label>
        <p className="small muted">Enables breakout rooms for student groups. Create and assign the actual rooms in Teams; your school's Teams policies still apply. Existing meetings retain their original title and options on retry.</p>
        {!status && !error && <p role="status">Checking Microsoft calendar connection...</p>}
        {status && !status.configured && <p className="alert">Teams is not configured. An administrator must configure the Entra settings and delegated calendar and online-meeting permissions.</p>}
        {status?.configured && <p><a className="btn secondary" href="/api/teams/connect" target="_blank" rel="noopener noreferrer">Connect / reconnect my Microsoft calendar</a><span className="small muted"> Opens in another tab to preserve this lesson. Return here after connecting.</span></p>}
        {status?.connected && status.meetingOptionsReady === false && <p className="alert">Reconnect your calendar to approve meeting options. An administrator may first need to grant delegated OnlineMeetings.ReadWrite permission.</p>}
        {status?.connected && <div className="form-actions">
          <button type="button" className="btn primary" disabled={busy || status.meetingOptionsReady === false || !occurrences.length || !title.trim()} onClick={() => void run(false)}>Create / retry all meetings</button>
          <button type="button" className="btn secondary" disabled={busy || !meetings.some((m) => m.lessonId === lesson.id && m.state === 'created' && m.organizerUserId === user.id)} onClick={() => {
            if (window.confirm("Cancel this series' Teams invitations?")) void run(true);
          }}>Cancel my series meetings</button>
        </div>}
        <p className="small muted">Keep this dialog open while invitations are being created. Cancel live meetings before editing the lesson schedule or class roster. Cancelled occurrences are not recreated.</p>
        <div className="table-scroll"><table><thead><tr><th>Date / period</th><th>Meeting</th><th>Action</th></tr></thead><tbody>{occurrences.map((item) => {
          const meeting = meetings.find((meeting) => meeting.occurrenceId === item.id);
          return <tr key={item.id}><td>{item.date.split('-').reverse().join('/')} / {data.slots.find((slot) => slot.id === item.slotId)?.name}</td>
            <td>{meeting?.title && <strong>{meeting.title}: </strong>}{meeting?.state === 'created' && meeting.optionsApplied === false ? 'Created; options need retry' : meeting?.state ?? 'Not created'}
              {meeting?.joinUrl && meeting.optionsApplied !== false && <> <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer">{meeting.title ?? 'Join meeting'}</a></>}</td>
            <td>{status?.connected && meeting?.state === 'created' && meeting.organizerUserId === user.id && <button type="button" className="text-button" disabled={busy} onClick={() => {
              if (window.confirm('Cancel this meeting invitation?')) void run(true, item.id);
            }}>Cancel</button>}</td></tr>;
        })}</tbody></table></div>
      </>}
    {busy && <p role="status">Creating or cancelling calendar invitations. Please keep this dialog open.</p>}
    {notice && <p role="status" className="alert success">{notice}</p>}
    {error && <p role="alert" className="alert error">{error}</p>}
  </section>;
}
