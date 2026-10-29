import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ active: false, fetch: vi.fn() }));
vi.mock('./teamsSession', () => ({ usesTeamsSession: () => mocks.active }));
vi.mock('./api', () => ({ fetchResource: mocks.fetch, errorMessage: (error: Error) => error.message }));
import { AuthenticatedImage, ResourceLink, downloadResource } from './AuthenticatedResource';
beforeEach(() => {
  vi.clearAllMocks(); mocks.active = false;
  mocks.fetch.mockResolvedValue(new Response('resource'));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('authenticated Learning resources', () => {
  it('preserves ordinary browser image and download URLs', () => {
    expect(renderToStaticMarkup(createElement(AuthenticatedImage, { src: '/api/me/avatar', alt: '', onError: vi.fn() }))).toContain('src="/api/me/avatar"');
    expect(renderToStaticMarkup(createElement(ResourceLink, { href: '/api/file', fileName: 'file.pdf', children: 'Download' }))).toContain('href="/api/file"');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('does not issue unauthenticated image requests in Teams while bearer-backed data loads', () => {
    mocks.active = true;
    const html = renderToStaticMarkup(createElement(AuthenticatedImage, { src: '/api/me/avatar', alt: '', onError: vi.fn() }));
    expect(html).toContain('Loading image...');
    expect(html).not.toContain('src="/api/me/avatar"');
  });
  it('downloads the authenticated blob without placing credentials in a URL and releases it afterwards', async () => {
    vi.useFakeTimers();
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { appendChild: vi.fn() } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:authenticated-resource');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await downloadResource('/api/lessons/1/files/2', 'Worksheet.pdf');
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('/api/lessons/1/files/2');
    expect(link.href).toBe('blob:authenticated-resource');
    expect(link.download).toBe('Worksheet.pdf');
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:authenticated-resource');
  });
});
