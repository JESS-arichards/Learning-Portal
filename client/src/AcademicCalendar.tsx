import { useState } from 'react';
import { academicCalendarSchema, EMPTY_CALENDAR, DEFAULT_TEACHING_WEEK, SUNDAY_TEACHING_WEEK, type AcademicCalendar as Calendar, type TeachingWeek } from '../../shared/calendar';
import { DAYS, type Snapshot } from '../../shared/learning';
import { api, errorMessage } from './api';

function WeekSettings({ value, inherited, onChange }: { value?: TeachingWeek; inherited?: TeachingWeek; onChange: (week: TeachingWeek | undefined) => void }) {
  const week = value ?? inherited ?? DEFAULT_TEACHING_WEEK;
  return <div className="teaching-week-settings">
    <div className="form-actions">
      {inherited && <label className="checkbox"><input type="checkbox" checked={!value} onChange={(event) => onChange(event.target.checked ? undefined : { ...week, days: [...week.days] })} /> Use academic-year teaching week</label>}
      <button type="button" className="btn secondary" onClick={() => onChange({ ...DEFAULT_TEACHING_WEEK, days: [...DEFAULT_TEACHING_WEEK.days] })}>Monday-Friday</button>
      <button type="button" className="btn secondary" onClick={() => onChange({ ...SUNDAY_TEACHING_WEEK, days: [...SUNDAY_TEACHING_WEEK.days] })}>Sunday-Thursday</button>
    </div>
    <div className="teaching-week-days" role="group" aria-label="Included teaching days">
      {DAYS.map((day, index) => <label className="checkbox" key={day}><input type="checkbox" checked={week.days.includes(index)}
        disabled={Boolean(inherited && !value)} onChange={(event) => onChange({ ...week, days: event.target.checked ? [...week.days, index] : week.days.filter((day) => day !== index) })} /> {day}</label>)}
    </div>
    <label>First day of week<select value={week.startsOn} disabled={Boolean(inherited && !value)}
      onChange={(event) => onChange({ ...week, startsOn: Number(event.target.value) })}>{DAYS.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>
  </div>;
}

export function AcademicCalendar({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [calendar, setCalendar] = useState<Calendar>(data.calendar ?? EMPTY_CALENDAR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [bulkWeek, setBulkWeek] = useState<TeachingWeek | undefined>(DEFAULT_TEACHING_WEEK);
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await api<Calendar>('/admin/calendar', 'PUT', academicCalendarSchema.parse(calendar));
      setCalendar(saved); await refresh(); setNotice('Academic calendar saved. All ranges include both start and end dates.');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function reset() {
    if (window.prompt('This deletes all development lessons and their resources, but keeps classes, periods and calendar. Type CLEAR DEVELOPMENT LESSONS to confirm.') !== 'CLEAR DEVELOPMENT LESSONS') return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/admin/schedules/reset', 'POST', { confirmation: 'CLEAR DEVELOPMENT LESSONS' });
      await refresh(); setNotice('Development lessons cleared. Teachers can now create dated lessons.');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <h2>Academic calendar</h2>
    <p className="muted">Set academic years, terms and holidays before scheduling lessons. Choose included teaching days and the first day of the week for each academic year. Terms inherit that week unless overridden. Date ranges include both endpoints; use the same start and end for a single-day holiday.</p>
    {(['years', 'terms', 'holidays'] as const).map((kind) => <fieldset disabled={busy} key={kind}>
      <legend>{kind === 'years' ? 'Academic years' : kind === 'terms' ? 'Terms' : 'Holidays / closures'}</legend>
      {calendar[kind].map((item) => <div className="calendar-entry" key={item.id}>
        <div className="calendar-range">
        <label>Name<input required maxLength={100} value={item.name} onChange={(e) => setCalendar({ ...calendar, [kind]: calendar[kind].map((current) => current.id === item.id ? { ...current, name: e.target.value } : current) })} /></label>
        {'yearId' in item && <label>Academic year<select value={item.yearId} onChange={(e) => setCalendar({ ...calendar, [kind]: calendar[kind].map((current) => current.id === item.id ? { ...current, yearId: e.target.value } : current) })}>
          <option value="">Choose year</option>{calendar.years.map((year) => <option value={year.id} key={year.id}>{year.name || 'Unnamed year'}</option>)}
        </select></label>}
        <label>Start date<input type="date" required value={item.start} onChange={(e) => setCalendar({ ...calendar, [kind]: calendar[kind].map((current) => current.id === item.id ? { ...current, start: e.target.value } : current) })} /></label>
        <label>End date<input type="date" required value={item.end} onChange={(e) => setCalendar({ ...calendar, [kind]: calendar[kind].map((current) => current.id === item.id ? { ...current, end: e.target.value } : current) })} /></label>
        <button type="button" className="text-button danger" onClick={() => setCalendar({ ...calendar, [kind]: calendar[kind].filter((current) => current.id !== item.id) })}>Remove {item.name || 'range'}</button>
        </div>
        {kind === 'years' && <fieldset><legend>{item.name || 'Academic year'} teaching week</legend>
          <WeekSettings value={calendar.years.find((year) => year.id === item.id)?.week} onChange={(week) => setCalendar({ ...calendar, years: calendar.years.map((year) => year.id === item.id ? { ...year, week } : year) })} />
        </fieldset>}
        {kind === 'terms' && <fieldset><legend>{item.name || 'Term'} teaching week</legend>
          <WeekSettings value={calendar.terms.find((term) => term.id === item.id)?.week}
            inherited={calendar.years.find((year) => year.id === calendar.terms.find((term) => term.id === item.id)?.yearId)?.week ?? DEFAULT_TEACHING_WEEK}
            onChange={(week) => setCalendar({ ...calendar, terms: calendar.terms.map((term) => term.id === item.id ? { ...term, week } : term) })} />
        </fieldset>}
      </div>)}
      <button type="button" className="btn secondary" disabled={kind !== 'years' && !calendar.years.length}
        onClick={() => {
          const item = { id: crypto.randomUUID(), name: '', start: '', end: '' };
          if (kind === 'years') setCalendar({ ...calendar, years: [...calendar.years, item] });
          else setCalendar({ ...calendar, [kind]: [...calendar[kind], { ...item, yearId: calendar.years[0].id }] });
        }}>Add {kind === 'years' ? 'academic year' : kind === 'terms' ? 'term' : 'holiday'}</button>
    </fieldset>)}
    {calendar.terms.length > 0 && <fieldset disabled={busy}><legend>Apply a teaching week to multiple terms</legend>
      <p className="small muted">Select one or more terms. Applying updates the form; Save calendar persists the changes after checking existing lessons.</p>
      <div className="teaching-week-days">{calendar.terms.map((term) => <label className="checkbox" key={term.id}><input type="checkbox"
        checked={selectedTerms.includes(term.id)} onChange={(event) => setSelectedTerms(event.target.checked ? [...selectedTerms, term.id] : selectedTerms.filter((id) => id !== term.id))} />
        {calendar.years.find((year) => year.id === term.yearId)?.name} / {term.name || 'Unnamed term'}</label>)}</div>
      <WeekSettings value={bulkWeek} onChange={setBulkWeek} />
      <div className="form-actions"><button type="button" className="btn secondary" disabled={!selectedTerms.some((id) => calendar.terms.some((term) => term.id === id))}
        onClick={() => setCalendar({ ...calendar, terms: calendar.terms.map((term) => selectedTerms.includes(term.id) ? { ...term, week: bulkWeek } : term) })}>Apply week to selected terms</button>
        <button type="button" className="btn secondary" disabled={!selectedTerms.length}
          onClick={() => setCalendar({ ...calendar, terms: calendar.terms.map((term) => selectedTerms.includes(term.id) ? { ...term, week: undefined } : term) })}>Use year defaults for selected terms</button></div>
    </fieldset>}
    <button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save calendar'}</button>
    <p className="small muted">Calendar edits that would change an existing series are blocked. Reschedule or delete affected lessons first; cancel their live meetings before editing.</p>
    {data.allowScheduleReset && <div className="alert"><h3>Development reset</h3><p>This is an explicit, destructive development-only action. No schedules are automatically deleted during deployment.</p><button className="btn secondary danger" disabled={busy} onClick={() => void reset()}>Clear development lesson schedules</button></div>}
    {error && <p role="alert" className="alert error">{error}</p>}
    {notice && <p role="status" className="alert success">{notice}</p>}
  </section>;
}
