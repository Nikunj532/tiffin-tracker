import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api, fmtDate, setServerToday } from '../api.js';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [clock, setClock] = useState(null);

  useEffect(() => {
    const load = () => api('/clock')
      .then((c) => { setServerToday(c.today); setClock(c); })
      .catch(() => setClock({ today: null, simulated: false }));
    load();
    window.addEventListener('clock:changed', load);
    return () => window.removeEventListener('clock:changed', load);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/app" className="brand">🍱 <span>{user.business_name || 'Tiffin Tracker'}</span></NavLink>
        <nav>
          <NavLink to="/app" end>Dashboard</NavLink>
          <NavLink to="/app/customers">Customers</NavLink>
          <NavLink to="/app/plans">Plans</NavLink>
          <NavLink to="/app/bills">Bills</NavLink>
          <NavLink to="/app/notifications">Notifications</NavLink>
          <NavLink to="/app/import">Import</NavLink>
        </nav>
        <div className="user">
          {clock?.simulated && (
            <Link to="/app/notifications" className="clock-pill" title="The app is running on a simulated date">🕒 {fmtDate(clock.today)}</Link>
          )}
          <span className="muted hide-sm">{user.name}</span>
          <button className="btn ghost sm" onClick={() => { logout(); navigate('/'); }}>Log out</button>
        </div>
      </header>
      <main className="container">
        {/* Key on the date so every page re-reads "today" when the clock moves. */}
        {clock ? <Outlet key={clock.today} /> : <p className="muted" style={{ paddingTop: 24 }}>Loading…</p>}
      </main>
    </div>
  );
}
