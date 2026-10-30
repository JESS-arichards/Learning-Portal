import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { desktopPortalMenu, portalMenu } from '../../../shared/portalMenu';
import { PortalLinks, type PortalLinksProps } from './PortalLinks';

const items = portalMenu({ staff: true, trips: true, absence: true, tasks: true, learning: true, learningAdmin: true });
function render(application: PortalLinksProps['application']) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement('ul', null, createElement(PortalLinks, {
    items, application, portalUrl: 'https://appsdev.jess.sch.ae', learningUrl: 'https://learndev.jess.sch.ae',
  }))));
}
describe('shared Applications Portal links', () => {
  it('orders Home, Streaming, Learn and Staff with Streaming outside groups', () => {
    const groups = desktopPortalMenu(items, ['Staff']);
    expect(groups.map((item) => item.label)).toEqual(['Home', 'Streaming', 'Learn', 'Staff']);
    const staff = groups.find((item) => item.id === 'staff');
    expect(staff && 'children' in staff && staff.children.map((item) => item.id))
      .toEqual(['parking', 'trips', 'absence', 'tasks']);
    const learn = groups.find((item) => item.id === 'learning');
    expect(learn && 'children' in learn && learn.children.map((item) => item.id)).toEqual(['timetable', 'classes', 'admin']);
    expect(items.find((item) => item.id === 'learning')?.label).toBe('Learning Portal');
  });
  it('groups only eligible parent features and does not invent trips or staff links', () => {
    const options = { staff: false, trips: false, absence: false, tasks: false, learning: true, learningAdmin: false };
    const groups = desktopPortalMenu(portalMenu(options), ['Parent']);
    expect(groups.map((item) => item.label)).toEqual(['Home', 'Streaming', 'Learn']);
    expect(groups.find((item) => item.id === 'parents')).toBeUndefined();
    const attachedGroups = desktopPortalMenu(portalMenu({ ...options, trips: true }), ['Parent']);
    expect(attachedGroups.map((item) => item.label)).toEqual(['Home', 'Streaming', 'Learn', 'Parent']);
    const attached = attachedGroups.find((item) => item.id === 'parents');
    expect(attached && 'children' in attached && attached.children.map((item) => item.id)).toEqual(['trips']);
  });
  it('deduplicates staff/parent links in favour of Staff and hides the empty Parents heading', () => {
    const groups = desktopPortalMenu(items, ['Staff', 'Parent']);
    expect(groups.map((item) => item.id)).toEqual(['home', 'streaming', 'learning', 'staff']);
    const links = groups.flatMap((item) => 'children' in item ? item.children : [item]);
    expect(new Set(links.map((item) => item.id)).size).toBe(links.length);
  });
  it('retains permitted feature links for students and admin-only users without mislabelling their roles', () => {
    const ordinary = portalMenu({ staff: false, trips: false, absence: false, tasks: false, learning: true, learningAdmin: false });
    expect(desktopPortalMenu(ordinary, ['Student']).map((item) => item.id)).toEqual(['home', 'streaming', 'learning']);
    const admin = portalMenu({ staff: false, trips: true, absence: false, tasks: true, learning: true, learningAdmin: true, communication: true });
    expect(desktopPortalMenu(admin, ['Full Admin']).map((item) => item.id)).toEqual(['home', 'streaming', 'learning', 'communication', 'trips', 'tasks']);
  });
  it('uses the same role groups and options in desktop dropdowns and mobile accordions', () => {
    const props: PortalLinksProps = {
      items, application: 'apps', portalUrl: 'https://appsdev.jess.sch.ae', learningUrl: 'https://learndev.jess.sch.ae',
      roles: ['Staff', 'Parent'],
    };
    const desktop = renderToStaticMarkup(createElement(MemoryRouter, null, createElement('ul', null, createElement(PortalLinks, { ...props, desktop: true }))));
    expect(desktop).toContain('jess-nav-top-group');
    expect(desktop).toMatch(/aria-expanded="false" aria-controls="[^"]+"[^>]*>Learn/);
    expect(desktop).toMatch(/aria-expanded="false" aria-controls="[^"]+"[^>]*>Staff/);
    expect(desktop).not.toContain('>Parent<');
    expect(desktop.indexOf('title="Home"')).toBeLessThan(desktop.indexOf('title="Streaming"'));
    expect(desktop.indexOf('title="Streaming"')).toBeLessThan(desktop.indexOf('>Learn<'));
    expect(desktop).toContain('href="/parking"');
    const mobile = renderToStaticMarkup(createElement(MemoryRouter, null, createElement('ul', null, createElement(PortalLinks, props))));
    expect(mobile).toContain('jess-nav-group-toggle');
    expect(mobile).toContain('title="Learn"');
    expect(mobile).not.toContain('jess-nav-top-group');
    expect(mobile).toContain('title="Staff"');
    for (const item of ['Parking', 'Trip Communicator', 'Staff Absence', 'Task Tracking']) {
      expect(mobile).toContain(`title="${item}"`);
      expect(desktop).toContain(`title="${item}"`);
    }
    expect(mobile).not.toContain('title="Parent"');
  });
  it.each(['apps', 'learn'] as const)('renders the same Parent options on mobile and desktop in %s', (application) => {
    const props: PortalLinksProps = {
      items: portalMenu({ staff: false, trips: true, absence: false, tasks: false, learning: false, learningAdmin: false }),
      application, portalUrl: 'https://appsdev.jess.sch.ae', learningUrl: 'https://learndev.jess.sch.ae', roles: ['Parent'],
    };
    for (const desktop of [false, true]) {
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement('ul', null, createElement(PortalLinks, { ...props, desktop }))));
      expect(html).toContain(desktop ? '>Parent<' : 'title="Parent"');
      expect(html).toContain('title="Trip Communicator"');
      expect(html).not.toContain('title="Parking"');
      expect(html).not.toContain('title="Task Tracking"');
      expect(html).toMatch(/aria-expanded="false" aria-controls="/);
    }
  });
  it('keeps Learning links local and Portal links external in desktop groups, including Teams mode', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement('ul', null, createElement(PortalLinks, {
      items, application: 'learn', portalUrl: 'https://appsdev.jess.sch.ae', learningUrl: 'https://learndev.jess.sch.ae',
      desktop: true, roles: ['Staff'], teams: true,
    }))));
    expect(html).toContain('href="/classes"');
    expect(html).toContain('href="https://appsdev.jess.sch.ae/parking?teams=1"');
    expect(html).toContain('href="https://appsdev.jess.sch.ae/?teams=1"');
    expect(html).not.toContain('aria-expanded="true"');
  });
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
