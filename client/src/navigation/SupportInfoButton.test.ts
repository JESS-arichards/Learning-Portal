import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupportSession } from './supportInfo';

const state = vi.hoisted(() => ({
  values: [] as unknown[], index: 0,
  session: null as SupportSession | null,
  clipboard: vi.fn(),
}));
vi.mock('react', async (orig) => ({
  ...await orig<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
}));
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
import { SupportInfoButton } from './SupportInfoButton';

function render() { state.index = 0; return SupportInfoButton({ session: state.session }); }
function find(root: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  for (const child of Children.toArray(root)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child.props)) return child.props;
    const found = find(child.props.children as ReactNode, predicate);
    if (found) return found;
  }
  return null;
}
function open() {
  const button = find(render(), (props) => props['aria-label'] === 'Build and support information');
  (button!.onClick as () => void)();
  return render();
}

beforeEach(() => {
  state.values = [];
  state.index = 0;
  state.session = { provider: 'otp', user: { id: 7, displayName: 'Test User', email: 'test@example.org', roles: ['Parent'] } };
  state.clipboard.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', {
    userAgent: 'Windows Chrome/130.0', platform: 'Win32', maxTouchPoints: 0, language: 'en-GB',
    clipboard: { writeText: state.clipboard },
  });
  vi.stubGlobal('window', { location: { origin: 'https://portal.example.org', pathname: '/admin/staff-absence', search: '?token=SECRET', hash: '#SECRET' }, matchMedia: () => ({ matches: false }) });
  vi.stubGlobal('document', { body: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('Navigation support information button', () => {
  it('is small and accessible, with no open report until clicked', () => {
    const tree = render();
    expect(find(tree, (props) => props['aria-label'] === 'Build and support information')!.className).toContain('icon-btn');
    expect(find(tree, (props) => props.id === 'support-details')).toBeNull();
  });
  it('opens a selectable report, shows actual auth provider, and excludes the URL query', () => {
    const tree = open();
    const details = find(tree, (props) => props.id === 'support-details')!;
    expect(details.readOnly).toBe(true);
    expect(details.value).toContain('Email one-time code (OTP)');
    expect(details.value).toContain('Test User');
    expect(details.value).toContain('App location when clicked: /admin/staff-absence');
    expect(details.value).not.toContain('SECRET');
    const modal = find(tree, (props) => props.title === 'Build and support information' && typeof props.onClose === 'function')!;
    (modal.onClose as () => void)();
    expect(find(render(), (props) => props.id === 'support-details')).toBeNull();
  });
  it('captures the path at click time and keeps the report stable after navigation', () => {
    window.location.pathname = '/parking';
    const tree = open();
    window.location.pathname = '/profile';
    expect(find(tree, (props) => props.id === 'support-details')!.value).toContain('App location when clicked: /parking');
    expect(find(render(), (props) => props.id === 'support-details')!.value).not.toContain('/profile');
  });
  it('copies exactly the displayed report and reports successful copy', async () => {
    const tree = open();
    const copy = find(tree, (props) => props.className === 'portal-support-copy')!;
    (copy.onClick as () => void)();
    await vi.waitFor(() => expect(state.values[1]).toBe(true));
    expect(state.clipboard).toHaveBeenCalledWith(find(tree, (props) => props.id === 'support-details')!.value);
  });
  it('shows manual-copy guidance rather than false success if clipboard permission is denied', async () => {
    state.clipboard.mockRejectedValue(new Error('Permission denied'));
    const copy = find(open(), (props) => props.className === 'portal-support-copy')!;
    (copy.onClick as () => void)();
    await vi.waitFor(() => expect(state.values[2]).toContain('copy them manually'));
    expect(state.values[1]).toBe(false);
  });
  it('does not show user support information without a session', () => {
    state.session = null;
    expect(render()).toBeNull();
  });
});
