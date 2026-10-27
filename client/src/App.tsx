import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router';
import { BookOpen, CalendarDays, GraduationCap, ShieldCheck } from 'lucide-react';
import { isAdmin, canManage, type User, type Snapshot, type PublicConfig, type Student } from '../../shared/learning';
import { api, ApiError, errorMessage, redirectToSignIn } from './api';
import { NavigationBar } from './navigation/NavigationBar';
import { applyBranding } from './branding';
import { Timetable } from './Timetable';
import { Classes } from './Classes';
import { Admin } from './Admin';

type LearningData = Snapshot & { children: Student[] };
export function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<LearningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const bootstrap = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setUser(await api<User>('/me'));
      setConfig(await api<PublicConfig>('/config'));
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
      setUser(current); setData(next); setConfig(currentConfig); setError('');
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
    const reloadBranding = () => {
      void api<PublicConfig>('/config').then(setConfig).catch((error: unknown) => setError(errorMessage(error)));
    };
    window.addEventListener('focus', reloadBranding);
    return () => window.removeEventListener('focus', reloadBranding);
  }, [user?.id]);
  async function logout() {
    const { redirectUrl } = await api<{ redirectUrl: string }>('/auth/logout', 'POST');
    window.location.assign(redirectUrl);
  }
  if (loading) return <main className="loading-screen" role="status"><BookOpen size={34} /><p>Opening your Learning Portal...</p></main>;
  if (!config) return <main className="loading-screen"><BookOpen size={34} /><h1>Learning Portal unavailable</h1><p role="alert" className="alert error">{error}</p><button className="btn primary" onClick={() => void bootstrap()}>Try again</button></main>;
  if (!user) return <main className="loading-screen" role="status"><p>Returning to Applications Portal to sign in...</p><button className="btn primary" onClick={redirectToSignIn}>Continue to sign in</button></main>;
  const manager = user.roles.includes('Staff') || isAdmin(user) || data?.classes.some((c) => canManage(user, c));
  const links = <>
    <li><NavLink to="/" end><CalendarDays size={18} /> My timetable</NavLink></li>
    {manager && <li><NavLink to="/classes"><GraduationCap size={18} /> My classes</NavLink></li>}
    {isAdmin(user) && <li><NavLink to="/admin"><ShieldCheck size={18} /> Admin</NavLink></li>}
  </>;
  return <BrowserRouter>
    <NavigationBar appName="Learning Portal" brand={config.branding.logoUrl ? <img src={config.branding.logoUrl} alt={config.branding.organisationName} /> : <BookOpen size={26} />} navigation={links} mobileNavigation={<ul className="mobile-learning-links">{links}</ul>}
      user={user} profileUrl={config.profileUrl} adminUrl={isAdmin(user) ? '/admin' : undefined} signOut={logout} />
    <main className="app-main">
      {error && <div className="alert error" role="alert">{error} <button className="text-button" onClick={() => void refresh().catch(() => {})}>Retry</button></div>}
      {!data ? !error && <div className="loading-screen" role="status">Loading your learning...</div> : <Routes>
        <Route path="/" element={<Timetable data={data} user={user} children={data.children} />} />
        <Route path="/classes" element={manager ? <Classes data={data} user={user} refresh={refresh} /> : <Navigate to="/" replace />} />
        <Route path="/admin" element={isAdmin(user) ? <Admin data={data} refresh={refresh} portalUrl={config.profileUrl} /> : <Navigate to="/" replace />} />
        <Route path="*" element={<section className="empty panel"><h1>Page not found</h1><NavLink to="/">Go to my timetable</NavLink></section>} />
      </Routes>}
      <footer className="app-footer">{config.branding.footerLogoUrl && <img src={config.branding.footerLogoUrl} alt={config.branding.organisationName} />}<span>{config.branding.organisationName}</span>{config.branding.websiteUrl && <a href={config.branding.websiteUrl} target="_blank" rel="noopener noreferrer">School website</a>}</footer>
    </main>
  </BrowserRouter>;
}
