import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, Clock3, ExternalLink, FileDown, Users } from 'lucide-react';
import { DAYS, canManage, isEnrolledStudent, normaliseEmail, periodTypeId, type Snapshot, type User, type Student, type Lesson, type LearningClass, type LiveMeeting } from '../../shared/learning';
import { addDays, dayStatus, EMPTY_CALENDAR, schoolDate, weekday } from '../../shared/calendar';
import { DATE_DISPLAY_POLICY, formatDate } from '../../shared/dateFormatting';

const schoolClock = new Intl.DateTimeFormat(DATE_DISPLAY_POLICY.locale, {
  timeZone: 'Asia/Dubai', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function schoolTime() {
  const now = new Date();
  const parts = schoolClock.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value;
  return {
    day: DAYS.findIndex((name) => name === part('weekday')),
    time: `${part('hour')}:${part('minute')}`,
    date: schoolDate(now),
  };
}

export function Resources({ lesson, meetings = [] }: { lesson: Lesson; meetings?: LiveMeeting[] }) {
  return (
    <div className="resource-list">
      {lesson.links.map((link) => <a key={link.id} className={`resource ${link.kind}`} href={link.url} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={16} /><span>{link.name}</span><small>{link.kind === 'teams' ? 'Join Teams' : 'Open link'}</small>
      </a>)}
      {lesson.files.map((file) => <a key={file.id} className="resource" href={`/api/lessons/${lesson.id}/files/${file.id}`}>
        <FileDown size={16} /><span>{file.name}</span><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
      </a>)}
      {meetings.filter((meeting) => meeting.lessonId === lesson.id && meeting.state === 'created' && meeting.optionsApplied !== false && meeting.joinUrl).map((meeting) => {
        const occurrence = lesson.occurrences?.find((item) => item.id === meeting.occurrenceId);
        return <a key={meeting.occurrenceId} className="resource teams" href={meeting.joinUrl!} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={16} /><span>{meeting.title ?? lesson.name}</span><small>{occurrence ? formatDate(occurrence.date) : ''} &middot; Join Teams</small>
        </a>;
      })}
    </div>
  );
}
function LessonCard({ lesson, classroom, meeting }: { lesson: Lesson; classroom: LearningClass; meeting?: LiveMeeting }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const hasDetails = Boolean(lesson.description || lesson.files.length || lesson.links.length);
  return <article className="lesson-card">
    <div className="lesson-accent" />
    <div className="lesson-card-body">
      <p className="eyebrow">{classroom.name}</p><h3>{lesson.name}</h3>
      <p className="teacher">{classroom.teachers.map((t) => t.displayName).join(', ')}</p>
      {meeting?.joinUrl && meeting.optionsApplied !== false && <a className="btn primary" href={meeting.joinUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> {meeting.title ?? 'Join live lesson'}</a>}
      {hasDetails && <button className="text-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={detailId}>
        {expanded ? 'Hide lesson details' : `View lesson${lesson.files.length + lesson.links.length ? ` & ${lesson.files.length + lesson.links.length} resources` : ''}`}
      </button>}
      {expanded && <div id={detailId}><p className="description">{lesson.description}</p><Resources lesson={lesson} /></div>}
    </div>
  </article>;
}
export function Timetable({ data, user, children }: { data: Snapshot; user: User; children: Student[] }) {
  const [childEmail, setChildEmail] = useState<string | null>(null);
  const [clock, setClock] = useState(schoolTime);
  const [legacyDay, setDay] = useState(clock.day);
  const [date, setDate] = useState(schoolDate);
  const dated = Boolean(data.calendar?.years.length);
  const day = dated ? weekday(date) : legacyDay;
  const calendar = data.calendar ?? EMPTY_CALENDAR;
  const status = dayStatus(calendar, date);
  const weekStart = addDays(date, -day);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = schoolTime();
      setClock((previous) => previous.day === next.day && previous.time === next.time ? previous : next);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const [mode, setMode] = useState<'self' | 'children'>(user.roles.includes('Parent') && !user.roles.includes('Student') ? 'children' : 'self');
  const selected = children.find((c) => c.email === childEmail) ?? children[0];
  const parentView = mode === 'children';
  const classes = parentView
    ? data.classes.filter((c) => selected && c.students.some((s) => normaliseEmail(s.email) === normaliseEmail(selected.email)))
    : data.classes.filter((c) => c.students.some((s) => isEnrolledStudent(user, s)) || canManage(user, c));
  const lessons = data.lessons.filter((l) => classes.some((c) => c.id === l.classId));
  const slots = data.slots.filter((s) => s.day === day && (!dated || status.teaching)).sort((a, b) => a.start.localeCompare(b.start));
  const onDate = (lesson: Lesson, slotId?: string) => dated
    ? lesson.occurrences?.some((item) => item.date === date && (!slotId || item.slotId === slotId))
    : lesson.slotIds.some((id) => (!slotId || id === slotId) && slots.some((slot) => slot.id === id));
  const lessonCount = lessons.filter((lesson) => onDate(lesson)).length;
  const timeline = useRef<HTMLDivElement>(null);
  const currentSlotId = slots.find((slot) => (!dated || date === clock.date)
    && slot.day === clock.day && slot.start <= clock.time && clock.time < slot.end)?.id;
  useEffect(() => {
    const container = timeline.current;
    if (!container) return;
    const current = container.querySelector<HTMLElement>('[aria-current="time"]');
    container.scrollTop = current
      ? container.scrollTop + current.getBoundingClientRect().top - container.getBoundingClientRect().top - 8
      : 0;
  }, [currentSlotId, dated, date, day, mode, selected?.email]);
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
        {parentView && selected && <div className="child-heading"><span className="initials">{selected.displayName[0]}</span><div><h2>{selected.displayName}</h2><span className="muted">{dated ? 'Dated learning timetable' : 'Weekly learning timetable'}</span></div></div>}
        <div className="week-heading"><div><h2>{dated ? 'Your learning calendar' : 'Your weekly rhythm'}</h2><p className="muted">{dated ? 'Dated lessons follow school terms and holidays.' : 'Legacy weekly view. An administrator must configure the academic calendar for dated lessons.'}</p></div><span className="pill"><Clock3 size={14} /> {dated ? status.term?.name ?? 'Outside term' : 'Weekly timetable'}</span></div>
        {dated && <div className="date-navigation">
          <button className="btn secondary" onClick={() => setDate(addDays(date, -7))}>Previous week</button>
          <label>Timetable date<input type="date" required value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label>
          <button className="btn secondary" onClick={() => setDate(schoolDate())}>Today</button>
          <button className="btn secondary" onClick={() => setDate(addDays(date, 7))}>Next week</button>
        </div>}
        <div className="day-tabs" aria-label="Day of the week">{DAYS.map((name, index) => {
          const tabDate = addDays(weekStart, index);
          const daySlots = data.slots.filter((s) => s.day === index && s.kind === 'lesson' && (!dated || dayStatus(calendar, tabDate).teaching));
          const registrations = daySlots.filter((slot) => data.periodTypes
            .find((type) => type.id === periodTypeId(slot))?.name.trim().toLowerCase() === 'registration').length;
          const periods = daySlots.length - registrations;
          return <button key={name} onClick={() => dated ? setDate(tabDate) : setDay(index)} aria-pressed={day === index} className={day === index ? 'active' : ''}>{dated ? <strong className="day-tab-heading">{`${name.slice(0, 3)} - ${formatDate(tabDate, 'dayMonth')}`}</strong> : <span>{name.slice(0, 3)}</span>}<small>{periods} {periods === 1 ? 'period' : 'periods'}</small>{registrations > 0 && <small>+ {registrations} {registrations === 1 ? 'registration' : 'registrations'}</small>}</button>;
        })}</div>
        <div className="day-summary"><h2>{DAYS[day]}{dated && ` ${formatDate(date)}`}</h2><span className="muted">{lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'} scheduled</span></div>
        {dated && !status.teaching && <p className="alert" role="status">{status.holiday ? `Holiday: ${status.holiday.name}` : weekday(date) >= 5 ? 'Weekend - no teaching.' : 'Outside school terms - no teaching.'}</p>}
        <div className="timeline" ref={timeline} role="region" aria-label="Day timetable periods" tabIndex={0}>
          {slots.map((slot) => {
            const scheduled = lessons.filter((lesson) => onDate(lesson, slot.id));
            const current = slot.id === currentSlotId;
            return <div key={slot.id} className={`timeline-row ${slot.kind}${current ? ' current-period' : ''}`} aria-current={current ? 'time' : undefined}>
              <div className="time"><strong>{slot.start}</strong><span>{slot.end}</span></div>
              <div className="period-content"><div className="period-label">{slot.name}<span className="pill">{data.periodTypes.find((type) => type.id === periodTypeId(slot))?.name}</span>{current && <span className="current-period-label">Now</span>}</div>
                {slot.kind === 'break' ? <div className="break-card"><span aria-hidden="true">&#9749;</span> Take a break. Recharge for what comes next.</div>
                  : scheduled.length ? scheduled.map((lesson) => {
                    const occurrence = lesson.occurrences?.find((item) => item.date === date && item.slotId === slot.id);
                    const meeting = data.meetings?.find((item) => item.occurrenceId === occurrence?.id && item.state === 'created');
                    return <LessonCard key={lesson.id} lesson={lesson} classroom={classes.find((c) => c.id === lesson.classId)!} meeting={meeting} />;
                  })
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
