import { useState } from 'react';
import { FileUp, Plus, ShieldCheck } from 'lucide-react';
import type { Snapshot, ImportPreview, LearningClass } from '../../shared/learning';
import { api, errorMessage, fileBody } from './api';
import { DayStructure } from './DayStructure';
import { ClassEditor } from './ClassEditor';
import { AcademicCalendar } from './AcademicCalendar';
import { LessonTypes } from './LessonTypes';
function ClassImport({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [editor, setEditor] = useState<{ classroom: LearningClass | null } | null>(null);
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
    <div className="section-heading"><div><p className="eyebrow">CLASS DIRECTORY</p><h2>Manage your classes</h2></div><button type="button" className="btn secondary" disabled={busy} onClick={() => setEditor({ classroom: null })}><Plus size={16} /> Create class</button></div>
    <p className="muted">Create a class manually, edit an existing class below, or upload a CSV.</p>
    <h3><FileUp size={18} /> Import classes</h3>
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
    <div className="table-scroll" role="region" aria-label="Current classes" tabIndex={0}><table className="current-classes"><thead><tr><th>Class / year / division</th><th>Teacher</th><th>Students</th><th>Actions</th></tr></thead><tbody>{data.classes.map((c) => <tr key={c.id}><td><strong>{c.name}</strong><br /><span className="muted">{c.yearGroup} / {c.division}</span></td><td>{c.teachers.map((t) => t.displayName).join(', ')}</td><td>{c.students.length}</td><td><div className="class-actions"><button className="text-button" disabled={busy} onClick={() => setEditor({ classroom: c })} aria-label={`Edit class ${c.name}`}>Edit</button><button className="text-button danger" disabled={busy} onClick={() => void removeClass(c.id)}>Delete</button></div></td></tr>)}</tbody></table></div>
    {editor && <ClassEditor classroom={editor.classroom} onClose={() => setEditor(null)} onSaved={async () => { await refresh(); setPreview(null); setNotice('Class saved.'); }} />}
  </section>;
}
export function Admin({ data, refresh, portalUrl }: { data: Snapshot; refresh: () => Promise<void>; portalUrl: string | null }) {
  const [tab, setTab] = useState('classes');
  return <>
    <div className="page-heading"><div><p className="eyebrow">LEARNING PORTAL ADMINISTRATION</p><h1>Set learning in motion</h1><p className="muted">Manage classes, lesson types and the school week.</p></div><div className="heading-icon"><ShieldCheck /></div></div>
    <div className="admin-note panel"><ShieldCheck size={20} /><p>User accounts, activation, Learn Admin roles, branding and parent links are managed centrally in Applications Portal.{portalUrl && <> <a href={new URL('/admin/users', portalUrl).href} target="_blank" rel="noopener noreferrer">Open central administration</a> (Full Admin required).</>}</p></div>
    <div className="segmented"><button className={tab === 'classes' ? 'selected' : ''} onClick={() => setTab('classes')}>Classes</button><button className={tab === 'structure' ? 'selected' : ''} onClick={() => setTab('structure')}>Day structure</button><button className={tab === 'calendar' ? 'selected' : ''} onClick={() => setTab('calendar')}>Academic calendar</button><button className={tab === 'lesson-types' ? 'selected' : ''} onClick={() => setTab('lesson-types')}>Lesson types</button></div>
    {tab === 'classes' ? <ClassImport data={data} refresh={refresh} /> : tab === 'calendar' ? <AcademicCalendar data={data} refresh={refresh} /> : tab === 'lesson-types' ? <LessonTypes data={data} refresh={refresh} /> : <DayStructure data={data} refresh={refresh} />}
  </>;
}
