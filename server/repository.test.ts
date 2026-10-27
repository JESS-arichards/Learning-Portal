import { describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./db.js', () => ({ pool: async () => ({ request: () => ({ query }) }) }));

import { snapshot } from './repository.js';

describe('persisted email enrolments', () => {
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
