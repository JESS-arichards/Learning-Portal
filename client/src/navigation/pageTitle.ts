export function navigationTitle(application: 'apps' | 'learn', pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (application === 'learn') {
    const page = parts.length === 0 ? 'My Timetable'
      : parts[0] === 'classes' ? 'My Classes'
      : parts[0] === 'admin' ? 'Administration' : null;
    return page ? `Learning Portal - ${page}` : 'Learning Portal';
  }
  const pages: Record<string, string> = {
    parking: 'Parking', streaming: 'Streaming', trips: 'Trip Communicator',
    'staff-absence': 'Staff Absence', tasks: 'Task Tracking', profile: 'My Profile',
  };
  const adminPages: Record<string, string> = {
    users: 'Users', 'parent-blocklist': 'Parent Blocklist', branding: 'Branding',
    streaming: 'Streaming', trips: 'Trip Communicator', parking: 'Parking',
    'staff-absence': 'Staff Absence', reports: 'Profile Reports',
    notifications: 'Notifications', audit: 'Audit Log',
  };
  const page = parts[0] === 'admin'
    ? `Admin${adminPages[parts[1]] ? ` - ${adminPages[parts[1]]}` : ''}`
    : parts.length === 0 ? 'Home' : pages[parts[0]];
  return page ? `Applications Portal - ${page}` : 'Applications Portal';
}
