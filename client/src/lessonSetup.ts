import { meetingRequestSchema, type FileResource, type Lesson, type LessonInput, type MeetingRequest, type Snapshot } from '../../shared/learning';
import { api, errorMessage, fileBody } from './api';
import { formatDate } from '../../shared/dateFormatting';

export interface StagedFile { id: string; file: File }
export interface StagedResources {
  files: StagedFile[];
  removedFileIds: string[];
  teams: MeetingRequest | null;
}
export const emptyResources = (): StagedResources => ({ files: [], removedFileIds: [], teams: null });

export async function saveLessonSetup({ id, saved, input, resources, onSaved, onUploaded, onRemoved, onTeamsSaved, onProgress }: {
  id: string; saved?: Lesson; input: LessonInput; resources: StagedResources;
  onSaved: (lesson: Lesson) => void; onUploaded: (file: FileResource) => void; onRemoved: (id: string) => void;
  onTeamsSaved: () => void; onProgress: (message: string) => void;
}): Promise<Lesson> {
  if (resources.teams) {
    meetingRequestSchema.parse(resources.teams);
    const status = await api<{ configured: boolean; connected: boolean; meetingOptionsReady: boolean; error?: string }>('/teams/status');
    if (!status.configured || !status.connected || !status.meetingOptionsReady)
      throw new Error(status.error ?? 'An administrator must configure Microsoft Teams application access and the teacher Microsoft identity before saving a Teams lesson.');
  }
  onProgress('Saving lesson details and links...');
  let lesson = await api<Lesson>(saved ? `/lessons/${id}` : '/lessons', saved ? 'PUT' : 'POST',
    saved ? input : { ...input, id });
  onSaved(lesson);
  try {
    for (const fileId of resources.removedFileIds) {
      if (lesson.files.some((file) => file.id === fileId)) {
        onProgress('Removing lesson file...');
        await api(`/lessons/${id}/files/${fileId}`, 'DELETE');
        lesson = { ...lesson, files: lesson.files.filter((file) => file.id !== fileId) };
        onSaved(lesson);
      }
      onRemoved(fileId);
    }
    for (const item of resources.files) {
      onProgress(`Uploading ${item.file.name}...`);
      const body = fileBody(item.file);
      body.append('resourceId', item.id);
      const file = await api<FileResource>(`/lessons/${id}/files`, 'POST', body);
      lesson = { ...lesson, files: [...lesson.files.filter((existing) => existing.id !== file.id), file] };
      onSaved(lesson); onUploaded(file);
    }
    if (resources.teams) {
      const current = await api<Snapshot>('/learning');
      for (const occurrence of lesson.occurrences ?? []) {
        const existing = current.meetings?.find((meeting) => meeting.occurrenceId === occurrence.id);
        if (existing?.state === 'cancelled' || (existing?.state === 'created' && existing.optionsApplied !== false)) continue;
        onProgress(`Creating Teams meeting for ${formatDate(occurrence.date)}...`);
        await api(`/lessons/${id}/occurrences/${occurrence.id}/teams`, 'POST',
          existing ? existing.options ? { title: existing.title, options: existing.options } : undefined : resources.teams);
      }
      onTeamsSaved();
    }
    return lesson;
  } catch (error) {
    throw new Error(`Lesson details were saved, but setup is incomplete: ${errorMessage(error)} Remaining resources are retained. Click Save lesson to retry; completed files and invitations will not be duplicated.`);
  }
}
