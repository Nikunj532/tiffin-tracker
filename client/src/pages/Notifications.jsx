import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, today } from '../api.js';
import { ErrorNote, Pagination, SortTh, useDebounced } from '../components/ui.jsx';
import { useListQuery } from '../useListQuery.js';

const TYPE_LABELS = {
  delivery_due: 'Delivery today',
  subscription_transferred_out: 'Transferred out',
  subscription_transferred_in: 'Transferred in',
};

// Survives the page remount that happens when the clock changes.
let lastRun = null;

export default function Notifications() {
  const [q, update] = useListQuery({ date: '', type: '', search: '', page: 1, limit: 20, sort: 'id', order: 'desc' });
  const [search, setSearch] = useState(q.search);
  const debounced = useDebounced(search);
  const [data, setData] = useState(null);
  const [clock, setClock] = useState(null);
  const [jump, setJump] = useState(today());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(lastRun);

  useEffect(() => { api('/clock').then(setClock).catch(setError); }, []);
  useEffect(() => { if (debounced !== q.search) update({ search: debounced }); }, [debounced]); // eslint-disable-line
  useEffect(() => {
    api('/outbox', { query: q }).then(setData).catch(setError);
  }, [q.date, q.type, q.search, q.page, q.limit, q.sort, q.order]); // eslint-disable-line

  const tick = async (body) => {
    setBusy(true); setError(null);
    try {
      const result = await api('/clock', { method: 'POST', body });
      lastRun = result;
      setRun(result);
      window.dispatchEvent(new Event('clock:changed')); // Layout reloads the clock and remounts pages
    } catch (err) { setError(err); setBusy(false); }
  };

  const sortProps = { sort: q.sort, order: q.order, onSort: (sort, order) => update({ sort, order }) };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="muted">Each morning, customers due a delivery (active, a weekday, not paused) get a reminder through the Notification Service.</p>
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>🕒 Clock · {clock ? fmtDate(clock.today) : '…'}</h2>
            <p className="muted small">
              {clock?.simulated ? <>Simulated date (real date {fmtDate(clock.real_today)}). The whole app uses this date.</> : 'Using the real date.'}
            </p>
          </div>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => tick({ advance_days: 1 })}>Next morning ▶</button>
            <button className="btn ghost" disabled={busy} onClick={() => tick({})}>Run this morning</button>
          </div>
        </div>
        <div className="row">
          <input type="date" value={jump} onChange={(e) => setJump(e.target.value)} style={{ width: 'auto' }} />
          <button className="btn ghost" disabled={busy || !jump} onClick={() => tick({ date: jump })}>Jump to date</button>
          {clock?.simulated && <button className="btn ghost" disabled={busy} onClick={() => tick({ reset: true })}>Back to real date</button>}
        </div>
        <p className="muted small">Jumping forward runs every morning in between, so nobody's reminder is skipped. Running a morning twice never sends duplicates.</p>

        {run && run.mornings.length > 0 && (
          <div className="run-result">
            <strong>Last run: {run.notified_total} new notification{run.notified_total === 1 ? '' : 's'}</strong>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Morning</th><th className="num">Due</th><th className="num">Sent</th><th className="num">Already sent</th></tr></thead>
                <tbody>
                  {run.mornings.slice(-10).map((m) => (
                    <tr key={m.date}>
                      <td><button className="linklike" onClick={() => update({ date: m.date })}>{fmtDate(m.date)}</button> {!m.delivery_day && <span className="badge inactive">weekend</span>}</td>
                      <td className="num">{m.due}</td><td className="num">{m.notified}</td><td className="num">{m.already_notified}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {run.mornings.length > 10 && <p className="muted small">Showing the last 10 of {run.mornings.length} mornings.</p>}
          </div>
        )}
      </div>

      <div className="toolbar">
        <input type="search" className="grow" placeholder="Search phone, name or message…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <input type="date" value={q.date} onChange={(e) => update({ date: e.target.value })} style={{ width: 'auto' }} aria-label="Filter by date" />
        <select value={q.type} onChange={(e) => update({ type: e.target.value })} style={{ width: 'auto' }}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {(q.date || q.type || q.search) && <button className="btn ghost sm" onClick={() => { setSearch(''); update({ date: '', type: '', search: '' }); }}>Clear</button>}
      </div>

      <div className="card flush">
        <div className="card-head" style={{ padding: '12px 14px 0' }}><h2>Outbox</h2></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh label="For date" field="for_date" {...sortProps} />
                <SortTh label="To" field="recipient" {...sortProps} />
                <SortTh label="Customer" field="customer" {...sortProps} className="hide-sm" />
                <SortTh label="Type" field="type" {...sortProps} />
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{fmtDate(m.date)}</td>
                  <td className="nowrap">📱 {m.to}</td>
                  <td className="hide-sm">{m.customer_id ? <Link to={`/app/customers/${m.customer_id}`}>{m.customer_name}</Link> : '—'}</td>
                  <td><span className={`badge ${m.type === 'delivery_due' ? 'active' : 'upcoming'}`}>{TYPE_LABELS[m.type] || m.type}</span></td>
                  <td className="small">{m.message}</td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr><td colSpan={5} className="empty">No notifications{q.date || q.type || q.search ? ' match these filters' : ' yet. Click “Run this morning” to send today’s reminders'}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data && <Pagination {...data} onPage={(page) => update({ page }, { resetPage: false })} onLimit={(limit) => update({ limit })} />}
      </div>
    </div>
  );
}
