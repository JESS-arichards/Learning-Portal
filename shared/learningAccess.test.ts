import { describe, expect, it } from 'vitest';
import { canUseLearning } from './learningAccess.js';

describe('Learning feature eligibility', () => {
  it.each([
    { roles: ['Staff'], department: null, allowed: false },
    { roles: ['Staff', 'Learn User'], department: null, allowed: true },
    { roles: ['Full Admin'], department: null, allowed: true },
    { roles: ['Student'], department: 'Jumeirah Student', allowed: false },
    { roles: ['Student'], department: 'Primary Student', allowed: false },
    { roles: ['Student'], department: ' PRIMARY STUDENT ', allowed: false },
    { roles: ['Student', 'Learn User'], department: 'Primary Student', allowed: false },
    { roles: ['Student', 'Learn Admin'], department: 'Jumeirah Student', allowed: false },
    { roles: ['Parent', 'Learn User'], department: null, allowed: false },
    { roles: ['Student'], department: 'Secondary Student', allowed: false },
    { roles: ['Student'], department: 'Primary Student Extra', allowed: false },
    { roles: ['Student'], department: null, allowed: false },
    { roles: ['Student'], allowed: false },
    { roles: ['Parent'], department: 'Primary Student', allowed: false },
    { roles: ['Learn Admin'], department: null, allowed: false },
    { roles: ['Learn User'], department: null, allowed: false },
    { roles: ['Student', 'Learn Admin'], department: 'Secondary Student', allowed: false },
    { roles: ['Staff', 'Learn Admin'], department: null, allowed: true },
    { roles: [], department: 'Jumeirah Student', allowed: false },
  ])('evaluates $roles / $department as $allowed', ({ roles, department, allowed }) => {
    expect(canUseLearning({ roles, department })).toBe(allowed);
  });
});
