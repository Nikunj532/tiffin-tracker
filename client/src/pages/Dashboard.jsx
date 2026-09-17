import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, fmtDate, fmtMonth, rupees } from '../api.js';
import { ErrorNote } from '../components/ui.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [phone, setPhone] = useState('');
  const [lookupError, setLookupError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { api('/dashboard').then(setData).catch(setError); }, []);

  const lookup = async (e) => {
    e.preventDefault();
    setLookupError(null);
    try {
      const c = await api(`/customers/phone/${encodeURIComponent(phone)}`);
      navigate(`/app/customers/${c.id}`);
    } catch (err) {
      setLookupError(err instanceof ApiError && err.status === 404 ? new Error(`No customer with phone ${phone}`) : err);
    }
  };

  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Today · {fmtDate(data.as_of)}</h1>
          <p className="muted">{data.is_delivery_day ? 'Delivery day' : 'No deliveries today (weekend)'}</p>
        </div>
        <form className="lookup" onSubmit={lookup}>
          <input type="tel" required placeholder="Find customer by phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="btn">Look up</button>
        </form>
      </div>
      <ErrorNote error={lookupError} />

      {data.plans === 0 && (
        <div className="card callout">
          <strong>Get started:</strong> create your first meal plan, then add customers and subscribe them.
          <Link className="btn sm" to="/app/plans">Create a plan</Link>
        </div>
      )}

      <div className="stats">
        <Stat label="Tiffins to deliver today" value={data.meals_today} accent />
        <Stat label="Active" value={data.counts.active} to="/app/customers?status=active" />
        <Stat label="Paused" value={data.counts.paused} to="/app/customers?status=paused" />
        <Stat label="Upcoming" value={data.counts.upcoming} to="/app/customers?status=upcoming" />
        <Stat label={`Projected bill total · ${fmtMonth(data.month)}`} value={rupees(data.projected_month_revenue_paise)} to="/app/bills" />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Paused today</h2>
          <Link to="/app/customers?status=paused" className="small">View all →</Link>
        </div>
        {data.paused_today.length === 0 ? (
          <p className="muted">Nobody is paused today.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Phone</th><th>Paused</th><th>Reason</th></tr></thead>
              <tbody>
                {data.paused_today.map((p) => (
                  <tr key={`${p.id}-${p.start_date}`}>
                    <td><Link to={`/app/customers/${p.id}`}>{p.name}</Link></td>
                    <td>{p.phone}</td>
                    <td>{fmtDate(p.start_date)} → {p.end_date ? fmtDate(p.end_date) : 'until resumed'}</td>
                    <td className="muted">{p.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, to, accent }) {
  const inner = (<><div className="stat-value">{value}</div><div className="stat-label">{label}</div></>);
  return to ? <Link to={to} className={`card stat ${accent ? 'accent' : ''}`}>{inner}</Link> : <div className={`card stat ${accent ? 'accent' : ''}`}>{inner}</div>;
}
