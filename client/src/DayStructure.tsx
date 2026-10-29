import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Clock3, LockKeyhole, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { DAYS, addPeriods, dayStructureSchema, periodTypeId, periodTypesSchema, validateStructureChange, type DaySlot, type PeriodType, type Snapshot } from '../../shared/learning';
import { api, errorMessage } from './api';
import { Modal } from './navigation/Modal';

type Structure = Pick<Snapshot, 'slots' | 'periodTypes'>;

function PeriodDays({ days, onChange, disabled }: { days: number[]; onChange: (days: number[]) => void; disabled: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const summary = days.length === 5 && [0, 1, 2, 3, 4].every((day) => days.includes(day))
    ? 'Monday-Friday' : days.length ? DAYS.filter((_, day) => days.includes(day)).map((name) => name.slice(0, 3)).join(', ') : 'Choose days';
  return <div className="period-days-field">
    <span id="period-days-label">Days</span>
    <details className="period-days" ref={ref} onKeyDown={(event) => {
      if (event.key === 'Escape' && ref.current) {
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
        event.stopPropagation();
      }
    }}>
      <summary aria-labelledby="period-days-label period-days-value" aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault(); }}>
        <span id="period-days-value">{summary}</span><ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="period-days-options" role="group" aria-label="Period days">
        <button type="button" className="text-button" disabled={disabled} onClick={() => onChange([0, 1, 2, 3, 4])}>All week (Monday-Friday)</button>
        {DAYS.map((name, day) => <label className="checkbox" key={name}>
          <input type="checkbox" disabled={disabled} checked={days.includes(day)} onChange={(event) => onChange(event.target.checked ? [...days, day] : days.filter((value) => value !== day))} />{name}
        </label>)}
      </div>
    </details>
  </div>;
}

