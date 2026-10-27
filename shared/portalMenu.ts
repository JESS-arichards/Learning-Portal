export type MenuIcon = 'home' | 'streaming' | 'learning' | 'parking' | 'trips' | 'absence' | 'tasks' | 'timetable' | 'classes' | 'admin';
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

export function portalMenu(options: {
  staff: boolean; trips: boolean; absence: boolean; tasks: boolean; learning: boolean; learningAdmin: boolean;
}): PortalMenuItem[] {
  const link = (id: MenuIcon, label: string, path: string, application: 'apps' | 'learn' = 'apps'): PortalLink => ({
    id, label, icon: id, path, application,
  });
  return [
    link('home', 'Home', '/'),
    link('streaming', 'Streaming', '/streaming'),
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
