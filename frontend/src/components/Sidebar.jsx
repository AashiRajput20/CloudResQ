import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/services', label: 'Services' },
  { to: '/instances', label: 'Instances' },
  { to: '/recovery-history', label: 'Recovery History' },
  { to: '/failure-history', label: 'Failure History' },
  { to: '/scaling-history', label: 'Scaling History' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/settings', label: 'System Settings' },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">CLOUDRESQ</div>
      <nav>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}