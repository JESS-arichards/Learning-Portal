import { useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Files, Upload, Video } from 'lucide-react';
import { linkSchema, type Lesson, type Snapshot, type User, type LinkResource } from '../../shared/learning';
import { api, errorMessage, fileBody } from './api';
import { Modal } from './navigation/Modal';
import { LessonTeams } from './LessonTeams';

export function LessonResources({ lesson, data, user, disabled, onChange, onBusyChange, refresh }: {
  lesson?: Lesson; data: Snapshot; user: User; disabled: boolean; onChange: (lesson: Lesson) => void;
  onBusyChange: (busy: boolean) => void; refresh: () => Promise<void>;
}) {
  const [dialog, setDialog] = useState<'files' | 'link' | 'teams' | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const pendingLink = useRef<LinkResource | null>(null);
  function changeBusy(value: boolean) { working.current = value; setBusy(value); onBusyChange(value); }
  async function run(work: () => Promise<void>, success: string) {
    if (working.current) return;
    changeBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(success); await refresh(); }
    catch (error) { setError(errorMessage(error)); }
    finally { changeBusy(false); }
  }
  async function addLink(event: FormEvent) {
    event.preventDefault();
    if (!lesson) return;
    await run(async () => {
      const input = linkSchema.parse({ id: editId ?? (pendingLink.current?.name === name.trim() && pendingLink.current.url === url.trim() ? pendingLink.current.id : crypto.randomUUID()),
        kind: lesson.links.find((item) => item.id === editId)?.kind ?? 'link', name, url });
      if (!pendingLink.current || pendingLink.current.name !== input.name || pendingLink.current.url !== input.url) pendingLink.current = input;
      onChange(await api<Lesson>(`/lessons/${lesson.id}/links${editId ? `/${editId}` : ''}`, editId ? 'PUT' : 'POST', pendingLink.current));
      pendingLink.current = null; setName(''); setUrl(''); setEditId(null);
    }, 'Resource link saved. Students can open it from the lesson.');
  }
  return <section className="file-editor" aria-label="Lesson resources">
    <h3>Lesson resources</h3>
    <p className="muted">{lesson ? 'Resources are saved immediately, independently of lesson details.' : 'Save the lesson before attaching resources or creating meetings.'}</p>
    <div className="form-actions">
      <button type="button" className="btn secondary" disabled={disabled || busy} onClick={() => { setDialog('files'); setError(''); setNotice(''); }}><Files size={18} /> Files</button>
      <button type="button" className="btn secondary" disabled={disabled || busy} onClick={() => { setDialog('link'); setError(''); setNotice(''); }}><ExternalLink size={18} /> External Link</button>
      <button type="button" className="btn secondary" disabled={disabled || busy} onClick={() => { setDialog('teams'); setError(''); setNotice(''); }}><Video size={18} /> Teams</button>
    </div>
    {dialog && createPortal(<Modal title={dialog === 'files' ? 'Lesson files' : dialog === 'link' ? 'External link' : 'Teams meeting'} className="portal-support-dialog lesson-resource-dialog"
      onClose={() => { if (!working.current) setDialog(null); }}>
      {!lesson ? <p className="alert">Save the lesson first, then open this dialog to add resources.</p>
        : dialog === 'teams' ? <LessonTeams lesson={lesson} data={data} user={user} refresh={refresh} onBusyChange={changeBusy} />
        : dialog === 'files' ? <>
          <p>Upload lesson files. Students and their authorised parents can download them from this lesson. Up to 20 files, 25 MB each; images are optimized before saving.</p>
          <label className="upload-field"><Upload size={20} /> Upload a lesson file<input type="file" disabled={busy || lesson.files.length >= 20}
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.mp3,.mp4"
            onChange={(event) => {
              const file = event.target.files?.[0]; event.target.value = '';
              if (file) void run(async () => {
                await api(`/lessons/${lesson.id}/files`, 'POST', fileBody(file));
                const snapshot = await api<Snapshot>('/learning');
                const updated = snapshot.lessons.find((item) => item.id === lesson.id);
                if (!updated) throw new Error('The saved lesson could not be reloaded. Close the editor and reload the page.');
                onChange(updated);
              }, 'File uploaded and available to students.');
            }} /></label>
          {lesson.files.length === 0 && <p className="muted">No files uploaded yet.</p>}
          {lesson.files.map((file) => <div className="file-row" key={file.id}>
            <a href={`/api/lessons/${lesson.id}/files/${file.id}`}>{file.name}</a>
            <button type="button" className="text-button danger" disabled={busy} onClick={() => {
              if (window.confirm('Remove this lesson file?')) void run(async () => {
                await api(`/lessons/${lesson.id}/files/${file.id}`, 'DELETE');
                onChange({ ...lesson, files: lesson.files.filter((item) => item.id !== file.id) });
              }, 'File removed.');
            }}>Remove</button>
          </div>)}
        </> : <>
          <form onSubmit={(event) => void addLink(event)}>
            <label>Resource name<input required maxLength={200} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>HTTPS URL<input required type="url" maxLength={2000} disabled={busy} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label>
            <div className="form-actions"><button type="submit" className="btn primary" disabled={busy || (!editId && lesson.links.length >= 30)}>{busy ? 'Saving...' : editId ? 'Save link changes' : 'Add external link'}</button>
              {editId && <button type="button" className="btn secondary" disabled={busy} onClick={() => { setEditId(null); setName(''); setUrl(''); pendingLink.current = null; }}>Cancel editing</button>}</div>
          </form>
          {lesson.links.map((link) => <div className="file-row" key={link.id}>
            <a href={link.url} target="_blank" rel="noopener noreferrer">{link.name}</a>
            <button type="button" className="text-button" disabled={busy} onClick={() => { setEditId(link.id); setName(link.name); setUrl(link.url); pendingLink.current = null; }}>Edit</button>
            <button type="button" className="text-button danger" disabled={busy} onClick={() => {
              if (window.confirm('Remove this resource link?')) void run(async () => {
                onChange(await api<Lesson>(`/lessons/${lesson.id}/links/${link.id}`, 'DELETE'));
                if (editId === link.id) { setEditId(null); setName(''); setUrl(''); pendingLink.current = null; }
              }, 'Link removed.');
            }}>Remove</button>
          </div>)}
        </>}
      {busy && dialog !== 'teams' && <p role="status">Saving resource. Keep this dialog open.</p>}
      {error && <p role="alert" className="alert error">{error}</p>}
      {notice && <p role="status" className="alert success">{notice}</p>}
    </Modal>, document.body)}
  </section>;
}
