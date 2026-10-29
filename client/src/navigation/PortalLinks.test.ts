import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { portalMenu } from '../../../shared/portalMenu';
import { navigationSchema } from '../../../shared/learning';
import { PortalLinks, type PortalLinksProps } from './PortalLinks';

const items = portalMenu({ staff: true, trips: true, absence: true, tasks: true, learning: true, learningAdmin: true });
function render(application: PortalLinksProps['application']) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement('ul', null, createElement(PortalLinks, {
    items, application, portalUrl: 'https://appsdev.jess.sch.ae', learningUrl: 'https://learndev.jess.sch.ae',
  }))));
}
describe('shared Applications Portal links', () => {
  it('uses the same central menu with local Learn links and external Portal links in Learning', () => {
    const html = render('learn');
    expect(html).toContain('href="https://appsdev.jess.sch.ae/streaming"');
    expect(html).toContain('href="/classes"');
    expect(html).toContain('href="/admin"');
    expect(html).toContain('Learning Portal admin');
    expect(html).toContain('aria-expanded="true"');
  });
  it('starts the Learn group collapsed in Applications Portal and links to the correct environment', () => {
    const html = render('apps');
    expect(html).toContain('href="/streaming"');
    expect(html).toContain('href="https://learndev.jess.sch.ae/classes"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
  });
  it('omits staff and Learning admin links for ordinary students and parents', () => {
    const ordinary = portalMenu({ staff: false, trips: false, absence: false, tasks: false, learning: true, learningAdmin: false });
    const group = ordinary.find((item) => item.id === 'learning');
    expect(group && 'children' in group && group.children.map((child) => child.id)).toEqual(['timetable']);
    expect(ordinary.map((item) => item.id)).toEqual(['home', 'streaming', 'learning']);
  });
  it('includes the Communication link when enabled without changing menus that omit it', () => {
    const options = { staff: false, trips: false, absence: false, tasks: false, learning: false, learningAdmin: false };
    const communication = portalMenu({ ...options, communication: true }).find((item) => item.id === 'communication');
    expect(communication).toEqual({
      id: 'communication', label: 'Communication', icon: 'communication', path: '/communication', application: 'apps',
    });
    expect(portalMenu(options).some((item) => item.id === 'communication')).toBe(false);
  });
  it('accepts every link the central menu can produce in the navigation contract', () => {
    const all = portalMenu({ staff: true, trips: true, absence: true, tasks: true, communication: true, learning: true, learningAdmin: true });
    const result = navigationSchema.safeParse({
      items: all, portalUrl: 'https://apps.example.org', learningUrl: 'https://learn.example.org', adminUrl: null, parkingReleaseUrl: null, parkingBay: null,
    });
    expect(result.success).toBe(true);
  });
  it('carries Teams mode across application origins while leaving local routes unchanged', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement('ul', null, createElement(PortalLinks, {
      items, application: 'apps', portalUrl: 'https://appsdev.jess.sch.ae', learningUrl: 'https://learndev.jess.sch.ae', teams: true,
    }))));
    expect(html).toContain('href="https://learndev.jess.sch.ae/?teams=1"');
    expect(html).toContain('href="https://learndev.jess.sch.ae/classes?teams=1"');
    expect(html).toContain('href="https://learndev.jess.sch.ae/admin?teams=1"');
    expect(html).toContain('href="/streaming"');
  });
});
