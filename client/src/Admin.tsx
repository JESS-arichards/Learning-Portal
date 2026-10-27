import { useState, type FormEvent } from 'react';
import { Clock3, FileUp, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { DAYS, structureSchema, type DaySlot, type Snapshot, type ImportPreview } from '../../shared/learning';
import { api, errorMessage, fileBody } from './api';

function DayStructure({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [slots, setSlots] = useState(data.slots);
  const [day, setDay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function change(id: string, patch: Partial<DaySlot>) { setSlots(slots.map((s) => s.id === id ? { ...s, ...patch } : s)); setNotice(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api('/admin/structure', 'PUT', structureSchema.parse(slots));
      await refresh(); setNotice('Weekly day structure saved.');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">WEEKLY SCHEDULE</p><h2>Build the school day</h2></div><Clock3 size={24} /></div>
    <p className="muted">Set lesson periods and breaks for each day, in school local time. Each period is shared across classes. Periods used by lessons cannot be removed or changed to breaks.</p>
    <div className="day-tabs">{DAYS.map((d, i) => <button key={d} aria-pressed={day === i} className={day === i ? 'active' : ''} onClick={() => setDay(i)}>{d.slice(0, 3)}</button>)}</div>
    <form onSubmit={(event) => void submit(event)}>
      <h3>{DAYS[day]}</h3>
      {slots.filter((s) => s.day === day).map((slot) => <div key={slot.id} className="structure-row">
        <label>Period name<input required maxLength={100} value={slot.name} onChange={(e) => change(slot.id, { name: e.target.value })} /></label>
        <label>Type<select value={slot.kind} onChange={(e) => change(slot.id, { kind: e.target.value === 'break' ? 'break' : 'lesson' })}><option value="lesson">Lesson</option><option value="break">Break</option></select></label>
        <label>Start<input required type="time" value={slot.start} onChange={(e) => change(slot.id, { start: e.target.value })} /></label>
        <label>End<input required type="time" value={slot.end} onChange={(e) => change(slot.id, { end: e.target.value })} /></label>
        <button type="button" className="icon-button danger" aria-label={`Remove ${slot.name}`} onClick={() => { setSlots(slots.filter((s) => s.id !== slot.id)); setNotice(''); }}><Trash2 size={17} /></button>
      </div>)}
      {!slots.some((s) => s.day === day) && <p className="alert">No periods on this day. Add a lesson or break to get started.</p>}
      <div className="form-actions"><button type="button" className="btn secondary" disabled={busy || slots.length >= 140} onClick={() => { setSlots([...slots, { id: crypto.randomUUID(), day, name: 'Lesson', kind: 'lesson', start: '08:00', end: '09:00' }]); setNotice(''); }}><Plus size={16} /> Add period</button><button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save whole week'}</button><button type="button" className="text-button" disabled={busy} onClick={() => { setSlots(data.slots); setError(''); setNotice('Unsaved edits discarded.'); }}>Discard edits</button></div>
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
