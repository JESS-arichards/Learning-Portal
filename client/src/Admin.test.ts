import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Admin } from './Admin';
import { DEFAULT_PERIOD_TYPES, type Snapshot } from '../../shared/learning';

it('keeps current classes in a labelled keyboard-scrollable table with edit and delete actions', () => {
  const data: Snapshot = {
    periodTypes: DEFAULT_PERIOD_TYPES, slots: [], lessons: [],
    classes: [{
      id: 'sample', name: 'Sample Class', yearGroup: '5', division: 'Jumeirah',
      teachers: [{ id: 1, email: 'teacher@school.test', displayName: 'Alan Richards' }],
      students: [{ email: 'student@school.test', displayName: 'Sample Student' }],
    }],
  };
  const html = renderToStaticMarkup(createElement(Admin, { data, refresh: async () => {}, portalUrl: null }));
  expect(html).toContain('<div class="table-scroll" role="region" aria-label="Current classes" tabindex="0"><table class="current-classes">');
  expect(html).toContain('<td>Alan Richards</td>');
  expect(html).toContain('aria-label="Edit class Sample Class">Edit</button>');
  expect(html).toContain('class="text-button danger">Delete</button>');
});
