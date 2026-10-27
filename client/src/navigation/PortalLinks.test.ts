import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { portalMenu } from '../../../shared/portalMenu';
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
});
