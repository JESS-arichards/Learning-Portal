import { useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Save, Trash2 } from 'lucide-react';
import { classInputSchema, type ClassInput, type ImportPreview, type LearningClass } from '../../shared/learning';
import { api, errorMessage } from './api';
import { Modal } from './navigation/Modal';

export function ClassEditor({ classroom, onClose, onSaved }: {
  classroom: LearningClass | null; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ClassInput>(() => ({
    name: classroom?.name ?? '', yearGroup: classroom?.yearGroup ?? '', division: classroom?.division ?? '',
    teachers: classroom?.teachers.map(({ email, displayName }) => ({ email, displayName })) ?? [{ displayName: '', email: '' }],
    students: classroom?.students.map(({ email, displayName }) => ({ email, displayName })) ?? [{ displayName: '', email: '' }],
  }));
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  function change(patch: Partial<ClassInput>) { setDraft({ ...draft, ...patch }); setPreview(null); setError(''); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const input = classInputSchema.parse(draft);
      if (!preview || preview.errors.length) {
        setPreview(await api<ImportPreview>('/admin/classes/validate', 'POST', input));
      } else {
        await api(classroom ? `/admin/classes/${classroom.id}` : '/admin/classes', classroom ? 'PUT' : 'POST', input);
        await onSaved();
        onClose();
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  return createPortal(<Modal title={classroom ? 'Edit class' : 'Create class'} onClose={() => { if (!saving.current) onClose(); }} className="portal-support-dialog">
    <p>Teachers must match active Applications Portal Staff accounts. Students are linked by email and can be added before their first sign-in. Saving replaces this class's roster and preserves its lessons and resources.</p>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
        <div className="class-details">
          <label>Class name<input required maxLength={200} value={draft.name} onChange={(event) => change({ name: event.target.value })} /></label>
          <label>Year group<input required maxLength={50} value={draft.yearGroup} onChange={(event) => change({ yearGroup: event.target.value })} /></label>
          <label>Division<input required maxLength={100} value={draft.division} onChange={(event) => change({ division: event.target.value })} /></label>
        </div>
        {(['teachers', 'students'] as const).map((key) => <fieldset key={key}>
          <legend>{key === 'teachers' ? 'Teachers' : 'Students'} ({draft[key].length})</legend>
          {draft[key].map((person, index) => <div className="class-person-row" key={index}>
            <label>{key === 'teachers' ? 'Teacher' : 'Student'} display name {index + 1}<input required maxLength={200} value={person.displayName} onChange={(event) => change({ [key]: draft[key].map((item, i) => i === index ? { ...item, displayName: event.target.value } : item) })} /></label>
            <label>{key === 'teachers' ? 'Teacher' : 'Student'} email {index + 1}<input required type="email" maxLength={320} value={person.email} onChange={(event) => change({ [key]: draft[key].map((item, i) => i === index ? { ...item, email: event.target.value } : item) })} /></label>
            <button type="button" className="icon-button danger" disabled={draft[key].length === 1} aria-label={`Remove ${key === 'teachers' ? 'teacher' : 'student'} ${index + 1}`} onClick={() => change({ [key]: draft[key].filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
          </div>)}
          <button type="button" className="btn secondary" disabled={draft[key].length >= (key === 'teachers' ? 200 : 5000)} onClick={() => change({ [key]: [...draft[key], { displayName: '', email: '' }] })}><Plus size={16} />{key === 'teachers' ? 'Add teacher' : 'Add student'}</button>
        </fieldset>)}
        <div className="form-actions"><button type="submit" className="btn primary"><Save size={16} />{busy ? 'Working...' : preview && !preview.errors.length ? 'Save class' : 'Validate class'}</button><button type="button" className="btn secondary" onClick={onClose}>Cancel</button></div>
      </fieldset>
      {preview && <div>
        {preview.errors.length ? <div role="alert" className="alert error"><strong>Class not saved. Correct these details:</strong><ul>{preview.errors.map((error, index) => <li key={index}>{error.message}</li>)}</ul></div> : <p role="status" className="alert success">Validation passed. Review any pending enrolments, then select Save class. Saving revalidates the directory and timetable.</p>}
        {preview.warnings.length > 0 && <div role="status" className="alert"><strong>Pending student enrolments (do not prevent saving)</strong><ul>{[...new Set(preview.warnings.map((warning) => warning.message))].map((message) => <li key={message}>{message}</li>)}</ul></div>}
      </div>}
      {error && <p role="alert" className="alert error">{error}</p>}
    </form>
  </Modal>, document.body);
}
