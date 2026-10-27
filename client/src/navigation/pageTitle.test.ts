import { describe, expect, it } from 'vitest';
import { navigationTitle } from './pageTitle';

describe('portal navigation titles', () => {
  it.each([
    ['/', 'Home'], ['/parking', 'Parking'], ['/streaming', 'Streaming'],
    ['/trips/42', 'Trip Communicator'], ['/staff-absence', 'Staff Absence'],
    ['/tasks', 'Task Tracking'], ['/profile', 'My Profile'],
    ['/admin', 'Admin'], ['/admin/users', 'Admin - Users'],
    ['/admin/streaming', 'Admin - Streaming'], ['/admin/parking', 'Admin - Parking'],
  ])('names the Applications page %s', (path, label) => {
    expect(navigationTitle('apps', path)).toBe(`Applications Portal - ${label}`);
  });
  it.each([
    ['/', 'My Timetable'], ['/classes', 'My Classes'], ['/admin', 'Administration'],
    ['/classes/', 'My Classes'],
  ])('names the Learning page %s', (path, label) => {
    expect(navigationTitle('learn', path)).toBe(`Learning Portal - ${label}`);
  });
  it('does not expose unknown paths or record identifiers in the title', () => {
    expect(navigationTitle('apps', '/unknown/private-id')).toBe('Applications Portal');
    expect(navigationTitle('learn', '/unknown/private-id')).toBe('Learning Portal');
    expect(navigationTitle('apps', '/parking-other')).toBe('Applications Portal');
  });
});
