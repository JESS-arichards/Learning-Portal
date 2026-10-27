import { useId, useState } from 'react';
import { BookOpen, Clock3, ExternalLink, FileDown, Users } from 'lucide-react';
import { DAYS, canManage, isEnrolledStudent, normaliseEmail, periodTypeId, type Snapshot, type User, type Student, type Lesson, type LearningClass } from '../../shared/learning';

export function Resources({ lesson }: { lesson: Lesson }) {
  return (
    <div className="resource-list">
      {lesson.links.map((link) => <a key={link.id} className={`resource ${link.kind}`} href={link.url} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={16} /><span>{link.name}</span><small>{link.kind === 'teams' ? 'Join Teams' : 'Open link'}</small>
      </a>)}
      {lesson.files.map((file) => <a key={file.id} className="resource" href={`/api/lessons/${lesson.id}/files/${file.id}`}>
        <FileDown size={16} /><span>{file.name}</span><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
      </a>)}
    </div>
  );
}
function LessonCard({ lesson, classroom }: { lesson: Lesson; classroom: LearningClass }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const hasDetails = Boolean(lesson.description || lesson.files.length || lesson.links.length);
  return <article className="lesson-card">
    <div className="lesson-accent" />
    <div className="lesson-card-body">
      <p className="eyebrow">{classroom.name}</p><h3>{lesson.name}</h3>
      <p className="teacher">{classroom.teachers.map((t) => t.displayName).join(', ')}</p>
      {hasDetails && <button className="text-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={detailId}>
        {expanded ? 'Hide lesson details' : `View lesson${lesson.files.length + lesson.links.length ? ` & ${lesson.files.length + lesson.links.length} resources` : ''}`}
      </button>}
      {expanded && <div id={detailId}><p className="description">{lesson.description}</p><Resources lesson={lesson} /></div>}
    </div>
  </article>;
}
export function Timetable({ data, user, children }: { data: Snapshot; user: User; children: Student[] }) {
  const [childEmail, setChildEmail] = useState<string | null>(null);
  const [day, setDay] = useState((new Date().getDay() + 6) % 7);
  const [mode, setMode] = useState<'self' | 'children'>(user.roles.includes('Parent') && !user.roles.includes('Student') ? 'children' : 'self');
  const selected = children.find((c) => c.email === childEmail) ?? children[0];
  const parentView = mode === 'children';
  const classes = parentView
    ? data.classes.filter((c) => selected && c.students.some((s) => normaliseEmail(s.email) === normaliseEmail(selected.email)))
    : data.classes.filter((c) => c.students.some((s) => isEnrolledStudent(user, s)) || canManage(user, c));
  const lessons = data.lessons.filter((l) => classes.some((c) => c.id === l.classId));
  const slots = data.slots.filter((s) => s.day === day).sort((a, b) => a.start.localeCompare(b.start));
  const lessonCount = lessons.filter((l) => l.slotIds.some((id) => slots.some((s) => s.id === id))).length;
  return <>
    <div className="page-heading"><div><p className="eyebrow">YOUR LEARNING, AT A GLANCE</p><h1>{parentView ? 'Family learning' : 'My timetable'}</h1><p className="muted">A clear view of the week ahead. All times are school local time.</p></div><div className="heading-icon"><BookOpen /></div></div>
    {user.roles.includes('Parent') && (user.roles.includes('Staff') || user.roles.includes('Student')) && <div className="segmented" aria-label="Timetable view">
      <button className={!parentView ? 'selected' : ''} onClick={() => setMode('self')}>My timetable</button>
      <button className={parentView ? 'selected' : ''} onClick={() => setMode('children')}>My children</button>
    </div>}
    <div className={parentView ? 'family-layout' : ''}>
      {parentView && <aside className="children-panel panel"><p className="eyebrow">MY CHILDREN</p><h2>Learning together</h2>
        <p className="muted">Select a child to view their timetable.</p>
        <div className="children-list">{children.map((child) => <button key={child.email} className={`child-button ${selected?.email === child.email ? 'active' : ''}`} onClick={() => setChildEmail(child.email)} aria-pressed={selected?.email === child.email}>
          <span className="initials">{child.displayName.split(/\s+/).slice(0, 2).map((s) => s[0]).join('')}</span><span><strong>{child.displayName}</strong><small>View timetable</small></span><span aria-hidden="true">&rsaquo;</span>
        </button>)}</div>
        {!children.length && <p role="status" className="alert">No linked students have class data yet. Contact the school to check your parent links and class enrolments.</p>}
        <p className="small muted"><Users size={14} /> Family links are managed by your school.</p>
      </aside>}
      <section className="timetable-area" aria-label={parentView ? `${selected?.displayName ?? 'Child'} timetable` : 'My timetable'}>
        {parentView && selected && <div className="child-heading"><span className="initials">{selected.displayName[0]}</span><div><h2>{selected.displayName}</h2><span className="muted">Weekly learning timetable</span></div></div>}
        <div className="week-heading"><div><h2>Your weekly rhythm</h2><p className="muted">The weekly schedule repeats until your teacher updates it.</p></div><span className="pill"><Clock3 size={14} /> Weekly timetable</span></div>
        <div className="day-tabs" aria-label="Day of the week">{DAYS.map((name, index) => {
          const periods = data.slots.filter((s) => s.day === index && s.kind === 'lesson').length;
          return <button key={name} onClick={() => setDay(index)} aria-pressed={day === index} className={day === index ? 'active' : ''}><span>{name.slice(0, 3)}</span><small>{periods} {periods === 1 ? 'period' : 'periods'}</small></button>;
        })}</div>
        <div className="day-summary"><h2>{DAYS[day]}</h2><span className="muted">{lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'} scheduled</span></div>
        <div className="timeline">
          {slots.map((slot) => {
            const scheduled = lessons.filter((l) => l.slotIds.includes(slot.id));
            return <div key={slot.id} className={`timeline-row ${slot.kind}`}>
              <div className="time"><strong>{slot.start}</strong><span>{slot.end}</span></div>
              <div className="period-content"><div className="period-label">{slot.name}<span className="pill">{data.periodTypes.find((type) => type.id === periodTypeId(slot))?.name}</span></div>
                {slot.kind === 'break' ? <div className="break-card"><span aria-hidden="true">&#9749;</span> Take a break. Recharge for what comes next.</div>
                  : scheduled.length ? scheduled.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} classroom={classes.find((c) => c.id === lesson.classId)!} />)
                    : <div className="free-period">No lesson scheduled</div>}
              </div>
            </div>;
          })}
          {!slots.length && <div className="empty panel"><Clock3 size={32} /><h3>No periods for {DAYS[day]}</h3><p className="muted">Enjoy the space to learn at your own pace. Your school will publish any timetable updates here.</p></div>}
        </div>
      </section>
    </div>
  </>;
}
