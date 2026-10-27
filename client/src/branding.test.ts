import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBranding } from './branding';
import type { PublicConfig } from '../../shared/learning';

const branding: PublicConfig['branding'] = {
  appName: 'Applications Portal', organisationName: 'School', primaryColor: '#713486', backgroundColor: '#171523', textColor: '#fff2dd',
  accentColor: '#f5bc78', logoUrl: 'https://portal.school.test/api/branding/logo',
  iconUrl: 'https://portal.school.test/api/branding/icon', backgroundUrl: 'https://portal.school.test/api/branding/background',
  footerLogoUrl: null, websiteUrl: 'https://school.test',
};
afterEach(() => vi.unstubAllGlobals());
describe('central branding application', () => {
  it('uses the central colors/assets and shared contrast tokens without a local theme setting', () => {
    const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
    const meta = { setAttribute: vi.fn() };
    const icon = { href: '', removeAttribute: vi.fn() };
    vi.stubGlobal('document', { documentElement: { style }, querySelector: (selector: string) => selector.startsWith('meta') ? meta : icon });
    applyBranding(branding);
    expect(style.setProperty).toHaveBeenCalledWith('--brand', branding.primaryColor);
    expect(style.setProperty).toHaveBeenCalledWith('--page-background', branding.backgroundColor);
    expect(style.setProperty).toHaveBeenCalledWith('--branding-text', branding.textColor);
    expect(style.setProperty).toHaveBeenCalledWith('--app-bg-image', `url("${branding.backgroundUrl}")`);
    expect(style.setProperty).toHaveBeenCalledWith('--brand-foreground', '#ffffff');
    expect(icon.href).toBe(branding.iconUrl);
    expect(meta.setAttribute).toHaveBeenCalledWith('content', branding.primaryColor);
  });
  it('clears removed central assets/text and follows primary when background is unset', () => {
    const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
    const icon = { removeAttribute: vi.fn() };
    vi.stubGlobal('document', { documentElement: { style }, querySelector: (selector: string) => selector.startsWith('meta') ? null : icon });
    applyBranding({ ...branding, backgroundColor: '', textColor: '', backgroundUrl: null, iconUrl: null });
    expect(style.setProperty).toHaveBeenCalledWith('--page-background', branding.primaryColor);
    expect(style.setProperty).toHaveBeenCalledWith('--app-bg-image', 'none');
    expect(style.removeProperty).toHaveBeenCalledWith('--branding-text');
    expect(icon.removeAttribute).toHaveBeenCalledWith('href');
  });
});
