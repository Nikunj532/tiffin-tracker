import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { ErrorNote, Modal, Pagination, SortTh, StatusBadge, useDebounced } from '../components/ui.jsx';
import { useListQuery } from '../useListQuery.js';

const TABS = ['', 'active', 'paused', 'upcoming', 'inactive'];

export default function Customers() {
  const [q, update] = useListQuery({ search: '', status: '', page: 1, limit: 10, sort: 'name', order: 'asc' });
  const [search, setSearch] = useState(q.search);
  const debounced = useDebounced(search);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => { if (debounced !== q.search) update({ search: debounced }); }, [debounced]); // eslint-disable-line

  useEffect(() => {
    setError(null);
    api('/customers', { query: q }).then(setData).catch(setError);
  }, [q.search, q.status, q.page, q.limit, q.sort, q.order, reload]); // eslint-disable-line

  const sortProps = { sort: q.sort, order: q.order, onSort: (sort, order) => update({ sort, order }) };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Customers</h1>
        <button className="btn" onClick={() => setAdding(true)}>+ Add customer</button>
      </div>

      <div className="toolbar">
        <input type="search" className="grow" placeholder="Search name, phone or address…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="tabs" role="tablist">
          {TABS.map((s) => (
            <button key={s || 'all'} role="tab" aria-selected={q.status === s} className={q.status === s ? 'on' : ''} onClick={() => update({ status: s })}>
              {s || 'All'}{data?.counts && s ? ` (${data.counts[s]})` : ''}
            </button>
          ))}
        </div>
      </div>

      <ErrorNote error={error} />
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh label="Name" field="name" {...sortProps} />
                <SortTh label="Phone" field="phone" {...sortProps} />
                <SortTh label="Plan" field="plan" {...sortProps} className="hide-sm" />
                <SortTh label="Status" field="status" {...sortProps} />
                <SortTh label="Added" field="created_at" {...sortProps} className="hide-sm" />
              </tr>
            </thead>
            <tbody>
              {data?.data.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/app/customers/${c.id}`}>{c.name}</Link><div className="muted small">{c.address}</div></td>
                  <td>{c.phone}</td>
                  <td className="hide-sm">{c.plan_name || <span className="muted">—</span>}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="hide-sm muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
              {data && data.data.length === 0 && (
                <tr><td colSpan={5} className="empty">No customers match. {q.search || q.status ? 'Try clearing filters.' : 'Add your first customer.'}</td></tr>
              )}
              {!data && !error && <tr><td colSpan={5} className="empty">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
        {data && (
          <Pagination {...data} onPage={(page) => update({ page }, { resetPage: false })} onLimit={(limit) => update({ limit })} />
        )}
      </div>

      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setReload((n) => n + 1); }} />}
    </div>
  );
}

export function CustomerForm({ customer, onClose, onSaved }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: customer?.name || '', phone: customer?.phone || '', address: customer?.address || '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const saved = customer
        ? await api(`/customers/${customer.id}`, { method: 'PUT', body: form })
        : await api('/customers', { method: 'POST', body: form });
      onSaved(saved);
      if (!customer) navigate(`/app/customers/${saved.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title={customer ? 'Edit customer' : 'Add customer'} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <label>Name<input required value={form.name} onChange={set('name')} autoFocus /></label>
        <label>Phone<input type="tel" required placeholder="10-digit mobile" value={form.phone} onChange={set('phone')} /></label>
        <label>Delivery address<textarea rows={2} value={form.address} onChange={set('address')} /></label>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
