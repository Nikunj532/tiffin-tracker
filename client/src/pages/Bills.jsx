import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtMonth, rupees, today } from '../api.js';
import { ErrorNote, Pagination, SortTh, useDebounced } from '../components/ui.jsx';
import { useListQuery } from '../useListQuery.js';

export default function Bills() {
  const [q, update] = useListQuery({ month: today().slice(0, 7), search: '', page: 1, limit: 10, sort: 'name', order: 'asc' });
  const [search, setSearch] = useState(q.search);
  const debounced = useDebounced(search);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => { if (debounced !== q.search) update({ search: debounced }); }, [debounced]); // eslint-disable-line
  useEffect(() => { api('/bills', { query: q }).then(setData).catch(setError); }, [q.month, q.search, q.page, q.limit, q.sort, q.order, reload]); // eslint-disable-line

  const generate = async () => {
    setBusy(true); setError(null);
    try { await api('/bills/generate', { method: 'POST', body: { month: q.month } }); setReload((n) => n + 1); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };

  const sortProps = { sort: q.sort, order: q.order, onSort: (sort, order) => update({ sort, order }) };
  const hasBills = data && (data.total > 0 || q.search);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Monthly bills</h1>
          <p className="muted">Plan price × delivered weekdays ÷ weekdays in month. Paused days are never charged.</p>
        </div>
        <div className="row">
          <input type="month" value={q.month} onChange={(e) => e.target.value && update({ month: e.target.value })} />
          <button className="btn" onClick={generate} disabled={busy}>{busy ? 'Generating…' : hasBills ? 'Regenerate' : 'Generate bills'}</button>
        </div>
      </div>
      <ErrorNote error={error} />

      {data && hasBills && (
        <div className="stats">
          <div className="card stat accent"><div className="stat-value">{rupees(data.summary.total_amount_paise)}</div><div className="stat-label">Total to collect · {fmtMonth(q.month)}</div></div>
          <div className="card stat"><div className="stat-value">{data.total}</div><div className="stat-label">Bills</div></div>
          <div className="card stat"><div className="stat-value">{data.summary.delivered_days}</div><div className="stat-label">Tiffins delivered</div></div>
          <div className="card stat"><div className="stat-value">{data.summary.paused_days}</div><div className="stat-label">Paused days (not charged)</div></div>
        </div>
      )}

      {data && !hasBills ? (
        <div className="card callout">
          <span>No bills generated for {fmtMonth(q.month)} yet.</span>
          <button className="btn" onClick={generate} disabled={busy}>Generate now</button>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <input type="search" className="grow" placeholder="Search by customer name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {data?.generated_at && <span className="muted small">Last generated {new Date(`${data.generated_at.replace(' ', 'T')}Z`).toLocaleString('en-IN')}</span>}
          </div>
          <div className="card flush">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortTh label="Customer" field="name" {...sortProps} />
                    <SortTh label="Plan" field="plan" {...sortProps} className="hide-sm" />
                    <th className="num">Weekdays</th>
                    <SortTh label="Paused" field="paused" {...sortProps} className="num" />
                    <SortTh label="Delivered" field="delivered" {...sortProps} className="num" />
                    <SortTh label="Amount" field="amount" {...sortProps} className="num" />
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map((b) => (
                    <tr key={b.id}>
                      <td><Link to={`/app/customers/${b.customer_id}`}>{b.customer_name}</Link><div className="muted small">{b.customer_phone}</div></td>
                      <td className="hide-sm">{b.plan_name}<div className="muted small">{rupees(b.price_paise)}/mo</div>
                        {b.transferred_from_name && <div className="transfer-note">↪ from {b.transferred_from_name}</div>}
                        {b.transferred_to_name && <div className="transfer-note">⇄ to {b.transferred_to_name}</div>}</td>
                      <td className="num">{b.subscribed_days}/{b.working_days}</td>
                      <td className="num">{b.paused_days}</td>
                      <td className="num">{b.delivered_days}</td>
                      <td className="num"><strong>{rupees(b.amount_paise)}</strong></td>
                    </tr>
                  ))}
                  {data?.data.length === 0 && <tr><td colSpan={6} className="empty">No bills match your search.</td></tr>}
                </tbody>
              </table>
            </div>
            {data && <Pagination {...data} onPage={(page) => update({ page }, { resetPage: false })} onLimit={(limit) => update({ limit })} />}
          </div>
        </>
      )}
    </div>
  );
}
