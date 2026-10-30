export type MenuIcon = 'home' | 'streaming' | 'communication' | 'learning' | 'parking' | 'trips' | 'absence' | 'tasks' | 'timetable' | 'classes' | 'admin';
export interface PortalLink {
  id: string;
  label: string;
  icon: MenuIcon;
  application: 'apps' | 'learn';
  path: string;
}
export interface PortalGroup {
  id: string;
  label: string;
  icon: MenuIcon;
  children: PortalLink[];
}
export type PortalMenuItem = PortalLink | PortalGroup;

export function desktopPortalMenu(items: PortalMenuItem[], roles: readonly string[]): PortalMenuItem[] {
  const home = items.find((item) => item.id === 'home');
  const streaming = items.find((item) => item.id === 'streaming');
  const learning = items.find((item) => item.id === 'learning');
  const remaining = items.filter((item) => !['home', 'streaming', 'learning'].includes(item.id));
  const staff = roles.includes('Staff') ? remaining.filter((item): item is PortalLink => !('children' in item)) : [];
  const parents = roles.includes('Parent') ? remaining.filter((item): item is PortalLink =>
    !('children' in item) && item.id === 'trips' && !staff.some((link) => link.id === item.id)) : [];
  const grouped = new Set([...staff, ...parents].map((item) => item.id));
  return [
    ...(home ? [home] : []),
    ...(streaming ? [streaming] : []),
    ...(learning ? [{ ...learning, label: 'Learn' }] : []),
    ...(staff.length ? [{ id: 'staff', label: 'Staff', icon: 'classes' as const, children: staff }] : []),
    ...(parents.length ? [{ id: 'parents', label: 'Parent', icon: 'home' as const, children: parents }] : []),
    ...remaining.filter((item) => !grouped.has(item.id)),
  ];
}

export function portalMenu(options: {
  staff: boolean; trips: boolean; absence: boolean; tasks: boolean; learning: boolean; learningAdmin: boolean;
  communication?: boolean;
}): PortalMenuItem[] {
  const link = (id: MenuIcon, label: string, path: string, application: 'apps' | 'learn' = 'apps'): PortalLink => ({
    id, label, icon: id, path, application,
  });
  return [
    link('home', 'Home', '/'),
    link('streaming', 'Streaming', '/streaming'),
    ...(options.communication ? [link('communication', 'Communication', '/communication')] : []),
    ...(options.learning ? [{
      id: 'learning', label: 'Learning Portal', icon: 'learning' as const,
      children: [
        link('timetable', 'My timetable', '/', 'learn'),
        ...(options.staff || options.learningAdmin ? [link('classes', 'My classes', '/classes', 'learn')] : []),
        ...(options.learningAdmin ? [link('admin', 'Learning Portal admin', '/admin', 'learn')] : []),
      ],
    }] : []),
    ...(options.staff ? [link('parking', 'Parking', '/parking')] : []),
    ...(options.trips ? [link('trips', 'Trip Communicator', '/trips')] : []),
    ...(options.absence ? [link('absence', 'Staff Absence', '/staff-absence')] : []),
    ...(options.tasks ? [link('tasks', 'Task Tracking', '/tasks')] : []),
  ];
}
