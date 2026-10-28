import { useState, type FormEvent } from 'react';
import { Plus, Users, BookOpen, Pencil } from 'lucide-react';
import { DAYS, canManage, lessonInputSchema, type User, type Snapshot, type Lesson, type LearningClass, type LessonInput } from '../../shared/learning';
import { api, errorMessage } from './api';
import { Resources } from './Timetable';
import { LessonSchedule } from './LessonSchedule';
import { LessonResources } from './LessonResources';
import { schoolDate, EMPTY_CALENDAR, previewSchedule } from '../../shared/calendar';

function LessonEditor({ lesson, classroom, data, user, onClose, refresh }: {
  lesson?: Lesson; classroom: LearningClass; data: Snapshot; user: User; onClose: () => void; refresh: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(lesson);
  const [draft, setDraft] = useState<LessonInput>({
    classId: classroom.id, name: lesson?.name ?? '', description: lesson?.description ?? '',
    slotIds: lesson?.schedule ? lesson.slotIds : [], links: lesson?.links ?? [],
    schedule: lesson?.schedule ?? { startDate: schoolDate(), frequency: 'once', count: 1 },
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resourceBusy, setResourceBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const input = lessonInputSchema.parse(draft);
      const preview = previewSchedule(data.calendar ?? EMPTY_CALENDAR, data.slots, input.slotIds, input.schedule!);
      if (preview.truncated && !window.confirm(`This series stops at term end ${preview.termEnd}, earlier than requested ${preview.requestedEnd}. Actual final lesson date: ${preview.actualEnd}. Continue?`)) return;
      const result = await api<Lesson>(saved ? `/lessons/${saved.id}` : '/lessons', saved ? 'PUT' : 'POST', input);
      setSaved(result); await refresh(); setNotice(`Lesson saved with ${result.occurrences?.length ?? 0} period occurrences. Actual final date: ${result.occurrences?.at(-1)?.date}. You can attach files and create Teams meetings below.`);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="panel editor" aria-label="Lesson editor">
    <div className="section-heading"><div><p className="eyebrow">{classroom.name}</p><h2>{saved ? 'Edit lesson' : 'Create a lesson'}</h2></div><button className="btn secondary" disabled={busy || resourceBusy} onClick={onClose}>Close editor</button></div>
    <form onSubmit={(event) => void submit(event)}>
      <label>Lesson name<input required maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>Description<textarea rows={4} maxLength={10000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What will students learn? Include instructions and preparation." /></label>
      <LessonSchedule schedule={draft.schedule!} slotIds={draft.slotIds} slots={data.slots} calendar={data.calendar} onChange={(schedule, slotIds) => setDraft({ ...draft, schedule, slotIds })} />
      <button className="btn primary" disabled={busy || resourceBusy}>{busy ? 'Saving...' : 'Save lesson'}</button>
    </form>
    <LessonResources lesson={saved} data={data} user={user} disabled={busy} onBusyChange={setResourceBusy} refresh={refresh}
      onChange={(result) => { setSaved(result); setDraft((current) => ({ ...current, links: result.links })); }} />
    {error && <p role="alert" className="alert error">{error}</p>}
    {notice && <p role="status" className="alert success">{notice}</p>}
  </section>;
}
export function Classes({ data, user, refresh }: { data: Snapshot; user: User; refresh: () => Promise<void> }) {
  const classes = data.classes.filter((c) => canManage(user, c));
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const classroom = classes.find((c) => c.id === classId) ?? classes[0];
  const [editor, setEditor] = useState<Lesson | 'new' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function deleteLesson(lesson: Lesson) {
    if (!window.confirm(`Delete "${lesson.name}" and all its resources?`)) return;
    setBusy(true); setError('');
    try { await api(`/lessons/${lesson.id}`, 'DELETE'); await refresh(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">TEACHER WORKSPACE</p><h1>My classes</h1><p className="muted">Bring your lessons and resources together. Students see saved lessons in their timetable.</p></div><div className="heading-icon"><Users /></div></div>
    {!classes.length ? <div className="empty panel"><Users size={32} /><h2>No assigned classes yet</h2><p className="muted">Your Learning Portal administrator can import class data using your school email address.</p></div> : <>
      <div className="class-selector"><label>Class<select value={classroom.id} onChange={(e) => { setClassId(e.target.value); setEditor(null); setError(''); }}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name} / {c.yearGroup} / {c.division}</option>)}</select></label><span className="pill">{classroom.students.length} {classroom.students.length === 1 ? 'student' : 'students'}</span></div>
      <div className="class-overview panel"><div><p className="eyebrow">{classroom.division} &middot; {classroom.yearGroup}</p><h2>{classroom.name}</h2><p className="muted">{classroom.teachers.map((t) => t.displayName).join(', ')}</p></div><button className="btn primary" disabled={busy} onClick={() => setEditor('new')}><Plus size={17} /> Create lesson</button></div>
      {error && <p role="alert" className="alert error">{error}</p>}
      {editor !== null && <LessonEditor key={editor === 'new' ? `new-${classroom.id}` : editor.id} lesson={editor === 'new' ? undefined : editor} classroom={classroom} data={data} user={user} onClose={() => setEditor(null)} refresh={refresh} />}
      <div className="section-heading"><h2>Class lessons</h2><span className="muted">{data.lessons.filter((l) => l.classId === classroom.id).length} published</span></div>
      <div className="lesson-grid">{data.lessons.filter((l) => l.classId === classroom.id).map((lesson) => <article key={lesson.id} className="panel managed-lesson">
        <div className="lesson-icon"><BookOpen size={20} /></div><h3>{lesson.name}</h3><p className="description">{lesson.description}</p>
        <div className="schedule-pills">{lesson.slotIds.map((id) => { const s = data.slots.find((s) => s.id === id); return s ? <span className="pill" key={id}>{DAYS[s.day].slice(0, 3)} {s.start}</span> : null; })}</div>
        <p className="small muted">{lesson.schedule ? `${lesson.schedule.frequency}: ${lesson.schedule.startDate} to ${lesson.occurrences?.at(-1)?.date} (${lesson.occurrences?.length ?? 0} period occurrences)` : 'Legacy weekly lesson - replace with a dated schedule.'}</p>
        <Resources lesson={lesson} meetings={data.meetings} /><div className="card-actions"><button className="btn secondary" disabled={busy} onClick={() => setEditor(lesson)}><Pencil size={15} /> Edit</button><button className="text-button danger" disabled={busy} onClick={() => void deleteLesson(lesson)}>Delete lesson</button></div>
      </article>)}</div>
      {!data.lessons.some((l) => l.classId === classroom.id) && <div className="empty panel"><BookOpen size={30} /><h3>A fresh start for this class</h3><p className="muted">Create a lesson, choose weekly periods and add resources.</p></div>}
      <details className="panel roster"><summary>Class roster &middot; {classroom.students.length} {classroom.students.length === 1 ? 'student' : 'students'}</summary><p className="muted">Enrolments are maintained by administrators through class imports.</p><div className="table-scroll"><table><thead><tr><th>Student</th><th>Email</th></tr></thead><tbody>{classroom.students.map((s) => <tr key={s.email}><td>{s.displayName}</td><td>{s.email}</td></tr>)}</tbody></table></div></details>
    </>}
  </>;
}
