import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Plus, Users, BookOpen, Pencil } from 'lucide-react';
import { DAYS, canManage, lessonInputSchema, type User, type Snapshot, type Lesson, type LearningClass, type LessonInput } from '../../shared/learning';
import { api, errorMessage } from './api';
import { Resources } from './Timetable';
import { LessonSchedule } from './LessonSchedule';
import { LessonResources } from './LessonResources';
import { schoolDate, EMPTY_CALENDAR, previewSchedule } from '../../shared/calendar';
import { formatDate } from '../../shared/dateFormatting';
import { emptyResources, saveLessonSetup } from './lessonSetup';
import { LessonTypeBadge } from './LessonTypeBadge';

function LessonEditor({ lesson, classroom, data, user, onClose, refresh }: {
  lesson?: Lesson; classroom: LearningClass; data: Snapshot; user: User; onClose: () => void; refresh: () => Promise<void>;
}) {
  const formId = useId();
  const [saved, setSaved] = useState(lesson);
  const [draft, setDraft] = useState<LessonInput>({
    classId: classroom.id, lessonTypeId: lesson?.lessonTypeId ?? '', name: lesson?.name ?? '', description: lesson?.description ?? '',
    slotIds: lesson?.schedule ? lesson.slotIds : [], links: lesson?.links ?? [],
    schedule: lesson?.schedule ?? { startDate: schoolDate(), frequency: 'once', count: 1 },
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resources, setResources] = useState(emptyResources);
  const [lessonId] = useState(() => lesson?.id ?? crypto.randomUUID());
  const saving = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved ? {
    classId: saved.classId, lessonTypeId: saved.lessonTypeId ?? '', name: saved.name, description: saved.description, slotIds: saved.slotIds, links: saved.links, schedule: saved.schedule,
  } : { classId: classroom.id, lessonTypeId: '', name: '', description: '', slotIds: [], links: [], schedule: { startDate: schoolDate(), frequency: 'once', count: 1 } })
    || resources.files.length > 0 || resources.removedFileIds.length > 0 || resources.teams !== null;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || resourceBusy) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    let detailsSaved = false;
    try {
      const input = lessonInputSchema.parse(draft);
      const preview = previewSchedule(data.calendar ?? EMPTY_CALENDAR, data.slots, input.slotIds, input.schedule!);
      if (preview.truncated && !window.confirm(`This series stops at term end ${formatDate(preview.termEnd)}, earlier than requested ${formatDate(preview.requestedEnd)}. Actual final lesson date: ${formatDate(preview.actualEnd)}. Continue?`)) return;
      const result = await saveLessonSetup({ id: lessonId, saved, input, resources, onSaved: (result) => { detailsSaved = true; setSaved(result); }, onProgress: setNotice,
        onUploaded: (file) => setResources((current) => ({ ...current, files: current.files.filter((item) => item.id !== file.id) })),
        onRemoved: (id) => setResources((current) => ({ ...current, removedFileIds: current.removedFileIds.filter((item) => item !== id) })),
        onTeamsSaved: () => setResources((current) => ({ ...current, teams: null })),
      });
      await refresh();
      const finalDate = result.occurrences?.at(-1)?.date;
      setNotice(`Lesson and resources saved with ${result.occurrences?.length ?? 0} period occurrences. Actual final date: ${finalDate ? formatDate(finalDate) : 'not scheduled'}.`);
    } catch (error) {
      setNotice(''); setError(errorMessage(error));
      if (detailsSaved) {
        try { await refresh(); }
        catch (refreshError) { setError(`${errorMessage(error)} Could not reload current status: ${errorMessage(refreshError)} Your pending setup remains in this editor.`); }
      }
    }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className="panel editor" aria-label="Lesson editor">
    <div className="section-heading"><div><p className="eyebrow">{classroom.name}</p><h2>{saved ? 'Edit lesson' : 'Create a lesson'}</h2></div><button className="btn secondary" disabled={busy || resourceBusy} onClick={() => { if (!dirty || window.confirm('Discard unsaved lesson and resource changes? No pending uploads or invitations will be sent.')) onClose(); }}>Close editor</button></div>
    <form id={formId} onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy || resourceBusy} className="lesson-details-fields">
      <label>Lesson name<input required maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>Lesson type<select required value={draft.lessonTypeId} onChange={(event) => setDraft({ ...draft, lessonTypeId: event.target.value })}>
        <option value="">Select a lesson type</option>
        {(data.lessonTypes ?? []).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
      </select></label>
      {!data.lessonTypes?.length && <p role="alert" className="alert">Ask a Learning administrator to add lesson types before saving a lesson.</p>}
      <LessonTypeBadge type={data.lessonTypes?.find((type) => type.id === draft.lessonTypeId)} />
      <label>Description<textarea rows={4} maxLength={10000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What will students learn? Include instructions and preparation." /></label>
      <LessonSchedule schedule={draft.schedule!} slotIds={draft.slotIds} slots={data.slots} calendar={data.calendar} onChange={(schedule, slotIds) => setDraft({ ...draft, schedule, slotIds })} />
      </fieldset>
    </form>
    <LessonResources lesson={{ ...draft, links: saved?.links ?? [], id: lessonId, files: saved?.files ?? [], occurrences: saved?.occurrences, updatedAt: saved?.updatedAt ?? '' }}
      links={draft.links} resources={resources} data={data} user={user} disabled={busy} onBusyChange={setResourceBusy} refresh={refresh}
      onLinksChange={(links) => setDraft((current) => ({ ...current, links }))} onResourcesChange={setResources} />
    {error && <p role="alert" className="alert error">{error}</p>}
    {notice && <p role="status" className="alert success">{notice}</p>}
    <div className="form-actions"><button type="submit" form={formId} className="btn primary" disabled={busy || resourceBusy}>{busy ? 'Saving...' : 'Save lesson'}</button></div>
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
        <LessonTypeBadge type={data.lessonTypes?.find((type) => type.id === lesson.lessonTypeId)} />
        <Resources lesson={lesson} meetings={data.meetings} />
        <div className="schedule-pills">{lesson.slotIds.map((id) => { const s = data.slots.find((s) => s.id === id); return s ? <span className="pill" key={id}>{DAYS[s.day].slice(0, 3)} {s.start}</span> : null; })}</div>
        <p className="small muted">{lesson.schedule ? `${lesson.schedule.frequency}: ${formatDate(lesson.schedule.startDate)} to ${lesson.occurrences?.at(-1)?.date ? formatDate(lesson.occurrences.at(-1)!.date) : 'not scheduled'} (${lesson.occurrences?.length ?? 0} period occurrences)` : 'Legacy weekly lesson - replace with a dated schedule.'}</p>
        <div className="card-actions"><button className="btn secondary" disabled={busy} onClick={() => setEditor(lesson)}><Pencil size={15} /> Edit</button><button className="text-button danger" disabled={busy} onClick={() => void deleteLesson(lesson)}>Delete lesson</button></div>
      </article>)}</div>
      {!data.lessons.some((l) => l.classId === classroom.id) && <div className="empty panel"><BookOpen size={30} /><h3>A fresh start for this class</h3><p className="muted">Create a lesson, choose weekly periods and add resources.</p></div>}
      <details className="panel roster"><summary>Class roster &middot; {classroom.students.length} {classroom.students.length === 1 ? 'student' : 'students'}</summary><p className="muted">Enrolments are maintained by administrators through class imports.</p><div className="table-scroll"><table><thead><tr><th>Student</th><th>Email</th></tr></thead><tbody>{classroom.students.map((s) => <tr key={s.email}><td>{s.displayName}</td><td>{s.email}</td></tr>)}</tbody></table></div></details>
    </>}
  </>;
}
