import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { NavLink, useLocation } from 'react-router';
import { CalendarDays, CalendarOff, CarFront, ChevronDown, ClipboardList, GraduationCap, Home, MessageCircle, MonitorPlay, Plane, ShieldCheck } from 'lucide-react';
import { desktopPortalMenu, type MenuIcon, type PortalGroup, type PortalLink, type PortalMenuItem } from '../../../shared/portalMenu';

const icons = {
  home: Home, streaming: MonitorPlay, communication: MessageCircle, learning: GraduationCap, parking: CarFront, trips: Plane,
  absence: CalendarOff, tasks: ClipboardList, timetable: CalendarDays, classes: GraduationCap, admin: ShieldCheck,
} satisfies Record<MenuIcon, typeof Home>;

export interface PortalLinksProps {
  items: PortalMenuItem[];
  application: 'apps' | 'learn';
  portalUrl: string;
  learningUrl: string | null;
  teams?: boolean;
  desktop?: boolean;
  roles?: readonly string[];
}
function DesktopMenuGroup({ item, ...props }: PortalLinksProps & { item: PortalGroup }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const group = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (open && pendingFocus.current !== null) {
      group.current?.querySelectorAll<HTMLAnchorElement>('a')[pendingFocus.current]?.focus();
      pendingFocus.current = null;
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!group.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a'));
    if (!links.length) return;
    event.preventDefault();
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % links.length : (index <= 0 ? links.length : index) - 1;
    if (open) links[next]?.focus();
    else {
      pendingFocus.current = next;
      setOpen(true);
    }
  };
  return <div className="jess-nav-top-group" ref={group} onKeyDown={keys} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} className="jess-nav-top-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {item.label}<ChevronDown size={16} aria-hidden="true" />
    </button>
    <ul id={id} className="jess-nav-top-items" hidden={!open} onClick={(event) => {
      if ((event.target as Element).closest('a')) setOpen(false);
    }}>{item.children.map((child) => <li key={child.id}><MenuLink {...props} item={child} /></li>)}</ul>
  </div>;
}
function MenuLink({ item, application, portalUrl, learningUrl, teams }: PortalLinksProps & { item: PortalLink }) {
  const Icon = icons[item.icon];
  const content = <><Icon size={18} /><span className="jess-nav-link-label">{item.label}</span></>;
  if (item.application === application) return <NavLink to={item.path} end={item.path === '/'} title={item.label} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>{content}</NavLink>;
  const base = item.application === 'apps' ? portalUrl : learningUrl;
  if (!base) return null;
  const target = new URL(item.path, base);
  if (teams) target.searchParams.set('teams', '1');
  return <a href={target.toString()} title={item.label} className="nav-link">{content}</a>;
}
function MenuGroup({ item, ...props }: PortalLinksProps & { item: PortalMenuItem & { children: PortalLink[] } }) {
  const [open, setOpen] = useState(props.application === 'learn' && item.id === 'learning');
  const id = useId();
  const Icon = icons[item.icon];
  return <div className="jess-nav-group">
    <button className="nav-link jess-nav-group-toggle" type="button" title={item.label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <Icon size={18} /><span className="jess-nav-link-label">{item.label}</span><ChevronDown size={16} className="jess-nav-group-chevron" />
    </button>
    <ul id={id} className="jess-nav-group-items" hidden={!open}>{item.children.map((child) => <li key={child.id}><MenuLink {...props} item={child} /></li>)}</ul>
  </div>;
}
export function PortalLinks(props: PortalLinksProps) {
  const items = props.desktop || props.roles ? desktopPortalMenu(props.items, props.roles ?? []) : props.items;
  return <>{items.map((item) => <li key={item.id}>
    {'children' in item ? props.desktop ? <DesktopMenuGroup {...props} item={item} /> : <MenuGroup {...props} item={item} /> : <MenuLink {...props} item={item} />}
  </li>)}</>;
}