export function DayStructure({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [slots, setSlots] = useState(data.slots);
  const [periodTypes, setPeriodTypes] = useState(data.periodTypes);
  const [saved, setSaved] = useState<Structure>({ slots: data.slots, periodTypes: data.periodTypes });
  const [day, setDay] = useState(0);
  const [days, setDays] = useState<number[]>([0]);
  const [period, setPeriod] = useState({ name: '', typeId: data.periodTypes[0].id, start: '08:00', end: '09:00' });
  const [typeDraft, setTypeDraft] = useState<PeriodType | null>(null);
  const [typeError, setTypeError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const saving = useRef(false);
  const used = new Set(data.lessons.flatMap((lesson) => [...lesson.slotIds, ...(lesson.occurrences ?? []).map((item) => item.slotId)]));
  const lockedType = (id: string) => saved.slots.some((slot) => used.has(slot.id) && periodTypeId(slot) === id);
  const dirty = JSON.stringify(slots) !== JSON.stringify(saved.slots);
  function change(id: string, patch: Partial<DaySlot>) {
    setSlots(slots.map((slot) => slot.id === id ? { ...slot, ...patch } : slot));
    setNotice('');
  }
  async function savePeriods(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      let nextSlots = slots;
      if (period.name.trim()) {
        const type = periodTypes.find((type) => type.id === period.typeId);
        if (!type) throw new Error('Choose a period type.');
        nextSlots = addPeriods(slots, { ...period, kind: type.kind }, days, () => crypto.randomUUID());
      } else if (!dirty) throw new Error('Enter a period name to add a period, or edit an existing period before saving.');
      const next = dayStructureSchema.parse({ slots: nextSlots, periodTypes });
      validateStructureChange({ ...data, ...saved }, next);
      const result = await api<Structure>('/admin/structure', 'PUT', next);
      setSlots(result.slots); setPeriodTypes(result.periodTypes); setSaved(result);
      setPeriod({ ...period, name: '' });
      await refresh();
      setNotice('Periods saved.');
    } catch (error) { setError(errorMessage(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  async function persistTypes(types: PeriodType[]) {
    const result = await api<Structure>('/admin/period-types', 'PUT', periodTypesSchema.parse(types));
    // Keep unsaved period edits; type saves only commit the saved structure.
    setSlots((current) => current.map((slot) => {
      const type = result.periodTypes.find((type) => type.id === periodTypeId(slot));
      return type ? { ...slot, kind: type.kind } : slot;
    }));
    setPeriodTypes(result.periodTypes); setSaved(result);
    if (!result.periodTypes.some((type) => type.id === period.typeId)) setPeriod({ ...period, typeId: result.periodTypes[0].id });
    await refresh();
  }
  async function saveType(event: FormEvent) {
    event.preventDefault();
    if (!typeDraft || saving.current) return;
    saving.current = true; setBusy(true); setTypeError(''); setNotice(''); setError('');
    try {
      const types = periodTypes.some((type) => type.id === typeDraft.id)
        ? periodTypes.map((type) => type.id === typeDraft.id ? typeDraft : type)
        : [...periodTypes, typeDraft];
      await persistTypes(types);
      setTypeDraft(null); setNotice('Period type saved.');
    } catch (error) { setTypeError(errorMessage(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  async function removeType(type: PeriodType) {
    if (saving.current || !window.confirm(`Delete period type "${type.name}"?`)) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await persistTypes(periodTypes.filter((item) => item.id !== type.id));
      setNotice('Period type deleted.');
    } catch (error) { setError(errorMessage(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">WEEKLY SCHEDULE</p><h2>Build the school day</h2></div><Clock3 size={24} /></div>
    <p className="muted">Set periods in school local time. Periods used by timetable lessons are locked against all edits and deletion. Remove or reschedule those lessons first.</p>
    <div className="section-heading"><h3>Period types</h3><button type="button" className="btn secondary" disabled={busy || periodTypes.length >= 30} onClick={() => {
      setTypeError(''); setTypeDraft({ id: crypto.randomUUID(), name: '', kind: 'lesson' });
    }}><Plus size={16} /> Add type</button></div>
    <ul className="period-types">
      {periodTypes.map((type) => <li key={type.id}>
        <div><strong>{type.name}</strong><small>{type.kind === 'lesson' ? 'Schedulable' : 'Not schedulable'}</small></div>
        <button type="button" className="icon-button" disabled={busy || lockedType(type.id)} aria-label={`Edit type ${type.name}`} onClick={() => { setTypeError(''); setTypeDraft({ ...type }); }}><Pencil size={16} /></button>
        <button type="button" className="icon-button danger" disabled={busy || periodTypes.length === 1 || [...slots, ...saved.slots].some((slot) => periodTypeId(slot) === type.id)} aria-label={`Remove type ${type.name}`} onClick={() => void removeType(type)}><Trash2 size={16} /></button>
      </li>)}
    </ul>
    <p className="muted small">Type changes save immediately. Types used by timetable lessons are locked; types used by any period cannot be deleted.</p>
    <div className="day-tabs">{DAYS.map((name, index) => <button key={name} aria-pressed={day === index} className={day === index ? 'active' : ''} disabled={busy} onClick={() => {
      setDay(index); if (days.length === 1 && days[0] === day) setDays([index]);
    }}>{name.slice(0, 3)}</button>)}</div>
    <form onSubmit={(event) => void savePeriods(event)}>
      <fieldset disabled={busy}>
        <legend>{DAYS[day]}</legend>
        {slots.filter((slot) => slot.day === day).sort((a, b) => a.start.localeCompare(b.start)).map((slot) => <div key={slot.id}>
          <div className="structure-row">
            <label>Period name<input required maxLength={100} disabled={used.has(slot.id)} value={slot.name} onChange={(event) => change(slot.id, { name: event.target.value })} /></label>
            <label>Type<select disabled={used.has(slot.id)} value={periodTypeId(slot)} onChange={(event) => {
              const type = periodTypes.find((type) => type.id === event.target.value);
              if (type) change(slot.id, { typeId: type.id, kind: type.kind });
            }}>{periodTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <label>Start<input required type="time" disabled={used.has(slot.id)} value={slot.start} onChange={(event) => change(slot.id, { start: event.target.value })} /></label>
            <label>End<input required type="time" disabled={used.has(slot.id)} value={slot.end} onChange={(event) => change(slot.id, { end: event.target.value })} /></label>
            <button type="button" className="icon-button danger" disabled={used.has(slot.id)} aria-label={`Remove ${slot.name}`} onClick={() => { setSlots(slots.filter((item) => item.id !== slot.id)); setNotice(''); }}><Trash2 size={17} /></button>
          </div>
          {used.has(slot.id) && <p className="small muted"><LockKeyhole size={14} /> Used by timetable lessons - locked.</p>}
        </div>)}
        {!slots.some((slot) => slot.day === day) && <p className="muted">No periods on this day.</p>}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Add a period / save edits</legend>
        <div className="structure-row period-add-row">
          <label>New period name<input maxLength={100} placeholder="Leave blank to save edits only" value={period.name} onChange={(event) => setPeriod({ ...period, name: event.target.value })} /></label>
          <label>New period type<select value={period.typeId} onChange={(event) => setPeriod({ ...period, typeId: event.target.value })}>{periodTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
          <label>New period start<input type="time" value={period.start} onChange={(event) => setPeriod({ ...period, start: event.target.value })} /></label>
          <label>New period end<input type="time" value={period.end} onChange={(event) => setPeriod({ ...period, end: event.target.value })} /></label>
          <PeriodDays days={days} onChange={setDays} disabled={busy} />
          <button type="submit" className="icon-button primary" aria-label="Save periods" title="Save new period and all pending period edits" disabled={!dirty && !period.name.trim()}><Save size={18} /></button>
        </div>
        <p className="small muted">Choose one or more days, then save. The save icon commits the new period and all pending edits across days together. Leave the new period name blank to save edits only. Overlaps are rejected without partial saves.</p>
      </fieldset>
      {dirty && <div className="form-actions"><span role="status">Unsaved period edits</span><button type="button" className="text-button" disabled={busy} onClick={() => { setSlots(saved.slots); setError(''); setNotice('Unsaved period edits discarded.'); }}>Discard edits</button></div>}
    </form>
    {error && <p role="alert" className="alert error">{error}</p>}
    {notice && <p role="status" className="alert success">{notice}</p>}
    {typeDraft && createPortal(<Modal title={periodTypes.some((type) => type.id === typeDraft.id) ? 'Edit period type' : 'Add period type'} className="portal-support-dialog" onClose={() => { if (!saving.current) setTypeDraft(null); }}>
      <form onSubmit={(event) => void saveType(event)}>
        <fieldset disabled={busy}>
          <label>Type name<input required maxLength={100} value={typeDraft.name} onChange={(event) => setTypeDraft({ ...typeDraft, name: event.target.value })} /></label>
          <label>Behaviour<select value={typeDraft.kind} onChange={(event) => setTypeDraft({ ...typeDraft, kind: event.target.value === 'break' ? 'break' : 'lesson' })}><option value="lesson">Lesson (schedulable)</option><option value="break">Break (not schedulable)</option></select></label>
          <div className="form-actions"><button type="submit" className="btn primary"><Save size={16} />{busy ? 'Saving...' : 'Save type'}</button><button type="button" className="btn secondary" onClick={() => setTypeDraft(null)}>Cancel</button></div>
        </fieldset>
        {typeError && <p role="alert" className="alert error">{typeError}</p>}
      </form>
    </Modal>, document.body)}
  </section>;
}
