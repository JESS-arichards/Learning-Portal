import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router';
import { BookOpen } from 'lucide-react';
import { isAdmin, canManage, type User, type Snapshot, type PublicConfig, type Student, type PortalNavigation } from '../../shared/learning';
import { api, ApiError, errorMessage, redirectToSignIn } from './api';
import { NavigationBar } from './navigation/NavigationBar';
import { applyBranding } from './branding';
import { Timetable } from './Timetable';
import { Classes } from './Classes';
import { Admin } from './Admin';
import { PortalLinks } from './navigation/PortalLinks';
import { Avatar } from './Avatar';
import { SupportInfoButton } from './navigation/SupportInfoButton';

type LearningData = Snapshot & { children: Student[] };
export function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<LearningData | null>(null);
  const [navigation, setNavigation] = useState<PortalNavigation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const bootstrap = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setUser(await api<User>('/me'));
      setConfig(await api<PublicConfig>('/config'));
      setNavigation(await api<PortalNavigation>('/navigation'));
    } catch (error) { setError(errorMessage(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  const refresh = useCallback(async () => {
    try {
      // Fetch current roles as well as learning data so central permission changes update the UI.
      const current = await api<User>('/me');
      const next = await api<LearningData>('/learning');
      const currentConfig = await api<PublicConfig>('/config');
      const currentNavigation = await api<PortalNavigation>('/navigation');
      setUser(current); setData(next); setConfig(currentConfig); setNavigation(currentNavigation); setError('');
    } catch (error) {
      setData(null);
      if (error instanceof ApiError && error.status === 401) setUser(null);
      setError(errorMessage(error)); throw error;
    }
  }, []);
  useEffect(() => {
    if (user?.id) void refresh().catch(() => { /* The refresh error is displayed by the application shell. */ });
  }, [user?.id, refresh]);
  useEffect(() => {
    if (!config) return;
    applyBranding(config.branding);
  }, [config]);
  useEffect(() => {
    if (!user?.id) return;
    const reloadBranding = () => { void refresh().catch(() => { /* The shell displays refresh failures. */ }); };
    window.addEventListener('focus', reloadBranding);
    return () => window.removeEventListener('focus', reloadBranding);
  }, [user?.id, refresh]);
  async function logout() {
    const { redirectUrl } = await api<{ redirectUrl: string }>('/auth/logout', 'POST');
    window.location.assign(redirectUrl);
  }
  if (loading) return <main className="loading-screen" role="status"><BookOpen size={34} /><p>Opening your Learning Portal...</p></main>;
  if (!config || !navigation) return <main className="loading-screen"><BookOpen size={34} /><h1>Learning Portal unavailable</h1><p role="alert" className="alert error">{error}</p><button className="btn primary" onClick={() => void bootstrap()}>Try again</button></main>;
  if (!user) return <main className="loading-screen" role="status"><p>Returning to Applications Portal to sign in...</p><button className="btn primary" onClick={redirectToSignIn}>Continue to sign in</button></main>;
  const manager = user.roles.includes('Staff') || isAdmin(user) || data?.classes.some((c) => canManage(user, c));
  const links = <PortalLinks items={navigation.items} application="learn" portalUrl={navigation.portalUrl} learningUrl={navigation.learningUrl} />;
  return <BrowserRouter>
    <div className="fluid-bg" aria-hidden="true"><div className="orb orb-1" /><div className="orb orb-2" /><div className="orb orb-3" /></div>
    <NavigationBar appName={config.branding.appName} brand={config.branding.logoUrl ? <img src={config.branding.logoUrl} alt={config.branding.organisationName} /> : <BookOpen size={26} />} desktopSidebar navigation={links} mobileNavigation={<ul className="jess-nav-portal-links">{links}</ul>}
      user={user} avatar={<Avatar user={user} />} profileUrl={config.profileUrl} adminUrl={navigation.adminUrl ?? undefined} signOut={logout}
      support={<SupportInfoButton session={{ user, provider: 'central' }} />}
      parkingReleaseUrl={navigation.parkingReleaseUrl} parkingBay={navigation.parkingBay} />
    <div className="portal-content"><main className="app-main">
      {error && <div className="alert error" role="alert">{error} <button className="text-button" onClick={() => void refresh().catch(() => {})}>Retry</button></div>}
      {!data ? !error && <div className="loading-screen" role="status">Loading your learning...</div> : <Routes>
        <Route path="/" element={<Timetable data={data} user={user} children={data.children} />} />
        <Route path="/classes" element={manager ? <Classes data={data} user={user} refresh={refresh} /> : <Navigate to="/" replace />} />
        <Route path="/admin" element={isAdmin(user) ? <Admin data={data} refresh={refresh} portalUrl={config.profileUrl} /> : <Navigate to="/" replace />} />
        <Route path="*" element={<section className="empty panel"><h1>Page not found</h1><NavLink to="/">Go to my timetable</NavLink></section>} />
      </Routes>}
    </main></div>
  </BrowserRouter>;
}
