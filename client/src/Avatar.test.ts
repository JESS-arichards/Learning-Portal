import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';
import type { User } from '../../shared/learning';

const user: User = { id: 1, email: 'user@school.test', displayName: 'Alex Middle Richards', roles: ['Staff'], studentEmails: [], isActive: true, sessionVersion: 0 };
describe('central user avatar', () => {
  it('loads the versioned central photo through the authenticated same-origin endpoint', () => {
    const html = renderToStaticMarkup(createElement(Avatar, { user: { ...user, hasAvatar: true, avatarVersion: '123' } }));
    expect(html).toContain('src="/api/me/avatar?v=123"');
    expect(html).not.toContain('apps.');
  });
  it('uses the same first/last-name initials as the Portal when no avatar exists', () => {
    const html = renderToStaticMarkup(createElement(Avatar, { user }));
    expect(html).toContain('AR');
    expect(html).not.toContain('<img');
  });
});
