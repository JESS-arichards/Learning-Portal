import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Files, Upload, Video } from 'lucide-react';
import { linkSchema, type Lesson, type Snapshot, type User, type LinkResource } from '../../shared/learning';
import { errorMessage } from './api';
import { Modal } from './navigation/Modal';
import { LessonTeams } from './LessonTeams';
import type { StagedResources } from './lessonSetup';

export function LessonResources({ lesson, links, resources, data, user, disabled, onLinksChange, onResourcesChange, onBusyChange, refresh }: {
  lesson: Lesson; links: LinkResource[]; resources: StagedResources; data: Snapshot; user: User; disabled: boolean;
  onLinksChange: (links: LinkResource[]) => void; onResourcesChange: (resources: StagedResources) => void;
  onBusyChange: (busy: boolean) => void; refresh: () => Promise<void>;
}) {
  const [dialog, setDialog] = useState<'files' | 'link' | 'teams' | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [meetingBusy, setMeetingBusy] = useState(false);
  function addLink(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const input = linkSchema.parse({ id: editId ?? crypto.randomUUID(),
        kind: links.find((item) => item.id === editId)?.kind ?? 'link', name, url });
      if (!editId && links.length >= 30) throw new Error('A lesson can have at most 30 links.');
      onLinksChange(editId ? links.map((link) => link.id === editId ? input : link) : [...links, input]);
      setName(''); setUrl(''); setEditId(null);
    } catch (error) { setError(errorMessage(error)); }
  }
  const existingFiles = lesson.files.filter((file) => !resources.removedFileIds.includes(file.id));
  const fileCount = existingFiles.length + resources.files.length;
  return <section className="file-editor" aria-label="Lesson resources">
    <h3>Lesson resources</h3>
    <p className="muted">Choose files, add links and configure Teams before saving. Changes are applied only when you click Save lesson.</p>
    <div className="form-actions">
      <button type="button" className="btn secondary" disabled={disabled || meetingBusy} onClick={() => { setDialog('files'); setError(''); }}><Files size={18} /> Files</button>
      <button type="button" className="btn secondary" disabled={disabled || meetingBusy} onClick={() => { setDialog('link'); setError(''); }}><ExternalLink size={18} /> External Link</button>
      <button type="button" className="btn secondary" disabled={disabled || meetingBusy} onClick={() => { setDialog('teams'); setError(''); }}><Video size={18} /> Teams</button>
    </div>
    <p className="small muted">{fileCount} files &middot; {links.length} links{resources.teams ? ` · Teams: ${resources.teams.title} (pending Save lesson)` : ''}</p>
    {dialog && createPortal(<Modal title={dialog === 'files' ? 'Lesson files' : dialog === 'link' ? 'External link' : 'Teams meeting'} className="portal-support-dialog lesson-resource-dialog"
      onClose={() => { if (!disabled && !meetingBusy) setDialog(null); }}>
      {dialog === 'teams' ? <LessonTeams lesson={lesson} data={data} user={user} refresh={refresh} staged={resources.teams}
        onStage={(teams) => { onResourcesChange({ ...resources, teams }); setDialog(null); }}
        onBusyChange={(value) => { setMeetingBusy(value); onBusyChange(value); }} />
        : dialog === 'files' ? <>
          <p>Choose lesson files to upload when you save. Up to 20 files, 25 MB each. Files are stored privately and downloaded only by authorised users.</p>
          <label className="upload-field"><Upload size={20} /> Choose lesson files<input type="file" multiple disabled={disabled || fileCount >= 20}
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.mp3,.mp4"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []); event.target.value = ''; setError('');
              if (!files.length) return;
              if (fileCount + files.length > 20) { setError('A lesson can have at most 20 files.'); return; }
              if (files.some((file) => file.size > 25 * 1024 * 1024)) { setError('Each file must be no larger than 25 MB.'); return; }
              if (files.some((file) => !/\.(pdf|docx?|pptx?|xlsx?|txt|csv|png|jpe?g|gif|webp|mp3|mp4)$/i.test(file.name))) {
                setError('Supported files: PDF, Office documents, text/CSV, images, MP3 and MP4.'); return;
              }
              onResourcesChange({ ...resources, files: [...resources.files, ...files.map((file) => ({ id: crypto.randomUUID(), file }))] });
            }} /></label>
          {fileCount === 0 && <p className="muted">No files selected.</p>}
          {existingFiles.map((file) => <div className="file-row" key={file.id}>
            <a href={`/api/lessons/${lesson.id}/files/${file.id}`}>{file.name}</a>
            <button type="button" className="text-button danger" disabled={disabled} onClick={() => onResourcesChange({ ...resources, removedFileIds: [...resources.removedFileIds, file.id] })}>Remove on save</button>
          </div>)}
          {resources.files.map((item) => <div className="file-row" key={item.id}><span>{item.file.name} <small>(pending upload)</small></span>
            <button type="button" className="text-button danger" disabled={disabled} onClick={() => onResourcesChange({ ...resources, files: resources.files.filter((file) => file.id !== item.id) })}>Remove</button>
          </div>)}
        </> : <>
          <form onSubmit={addLink}>
            <label>Resource name<input required maxLength={200} disabled={disabled} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>HTTPS URL<input required type="url" maxLength={2000} disabled={disabled} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label>
            <div className="form-actions"><button type="submit" className="btn primary" disabled={disabled || (!editId && links.length >= 30)}>{editId ? 'Apply link changes' : 'Add external link'}</button>
              {editId && <button type="button" className="btn secondary" disabled={disabled} onClick={() => { setEditId(null); setName(''); setUrl(''); }}>Cancel editing</button>}</div>
          </form>
          <p className="small muted">Links are attached to the lesson when Save lesson is clicked.</p>
          {links.map((link) => <div className="file-row" key={link.id}>
            <a href={link.url} target="_blank" rel="noopener noreferrer">{link.name}</a>
            <button type="button" className="text-button" disabled={disabled} onClick={() => { setEditId(link.id); setName(link.name); setUrl(link.url); }}>Edit</button>
            <button type="button" className="text-button danger" disabled={disabled} onClick={() => {
              onLinksChange(links.filter((item) => item.id !== link.id));
              if (editId === link.id) { setEditId(null); setName(''); setUrl(''); }
            }}>Remove</button>
          </div>)}
        </>}
      {error && <p role="alert" className="alert error">{error}</p>}
    </Modal>, document.body)}
  </section>;
}
