import { useState } from 'react';
import { NavLink } from 'react-router';
import { CalendarDays, CalendarOff, CarFront, ChevronDown, ClipboardList, GraduationCap, Home, MonitorPlay, Plane, ShieldCheck } from 'lucide-react';
import type { MenuIcon, PortalLink, PortalMenuItem } from '../../../shared/portalMenu';

const icons = {
  home: Home, streaming: MonitorPlay, learning: GraduationCap, parking: CarFront, trips: Plane,
  absence: CalendarOff, tasks: ClipboardList, timetable: CalendarDays, classes: GraduationCap, admin: ShieldCheck,
} satisfies Record<MenuIcon, typeof Home>;

export interface PortalLinksProps {
  items: PortalMenuItem[];
  application: 'apps' | 'learn';
  portalUrl: string;
  learningUrl: string | null;
}
function MenuLink({ item, application, portalUrl, learningUrl }: PortalLinksProps & { item: PortalLink }) {
  const Icon = icons[item.icon];
  const content = <><Icon size={18} /><span className="jess-nav-link-label">{item.label}</span></>;
  if (item.application === application) return <NavLink to={item.path} end={item.path === '/'} title={item.label} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>{content}</NavLink>;
  const base = item.application === 'apps' ? portalUrl : learningUrl;
  return base ? <a href={new URL(item.path, base).toString()} title={item.label} className="nav-link">{content}</a> : null;
}
function MenuGroup({ item, ...props }: PortalLinksProps & { item: PortalMenuItem & { children: PortalLink[] } }) {
  const [open, setOpen] = useState(props.application === 'learn');
  const Icon = icons[item.icon];
  return <div className="jess-nav-group">
    <button className="nav-link jess-nav-group-toggle" type="button" title={item.label} aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon size={18} /><span className="jess-nav-link-label">{item.label}</span><ChevronDown size={16} className="jess-nav-group-chevron" />
    </button>
    <ul className="jess-nav-group-items" hidden={!open}>{item.children.map((child) => <li key={child.id}><MenuLink {...props} item={child} /></li>)}</ul>
  </div>;
}
export function PortalLinks(props: PortalLinksProps) {
  return <>{props.items.map((item) => <li key={item.id}>
    {'children' in item ? <MenuGroup {...props} item={item} /> : <MenuLink {...props} item={item} />}
  </li>)}</>;
}
