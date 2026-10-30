import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, ChevronLeft, ChevronRight, Clock3, ExternalLink, FileDown, Images, Users } from 'lucide-react';
import { Modal } from './navigation/Modal';
import { DAYS, canManage, isEnrolledStudent, normaliseEmail, periodTypeId, type LessonType, type Snapshot, type User, type Student, type Lesson, type LearningClass, type LiveMeeting } from '../../shared/learning';
import { LessonTypeBadge } from './LessonTypeBadge';
import { addDays, dayStatus, EMPTY_CALENDAR, schoolDate, weekday, timetableWeek } from '../../shared/calendar';
import { DATE_DISPLAY_POLICY, formatDate } from '../../shared/dateFormatting';
import teamsLogo from './assets/microsoft-teams.svg';
import { AuthenticatedImage, ResourceLink } from './AuthenticatedResource';

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
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState<'links' | 'images' | null>(null);
  const resourceId = useId();
  const links = lesson.links.filter((link) => link.kind !== 'teams');
  const images = lesson.files.filter((file) => /\.(png|jpe?g|gif|webp)$/i.test(file.name));
  const files = lesson.files.filter((file) => !images.includes(file));
  const liveMeetings = meetings.filter((meeting) => meeting.lessonId === lesson.id && meeting.state === 'created'
    && meeting.optionsApplied !== false && meeting.joinUrl);
  if (!lesson.links.length && !lesson.files.length && !liveMeetings.length) return null;
  return (
    <div className="lesson-resources">
      <button type="button" className="btn secondary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={resourceId}>
        {expanded ? 'Hide Lesson Resources' : 'Open Lesson Resources'}
      </button>
      <div id={resourceId} className="resource-list" hidden={!expanded}>
        {expanded && <>
          {links.length > 0 && <button type="button" className="btn secondary resource" aria-haspopup="dialog" onClick={() => setDialog('links')}>
            <ExternalLink size={18} aria-hidden="true" /><span>Links ({links.length})</span>
          </button>}
          {images.length > 0 && <button type="button" className="btn secondary resource" aria-haspopup="dialog" onClick={() => setDialog('images')}>
            <Images size={18} aria-hidden="true" /><span>Images ({images.length})</span>
          </button>}
          {lesson.links.filter((link) => link.kind === 'teams').map((link) => <a key={link.id} className={`btn secondary resource ${link.kind}`} href={link.url} target="_blank" rel="noopener noreferrer">
            {link.kind === 'teams' ? <img className="teams-logo" src={teamsLogo} alt="Microsoft Teams" /> : <ExternalLink size={18} aria-hidden="true" />}
            <span>{link.name}</span><small>{link.kind === 'teams' ? 'Join Teams' : 'Open link'}</small>
          </a>)}
          {files.map((file) => <ResourceLink key={file.id} className="btn secondary resource file" href={`/api/lessons/${lesson.id}/files/${file.id}`} fileName={file.name}>
            <FileDown size={18} aria-hidden="true" /><span>{file.name}</span><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
          </ResourceLink>)}
          {liveMeetings.map((meeting) => {
            const occurrence = lesson.occurrences?.find((item) => item.id === meeting.occurrenceId);
            return <a key={meeting.occurrenceId} className="btn secondary resource teams" href={meeting.joinUrl!} target="_blank" rel="noopener noreferrer">
              <img className="teams-logo" src={teamsLogo} alt="Microsoft Teams" /><span>{meeting.title ?? lesson.name}</span><small>{occurrence ? formatDate(occurrence.date) : ''} &middot; Join Teams</small>
            </a>;
          })}
        </>}
      </div>
      {dialog && createPortal(<Modal title={`${lesson.name} - ${dialog === 'links' ? 'Links' : 'Images'}`} className="portal-support-dialog lesson-viewer-dialog" onClose={() => setDialog(null)}>
        {dialog === 'links' ? <ul className="lesson-link-list">{links.map((link) => <li key={link.id}>
          <a className="resource" href={link.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={18} aria-hidden="true" /><span>{link.name}</span><small>Open link</small>
          </a>
        </li>)}</ul> : <LessonImages lessonId={lesson.id} images={images} />}
      </Modal>, document.body)}
    </div>
  );
}
export function LessonImages({ lessonId, images }: { lessonId: string; images: Lesson['files'] }) {
  const [index, setIndex] = useState(0);
  const [failedImageId, setFailedImageId] = useState('');
  const selectedIndex = Math.min(index, images.length - 1);
  const image = images[selectedIndex];
  if (!image) return <p role="status">No images available.</p>;
  function move(step: number) {
    setIndex((selectedIndex + step + images.length) % images.length);
    setFailedImageId('');
  }
  return <section className="lesson-image-carousel" aria-label="Lesson images" aria-roledescription="carousel" onKeyDown={(event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }}>
    <figure>
      {failedImageId === image.id ? <p role="alert">This image could not be loaded. Try reopening the dialog or download the image below.</p>
        : <AuthenticatedImage key={image.id} src={`/api/lessons/${lessonId}/files/${image.id}?preview=1`} alt={image.name} onError={() => setFailedImageId(image.id)} />}
      <figcaption aria-live="polite" aria-atomic="true">{selectedIndex + 1} of {images.length}: {image.name}</figcaption>
    </figure>
    <div className="lesson-image-controls">
      <button type="button" className="btn secondary" aria-label="Previous image" disabled={images.length < 2} onClick={() => move(-1)}><ChevronLeft size={18} aria-hidden="true" />Previous</button>
      <ResourceLink className="btn secondary" href={`/api/lessons/${lessonId}/files/${image.id}`} fileName={image.name}><FileDown size={18} aria-hidden="true" />Download</ResourceLink>
      <button type="button" className="btn secondary" aria-label="Next image" disabled={images.length < 2} onClick={() => move(1)}>Next<ChevronRight size={18} aria-hidden="true" /></button>
    </div>
  </section>;
}
function LessonCard({ lesson, classroom, meeting, lessonType }: { lesson: Lesson; classroom: LearningClass; meeting?: LiveMeeting; lessonType?: LessonType }) {
  return <article className="lesson-card">
    <div className="lesson-accent" />
    <div className="lesson-card-body">
      <p className="eyebrow">{classroom.name}</p><h3>{lesson.name}</h3>
      <LessonTypeBadge type={lessonType} />
      <p className="teacher">{classroom.teachers.map((t) => t.displayName).join(', ')}</p>
      {lesson.description && <p className="description">{lesson.description}</p>}
      <Resources lesson={lesson} meetings={meeting ? [meeting] : []} />
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
  const year = calendar.years.find((year) => year.start <= date && date <= year.end);
  const terms = calendar.terms.filter((term) => term.yearId === year?.id).sort((a, b) => a.start.localeCompare(b.start));
  const currentTerm = dayStatus(calendar, clock.date).term;
  const weekDates = dated ? timetableWeek(calendar, date) : [];
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
  useEffect(() => {
    if (dated && !weekDates.includes(date) && weekDates.length) setDate(weekDates[0]);
  }, [dated, date, weekDates.join(',')]);
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
        <div className="week-heading timetable-heading"><div><h2>{dated ? 'Your learning calendar' : 'Your weekly rhythm'}</h2><p className="muted">{dated ? 'Dated lessons follow school terms and holidays.' : 'Legacy weekly view. An administrator must configure the academic calendar for dated lessons.'}</p></div>
          <div className="timetable-terms" aria-label={year ? `${year.name} terms` : 'Timetable terms'}>
            {dated && terms.length ? terms.map((term) => <span key={term.id} className={`pill${term.id === currentTerm?.id ? ' current-term' : ''}`} aria-current={term.id === currentTerm?.id ? 'date' : undefined}><Clock3 size={14} aria-hidden="true" />{term.name}</span>)
              : <span className="pill"><Clock3 size={14} aria-hidden="true" />{dated ? 'Outside term' : 'Weekly timetable'}</span>}
          </div>
        </div>
        {dated && <div className="date-navigation">
          <button className="btn secondary" onClick={() => setDate(addDays(date, -7))}>Previous week</button>
          <button className="btn secondary" onClick={() => setDate(schoolDate())}>Today</button>
          <button className="btn secondary" onClick={() => setDate(addDays(date, 7))}>Next week</button>
        </div>}
        <div className="day-tabs" aria-label="Day of the week">{(dated ? weekDates : DAYS.map((_, index) => index)).map((value) => {
          const tabDate = typeof value === 'string' ? value : '';
          const index = typeof value === 'string' ? weekday(value) : value;
          const name = DAYS[index];
          const daySlots = data.slots.filter((s) => s.day === index && s.kind === 'lesson' && (!dated || dayStatus(calendar, tabDate).teaching));
          const registrations = daySlots.filter((slot) => data.periodTypes
            .find((type) => type.id === periodTypeId(slot))?.name.trim().toLowerCase() === 'registration').length;
          const periods = daySlots.length - registrations;
          return <button key={name} onClick={() => dated ? setDate(tabDate) : setDay(index)} aria-pressed={day === index} className={day === index ? 'active' : ''}>{dated ? <strong className="day-tab-heading"><span>{name.slice(0, 3)}</span><span className="day-tab-separator"> - </span><time dateTime={tabDate}>{formatDate(tabDate, 'dayMonth')}</time></strong> : <span>{name.slice(0, 3)}</span>}<small>{periods} {periods === 1 ? 'period' : 'periods'}</small>{registrations > 0 && <small>+ {registrations} {registrations === 1 ? 'registration' : 'registrations'}</small>}</button>;
        })}</div>
        <div className="day-summary"><h2>{DAYS[day]}{dated && ` ${formatDate(date)}`}</h2><span className="muted">{lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'} scheduled</span></div>
        {dated && !status.teaching && <p className="alert" role="status">{status.holiday ? `Holiday: ${status.holiday.name}` : !status.included ? 'Excluded teaching day - no teaching.' : 'Outside school terms - no teaching.'}</p>}
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
                    return <LessonCard key={lesson.id} lesson={lesson} classroom={classes.find((c) => c.id === lesson.classId)!} meeting={meeting} lessonType={data.lessonTypes?.find((type) => type.id === lesson.lessonTypeId)} />;
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
