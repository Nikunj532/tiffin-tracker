import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/app" className="brand">🍱 <span>{user.business_name || 'Tiffin Tracker'}</span></NavLink>
        <nav>
          <NavLink to="/app" end>Dashboard</NavLink>
          <NavLink to="/app/customers">Customers</NavLink>
          <NavLink to="/app/plans">Plans</NavLink>
          <NavLink to="/app/bills">Bills</NavLink>
        </nav>
        <div className="user">
          <span className="muted hide-sm">{user.name}</span>
          <button className="btn ghost sm" onClick={() => { logout(); navigate('/'); }}>Log out</button>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
