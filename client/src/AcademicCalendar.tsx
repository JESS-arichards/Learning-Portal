import { useState } from 'react';
import { academicCalendarSchema, EMPTY_CALENDAR, type AcademicCalendar as Calendar } from '../../shared/calendar';
import type { Snapshot } from '../../shared/learning';
import { api, errorMessage } from './api';

export function AcademicCalendar({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [calendar, setCalendar] = useState<Calendar>(data.calendar ?? EMPTY_CALENDAR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
    <p className="muted">Set academic years, terms and holidays before scheduling lessons. Teaching days are Monday-Friday. Date ranges include both endpoints; use the same start and end for a single-day holiday. Dates outside terms are not teaching dates.</p>
    {(['years', 'terms', 'holidays'] as const).map((kind) => <fieldset disabled={busy} key={kind}>
      <legend>{kind === 'years' ? 'Academic years' : kind === 'terms' ? 'Terms' : 'Holidays / closures'}</legend>
      {calendar[kind].map((item) => <div className="calendar-range" key={item.id}>
        <label>Name<input required maxLength={100} value={item.name} onChange={(e) => setCalendar({ ...calendar, [kind]: calendar[kind].map((current) => current.id === item.id ? { ...current, name: e.target.value } : current) })} /></label>
        {'yearId' in item && <label>Academic year<select value={item.yearId} onChange={(e) => setCalendar({ ...calendar, [kind]: calendar[kind].map((current) => current.id === item.id ? { ...current, yearId: e.target.value } : current) })}>
          <option value="">Choose year</option>{calendar.years.map((year) => <option value={year.id} key={year.id}>{year.name || 'Unnamed year'}</option>)}
        </select></label>}
        <label>Start date<input type="date" required value={item.start} onChange={(e) => setCalendar({ ...calendar, [kind]: calendar[kind].map((current) => current.id === item.id ? { ...current, start: e.target.value } : current) })} /></label>
        <label>End date<input type="date" required value={item.end} onChange={(e) => setCalendar({ ...calendar, [kind]: calendar[kind].map((current) => current.id === item.id ? { ...current, end: e.target.value } : current) })} /></label>
        <button type="button" className="text-button danger" onClick={() => setCalendar({ ...calendar, [kind]: calendar[kind].filter((current) => current.id !== item.id) })}>Remove {item.name || 'range'}</button>
      </div>)}
      <button type="button" className="btn secondary" disabled={kind !== 'years' && !calendar.years.length}
        onClick={() => {
          const item = { id: crypto.randomUUID(), name: '', start: '', end: '' };
          if (kind === 'years') setCalendar({ ...calendar, years: [...calendar.years, item] });
          else setCalendar({ ...calendar, [kind]: [...calendar[kind], { ...item, yearId: calendar.years[0].id }] });
        }}>Add {kind === 'years' ? 'academic year' : kind === 'terms' ? 'term' : 'holiday'}</button>
    </fieldset>)}
    <button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save calendar'}</button>
    <p className="small muted">Calendar edits that would change an existing series are blocked. Reschedule or delete affected lessons first; cancel their live meetings before editing.</p>
    {data.allowScheduleReset && <div className="alert"><h3>Development reset</h3><p>This is an explicit, destructive development-only action. No schedules are automatically deleted during deployment.</p><button className="btn secondary danger" disabled={busy} onClick={() => void reset()}>Clear development lesson schedules</button></div>}
    {error && <p role="alert" className="alert error">{error}</p>}
    {notice && <p role="status" className="alert success">{notice}</p>}
  </section>;
}
