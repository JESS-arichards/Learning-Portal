import { useEffect, useState } from 'react';
import type { Lesson, Snapshot, User } from '../../shared/learning';
import { api, errorMessage } from './api';

export function LessonTeams({ lesson, data, user, refresh }: { lesson: Lesson; data: Snapshot; user: User; refresh: () => Promise<void> }) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const classroom = data.classes.find((item) => item.id === lesson.classId);
  const assigned = user.roles.includes('Staff') && classroom?.teachers.some((item) => item.id === user.id);
  useEffect(() => {
    if (assigned) void api<{ configured: boolean; connected: boolean }>('/teams/status').then(setStatus).catch((error: unknown) => setError(errorMessage(error)));
  }, [assigned]);
  const occurrences = lesson.occurrences ?? [];
  const meetings = data.meetings ?? [];
  async function run(cancel: boolean, onlyId?: string) {
    setBusy(true); setError(''); setNotice('');
    let completed = 0;
    try {
      for (const occurrence of occurrences.filter((item) => !onlyId || item.id === onlyId)) {
        const existing = meetings.find((item) => item.occurrenceId === occurrence.id);
        if (cancel ? existing?.state !== 'created' : existing?.state === 'created' || existing?.state === 'cancelled') continue;
        await api(`/lessons/${lesson.id}/occurrences/${occurrence.id}/teams${cancel ? '/cancel' : ''}`, 'POST');
        completed++;
        setNotice(`${completed} meeting invitations ${cancel ? 'cancelled' : 'created'}.`);
      }
      await refresh();
    } catch (error) {
      setError(`${completed} meetings completed before this error: ${errorMessage(error)} Reload before retrying; completed meetings will not be duplicated.`);
    } finally { setBusy(false); }
  }
  return <section className="file-editor">
    <h3>Live Teams lessons</h3>
    <p className="muted">Each dated period gets its own calendar-backed meeting, so holidays never receive invitations. The signed-in class teacher is the organiser; the current class roster receives real calendar invitations.</p>
    {!assigned ? <p className="alert">Only an assigned class teacher can connect their calendar and create or cancel meetings.</p>
      : !lesson.schedule ? <p className="alert">Convert this legacy weekly lesson to a dated schedule first.</p>
      : <>
        {status && !status.configured && <p className="alert">Teams is not configured. An administrator must configure the Entra settings and delegated calendar permissions.</p>}
        {status?.configured && !status.connected && <button className="btn secondary" onClick={() => window.location.assign('/api/teams/connect')}>Connect my Microsoft calendar</button>}
        {status?.connected && <div className="form-actions"><button className="btn primary" disabled={busy || !occurrences.length} onClick={() => void run(false)}>Create / retry live meetings</button><button className="btn secondary" disabled={busy || !meetings.some((m) => m.lessonId === lesson.id && m.state === 'created' && m.organizerUserId === user.id)} onClick={() => {
          if (window.confirm("Cancel this series' Teams invitations?")) void run(true);
        }}>Cancel my series meetings</button></div>}
        <p className="small muted">Cancel all live meetings before editing or deleting a lesson or changing its class roster. Repeats create individual meetings, not an Outlook recurrence series. Keep this page open while invitations are being created.</p>
        <div className="table-scroll"><table><thead><tr><th>Date / period</th><th>Meeting</th><th>Action</th></tr></thead><tbody>{occurrences.map((item) => {
          const meeting = meetings.find((meeting) => meeting.occurrenceId === item.id);
          const own = !meeting || meeting.organizerUserId === user.id;
          return <tr key={item.id}><td>{item.date} / {data.slots.find((slot) => slot.id === item.slotId)?.name}</td><td>{meeting?.state ?? 'Not created'}{meeting?.joinUrl && <> <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer">Join</a></>}</td><td>
            {status?.connected && own && meeting?.state !== 'cancelled' && <button className="text-button" disabled={busy} onClick={() => {
              if (meeting?.state !== 'created' || window.confirm('Cancel this meeting invitation?')) void run(meeting?.state === 'created', item.id);
            }}>{meeting?.state === 'created' ? 'Cancel' : meeting?.state === 'pending' ? 'Retry creation' : 'Create'}</button>}
          </td></tr>;
        })}</tbody></table></div>
      </>}
    {notice && <p role="status" className="alert success">{notice}</p>}
    {error && <p role="alert" className="alert error">{error}</p>}
  </section>;
}
