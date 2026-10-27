import { describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./db.js', () => ({ pool: async () => ({ request: () => ({ query }) }) }));

import { snapshot } from './repository.js';
import { DEFAULT_PERIOD_TYPES } from '../shared/learning.js';

describe('persisted email enrolments', () => {
  it('reads legacy structure arrays with the original default types', async () => {
    const slots = [{ id: '00000000-0000-4000-8000-000000000002', day: 0, name: 'Period 1', kind: 'lesson', start: '08:00', end: '09:00' }];
    query.mockResolvedValue({ recordset: [{ Kind: 'structure', Body: JSON.stringify(slots) }] });
    expect(await snapshot()).toMatchObject({ slots, periodTypes: DEFAULT_PERIOD_TYPES });
  });
  it('reads saved custom types and rejects broken persisted references', async () => {
    const periodTypes = [{ id: '00000000-0000-4000-8000-000000000003', name: 'Registration', kind: 'lesson' }];
    const slots = [{ id: '00000000-0000-4000-8000-000000000002', typeId: periodTypes[0].id, day: 0, name: 'Registration', kind: 'lesson', start: '08:00', end: '08:15' }];
    query.mockResolvedValue({ recordset: [{ Kind: 'structure', Body: JSON.stringify({ slots, periodTypes }) }] });
    expect(await snapshot()).toMatchObject({ slots, periodTypes });
    query.mockResolvedValue({ recordset: [{ Kind: 'structure', Body: JSON.stringify({ slots, periodTypes: DEFAULT_PERIOD_TYPES }) }] });
    await expect(snapshot()).rejects.toThrow('valid period type');
  });
  it('reads legacy and new class JSON without a user ID migration or re-import', async () => {
    const classroom = {
      id: '00000000-0000-4000-8000-000000000001', name: 'Maths', yearGroup: '7', division: 'Secondary',
      teachers: [{ id: 1, email: 'teacher@school.test', displayName: 'Teacher' }],
      students: [{ id: 2, email: ' LEGACY@school.test ', displayName: 'Existing Student' },
        { email: 'new@school.test', displayName: 'New Student' }],
    };
    query.mockResolvedValue({ recordset: [{ Kind: 'class', Body: JSON.stringify(classroom) }] });
    const result = await snapshot();
    expect(result.classes[0].students).toEqual([
      { email: 'legacy@school.test', displayName: 'Existing Student' },
      { email: 'new@school.test', displayName: 'New Student' },
    ]);
    expect(result.classes[0].teachers).toEqual(classroom.teachers);
  });
});
