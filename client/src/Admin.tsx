import { useState, type FormEvent } from 'react';
import { Clock3, FileUp, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { DAYS, addPeriods, dayStructureSchema, periodTypeId, type DaySlot, type PeriodType, type Snapshot, type ImportPreview } from '../../shared/learning';
import { api, errorMessage, fileBody } from './api';

function DayStructure({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [slots, setSlots] = useState(data.slots);
  const [periodTypes, setPeriodTypes] = useState(data.periodTypes);
  const [day, setDay] = useState(0);
  const [scope, setScope] = useState('day');
  const [selectedDays, setSelectedDays] = useState<number[]>([0]);
  const [period, setPeriod] = useState({ name: 'Lesson', typeId: data.periodTypes[0].id, start: '08:00', end: '09:00' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function change(id: string, patch: Partial<DaySlot>) { setSlots(slots.map((s) => s.id === id ? { ...s, ...patch } : s)); setNotice(''); }
  function changeType(id: string, patch: Partial<PeriodType>) {
    setPeriodTypes(periodTypes.map((type) => type.id === id ? { ...type, ...patch } : type));
    const kind = patch.kind;
    if (kind) setSlots(slots.map((slot) => periodTypeId(slot) === id ? { ...slot, kind } : slot));
    setNotice('');
  }
  function addPeriod() {
    setError(''); setNotice('');
    try {
      const type = periodTypes.find((type) => type.id === period.typeId);
      if (!type) throw new Error('Choose a period type before adding a period.');
      const days = scope === 'week' ? [0, 1, 2, 3, 4] : scope === 'selected' ? selectedDays : [day];
      const next = addPeriods(slots, { ...period, kind: type.kind }, days, () => crypto.randomUUID());
      dayStructureSchema.parse({ slots: next, periodTypes });
      setSlots(next);
      setNotice(`Period added to ${days.map((index) => DAYS[index]).join(', ')}. Save whole week to apply.`);
    } catch (error) { setError(errorMessage(error)); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api('/admin/structure', 'PUT', dayStructureSchema.parse({ slots, periodTypes }));
      await refresh(); setNotice('Weekly day structure saved.');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">WEEKLY SCHEDULE</p><h2>Build the school day</h2></div><Clock3 size={24} /></div>
    <p className="muted">Set lesson periods and breaks for each day, in school local time. Each period is shared across classes. Periods used by lessons cannot be removed or changed to breaks.</p>
    <fieldset disabled={busy}>
      <legend>Period types</legend>
      <p className="muted">Manage the options shown in Type. Lesson types can have lessons scheduled; break types cannot. Changes are applied when you save the whole week.</p>
      {periodTypes.map((type) => <div key={type.id} className="structure-row">
        <label>Type name<input required maxLength={100} value={type.name} onChange={(e) => changeType(type.id, { name: e.target.value })} /></label>
        <label>Behaviour<select value={type.kind} onChange={(e) => changeType(type.id, { kind: e.target.value === 'break' ? 'break' : 'lesson' })}><option value="lesson">Lesson (schedulable)</option><option value="break">Break (not schedulable)</option></select></label>
        <button type="button" className="icon-button danger" aria-label={`Remove type ${type.name}`} disabled={periodTypes.length === 1 || slots.some((slot) => periodTypeId(slot) === type.id)} onClick={() => { setPeriodTypes(periodTypes.filter((item) => item.id !== type.id)); if (period.typeId === type.id) setPeriod({ ...period, typeId: '' }); setNotice(''); }}><Trash2 size={17} /></button>
      </div>)}
      <p className="muted">Types in use cannot be removed. Change those periods to another type first.</p>
      <button type="button" className="btn secondary" disabled={periodTypes.length >= 30} onClick={() => { setPeriodTypes([...periodTypes, { id: crypto.randomUUID(), name: '', kind: 'lesson' }]); setNotice(''); }}><Plus size={16} /> Add type</button>
    </fieldset>
    <div className="day-tabs">{DAYS.map((d, i) => <button key={d} aria-pressed={day === i} className={day === i ? 'active' : ''} onClick={() => setDay(i)}>{d.slice(0, 3)}</button>)}</div>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
      <h3>{DAYS[day]}</h3>
      {slots.filter((s) => s.day === day).map((slot) => <div key={slot.id} className="structure-row">
        <label>Period name<input required maxLength={100} value={slot.name} onChange={(e) => change(slot.id, { name: e.target.value })} /></label>
        <label>Type<select value={periodTypeId(slot)} onChange={(e) => { const type = periodTypes.find((type) => type.id === e.target.value); if (type) change(slot.id, { typeId: type.id, kind: type.kind }); }}>{periodTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
        <label>Start<input required type="time" value={slot.start} onChange={(e) => change(slot.id, { start: e.target.value })} /></label>
        <label>End<input required type="time" value={slot.end} onChange={(e) => change(slot.id, { end: e.target.value })} /></label>
        <button type="button" className="icon-button danger" aria-label={`Remove ${slot.name}`} onClick={() => { setSlots(slots.filter((s) => s.id !== slot.id)); setNotice(''); }}><Trash2 size={17} /></button>
      </div>)}
      {!slots.some((s) => s.day === day) && <p className="alert">No periods on this day. Add a lesson or break to get started.</p>}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Add a period</legend>
        <div className="structure-row">
          <label>New period name<input maxLength={100} value={period.name} onChange={(e) => setPeriod({ ...period, name: e.target.value })} /></label>
          <label>New period type<select value={period.typeId} onChange={(e) => setPeriod({ ...period, typeId: e.target.value })}><option value="" disabled>Choose type</option>{periodTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
          <label>New period start<input type="time" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} /></label>
          <label>New period end<input type="time" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} /></label>
        </div>
        <label>Apply period to<select value={scope} onChange={(e) => setScope(e.target.value)}><option value="day">Current day ({DAYS[day]})</option><option value="selected">Selected days</option><option value="week">All week (Monday-Friday)</option></select></label>
        {scope === 'selected' && <div className="day-tabs" role="group" aria-label="Period days">{DAYS.map((name, index) => <label key={name}><input type="checkbox" checked={selectedDays.includes(index)} onChange={(e) => setSelectedDays(e.target.checked ? [...selectedDays, index] : selectedDays.filter((value) => value !== index))} />{name}</label>)}</div>}
        <p className="muted">Adds the same name, type and times to each chosen day. Existing periods are kept. Overlaps are rejected for the entire selection.</p>
        <button type="button" className="btn secondary" disabled={slots.length >= 140} onClick={addPeriod}><Plus size={16} /> Add period</button>
      </fieldset>
      <div className="form-actions"><button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save whole week'}</button><button type="button" className="text-button" disabled={busy} onClick={() => { setSlots(data.slots); setPeriodTypes(data.periodTypes); setPeriod({ ...period, typeId: data.periodTypes[0].id }); setError(''); setNotice('Unsaved edits discarded.'); }}>Discard edits</button></div>
    </form>
    {error && <p role="alert" className="alert error">{error}</p>}
    {notice && <p role="status" className="alert success">{notice}</p>}
  </section>;
}
function ClassImport({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function run(commit: boolean) {
    if (!file) return;
    if (commit && !window.confirm('Import these classes? Rosters for included classes will be replaced; other classes are unchanged.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (commit) {
        const result = await api<{ rows: number; classes: number }>('/admin/classes/import', 'POST', fileBody(file));
        setPreview(null); await refresh(); setNotice(`Imported ${result.rows} rows into ${result.classes} classes.`);
      } else setPreview(await api<ImportPreview>('/admin/classes/preview', 'POST', fileBody(file)));
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function removeClass(id: string) {
    if (!window.confirm('Delete this class? Remove its lessons first.')) return;
    setBusy(true); setError(''); setNotice('');
    try { await api(`/admin/classes/${id}`, 'DELETE'); await refresh(); setNotice('Class deleted.'); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">CLASS DIRECTORY</p><h2>Import your classes</h2></div><FileUp size={24} /></div>
    <p className="muted">Upload one row per class / teacher / student. Teachers must match active central Staff accounts. Students are enrolled by email and do not need an account yet. Parent uploads and child links are managed only in Applications Portal. Class Name + Year Group + Division identifies a class; importing it replaces its teacher and student roster, while keeping its lessons.</p>
    <a className="text-button" href="/api/admin/template.csv">Download CSV template</a>
    <label className="upload-field">Class data (.csv, maximum 2 MB / 5,000 rows)<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setNotice(''); setError(''); }} /></label>
    <div className="form-actions"><button className="btn secondary" disabled={!file || busy} onClick={() => void run(false)}>Validate &amp; preview</button>
      {preview && <button className="btn primary" disabled={busy || preview.errors.length > 0} onClick={() => void run(true)}>{busy ? 'Importing...' : `Import ${preview.classes.length} classes`}</button>}</div>
    {preview && <div className="import-preview">
      <h3>Preview: {preview.rowCount} rows &middot; {preview.classes.length} classes</h3>
      {preview.errors.length ? <div className="alert error" role="alert"><strong>{preview.errors.length} errors. Nothing has been imported.</strong><ul>{preview.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul></div> : <p className="alert success">Validation passed. Review the class totals and any pending student enrolments before importing. Nothing has been imported yet.</p>}
      {preview.warnings.length > 0 && <div className="alert" role="status"><strong>{preview.warnings.length} pending student enrolments. These do not prevent import.</strong><ul>{preview.warnings.map((w, i) => <li key={i}>Row {w.row}: {w.message}</li>)}</ul></div>}
      <div className="table-scroll"><table><thead><tr><th>Class</th><th>Year</th><th>Division</th><th>Teachers</th><th>Students</th></tr></thead><tbody>{preview.classes.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.yearGroup}</td><td>{c.division}</td><td>{c.teachers.length}</td><td>{c.students.length}</td></tr>)}</tbody></table></div>
    </div>}
    {error && <p role="alert" className="alert error">{error}</p>}
    {notice && <p role="status" className="alert success">{notice}</p>}
    <h3>Current classes ({data.classes.length})</h3>
    <div className="table-scroll"><table><thead><tr><th>Class / year / division</th><th>Teacher</th><th>Students</th><th>Actions</th></tr></thead><tbody>{data.classes.map((c) => <tr key={c.id}><td><strong>{c.name}</strong><br /><span className="muted">{c.yearGroup} / {c.division}</span></td><td>{c.teachers.map((t) => t.displayName).join(', ')}</td><td>{c.students.length}</td><td><button className="text-button danger" disabled={busy} onClick={() => void removeClass(c.id)}>Delete</button></td></tr>)}</tbody></table></div>
  </section>;
}
export function Admin({ data, refresh, portalUrl }: { data: Snapshot; refresh: () => Promise<void>; portalUrl: string | null }) {
  const [tab, setTab] = useState('classes');
  return <>
    <div className="page-heading"><div><p className="eyebrow">LEARNING PORTAL ADMINISTRATION</p><h1>Set learning in motion</h1><p className="muted">Manage classes and shape the school week.</p></div><div className="heading-icon"><ShieldCheck /></div></div>
    <div className="admin-note panel"><ShieldCheck size={20} /><p>User accounts, activation, Learn Admin roles, branding and parent links are managed centrally in Applications Portal.{portalUrl && <> <a href={new URL('/admin/users', portalUrl).href} target="_blank" rel="noopener noreferrer">Open central administration</a> (Full Admin required).</>}</p></div>
    <div className="segmented"><button className={tab === 'classes' ? 'selected' : ''} onClick={() => setTab('classes')}>Class imports</button><button className={tab === 'structure' ? 'selected' : ''} onClick={() => setTab('structure')}>Day structure</button></div>
    {tab === 'classes' ? <ClassImport data={data} refresh={refresh} /> : <DayStructure data={data} refresh={refresh} />}
  </>;
}
