import { DAYS, type DaySlot } from '../../shared/learning';
import { previewSchedule, EMPTY_CALENDAR, weekday, type Recurrence, type AcademicCalendar } from '../../shared/calendar';

export function LessonSchedule({ schedule, slotIds, slots, calendar, onChange }: {
  schedule: Recurrence; slotIds: string[]; slots: DaySlot[]; calendar?: AcademicCalendar;
  onChange: (schedule: Recurrence, slotIds: string[]) => void;
}) {
  let preview;
  let error = '';
  try { preview = previewSchedule(calendar ?? EMPTY_CALENDAR, slots, slotIds, schedule); }
  catch (value) { if (value instanceof Error) error = value.message; else throw value; }
  return <fieldset><legend>Dated lesson schedule</legend>
    <div className="calendar-range">
      <label>Start date<input type="date" required value={schedule.startDate} onChange={(e) => onChange({ ...schedule, startDate: e.target.value }, [])} /></label>
      <label>Repeat<select value={schedule.frequency} onChange={(e) => onChange({ ...schedule, frequency: e.target.value === 'daily' ? 'daily' : e.target.value === 'weekly' ? 'weekly' : 'once', count: 1 }, slotIds)}>
        <option value="once">One-off</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
      </select></label>
      {schedule.frequency !== 'once' && <label>Number of {schedule.frequency === 'daily' ? 'calendar days' : 'weeks'}<input type="number" required min={1} max={schedule.frequency === 'weekly' ? 53 : 366} value={schedule.count} onChange={(e) => onChange({ ...schedule, count: Number(e.target.value) }, slotIds)} /></label>}
    </div>
    <p className="small muted">Daily repeats use matching start/end times and period type in each weekday template. Weekends and holidays are skipped, not replaced. Every series stops at the end of its starting term.</p>
    <div className="slot-options">{slots.filter((slot) => slot.kind === 'lesson' && slot.day === weekday(schedule.startDate)).map((slot) => <label className="checkbox" key={slot.id}>
      <input type="checkbox" checked={slotIds.includes(slot.id)} onChange={(e) => onChange(schedule, e.target.checked ? [...slotIds, slot.id] : slotIds.filter((id) => id !== slot.id))} />
      <span>{DAYS[slot.day]} / {slot.name}<small>{slot.start} - {slot.end}</small></span>
    </label>)}</div>
    {error && <p role="status" className="alert">{error}</p>}
    {preview && <div className="alert success" role="status">
      <strong>{preview.occurrences.length} period occurrences. Actual final lesson date: {preview.actualEnd}.</strong>
      {preview.truncated && <p>Requested end date {preview.requestedEnd} goes beyond term end {preview.termEnd}. This series stops at term end; it does not continue into the next term.</p>}
      {preview.skipped.length > 0 && <details><summary>{preview.skipped.length} dates skipped (no extension)</summary><ul>{preview.skipped.map((item) => <li key={item.date}>{item.date}: {item.reason}</li>)}</ul></details>}
    </div>}
  </fieldset>;
}
