import { useState, type FormEvent } from 'react';
import { LESSON_TYPE_ICONS, lessonTypeInputSchema, type LessonType, type Snapshot } from '../../shared/learning';
import { api, errorMessage } from './api';
import { LessonTypeBadge, LESSON_TYPE_ICON_OPTIONS } from './LessonTypeBadge';

const emptyType = { name: '', colour: '#FFC83D', icon: null };
export function LessonTypes({ data, refresh }: { data: Snapshot; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<LessonType, 'id'>>(emptyType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function reset() { setEditing(null); setDraft(emptyType); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const input = lessonTypeInputSchema.parse(draft);
      await api(editing ? `/admin/lesson-types/${editing}` : '/admin/lesson-types', editing ? 'PUT' : 'POST', input);
      await refresh(); reset(); setNotice('Lesson type saved.');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function remove(type: LessonType) {
    if (!window.confirm(`Delete lesson type "${type.name}"?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/admin/lesson-types/${type.id}`, 'DELETE');
      await refresh(); if (editing === type.id) reset(); setNotice('Lesson type deleted.');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Manage lesson types">
    <h2>Lesson types</h2>
    <p className="muted">Teachers must choose a type when saving a lesson. Choose its text and highlight colour, and optionally an icon.</p>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
        <legend>{editing ? 'Edit lesson type' : 'Add lesson type'}</legend>
        <label>Name<input required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Colour<input type="color" required value={draft.colour} onChange={(event) => setDraft({ ...draft, colour: event.target.value })} /></label>
        <label>Icon (optional)<select value={draft.icon ?? ''} onChange={(event) => setDraft({ ...draft, icon: LESSON_TYPE_ICONS.find((icon) => icon === event.target.value) ?? null })}>
          <option value="">No icon</option>
          {LESSON_TYPE_ICONS.map((icon) => <option key={icon} value={icon}>{LESSON_TYPE_ICON_OPTIONS[icon].label}</option>)}
        </select></label>
        <p>Preview: <LessonTypeBadge type={{ ...draft, id: editing ?? '', name: draft.name || 'Lesson type' }} /></p>
        <div className="form-actions"><button type="submit" className="btn primary">{busy ? 'Saving...' : 'Save lesson type'}</button>
          {editing && <button type="button" className="btn secondary" onClick={reset}>Cancel editing</button>}</div>
      </fieldset>
    </form>
    {error && <p role="alert" className="alert error">{error}</p>}
    {notice && <p role="status" className="alert success">{notice}</p>}
    <ul className="lesson-type-list">
      {(data.lessonTypes ?? []).map((type) => {
        const inUse = data.lessons.some((lesson) => lesson.lessonTypeId === type.id);
        return <li key={type.id}>
          <LessonTypeBadge type={type} />
          <div className="form-actions"><button type="button" className="btn secondary" disabled={busy} aria-label={`Edit lesson type ${type.name}`} onClick={() => {
            setEditing(type.id); setDraft({ name: type.name, colour: type.colour, icon: type.icon }); setError(''); setNotice('');
          }}>Edit</button><button type="button" className="btn secondary danger" disabled={busy || inUse} aria-label={`Delete lesson type ${type.name}`} onClick={() => void remove(type)}>Delete</button></div>
          {inUse && <small className="muted">Used by lessons. Reassign them before deleting.</small>}
        </li>;
      })}
    </ul>
    {!data.lessonTypes?.length && <p role="status">No lesson types configured. Add a type before teachers can save lessons.</p>}
  </section>;
}
