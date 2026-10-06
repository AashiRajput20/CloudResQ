import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

// Sidebar on the left, the current page on the right.
export default function Layout() {
  return (
    <div className="layout">
      <Sidebar />
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}