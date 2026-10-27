import type { PublicConfig } from '../../shared/learning';
import { accessibleBrandAccent, readableTextColor } from './branding/colorTokens';

export function applyBranding(branding: PublicConfig['branding']) {
  const style = document.documentElement.style;
  style.setProperty('--brand', branding.primaryColor);
  style.setProperty('--brand-foreground', readableTextColor(branding.primaryColor));
  style.setProperty('--brand-accent', accessibleBrandAccent(branding.accentColor || branding.primaryColor));
  style.setProperty('--page-background', branding.backgroundColor || branding.primaryColor);
  style.setProperty('--app-bg-color', branding.backgroundColor || branding.primaryColor);
  if (branding.textColor) style.setProperty('--text', branding.textColor);
  else style.removeProperty('--text');
  style.setProperty('--app-bg-image', branding.backgroundUrl ? `url(${JSON.stringify(branding.backgroundUrl)})` : 'none');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', branding.primaryColor);
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) {
    if (branding.iconUrl) icon.href = branding.iconUrl;
    else icon.removeAttribute('href');
  }
}
