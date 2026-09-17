import { useEffect, useState } from 'react';
import { api, rupees } from '../api.js';
import { ErrorNote, Modal, Pagination, SortTh, useDebounced } from '../components/ui.jsx';
import { useListQuery } from '../useListQuery.js';

export default function Plans() {
  const [q, update] = useListQuery({ search: '', page: 1, limit: 10, sort: 'name', order: 'asc' });
  const [search, setSearch] = useState(q.search);
  const debounced = useDebounced(search);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | {} (new) | plan
  const [reload, setReload] = useState(0);

  useEffect(() => { if (debounced !== q.search) update({ search: debounced }); }, [debounced]); // eslint-disable-line
  useEffect(() => { api('/plans', { query: q }).then(setData).catch(setError); }, [q.search, q.page, q.limit, q.sort, q.order, reload]); // eslint-disable-line

  const remove = async (p) => {
    if (!confirm(`Delete plan "${p.name}"?`)) return;
    try { await api(`/plans/${p.id}`, { method: 'DELETE' }); setReload((n) => n + 1); } catch (err) { setError(err); }
  };
  const sortProps = { sort: q.sort, order: q.order, onSort: (sort, order) => update({ sort, order }) };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Meal plans</h1>
          <p className="muted">Monthly price covers every weekday. Price changes apply to new subscriptions only.</p>
        </div>
        <button className="btn" onClick={() => setEditing({})}>+ New plan</button>
      </div>
      <input type="search" placeholder="Search plans…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ErrorNote error={error} />
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh label="Plan" field="name" {...sortProps} />
                <SortTh label="Monthly price" field="price" {...sortProps} />
                <SortTh label="Subscribers" field="subscribers" {...sortProps} />
                <th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {data?.data.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong><div className="muted small">{p.description}</div></td>
                  <td>{rupees(p.price_paise)}</td>
                  <td>{p.subscribers}</td>
                  <td><span className={`badge ${p.is_active ? 'active' : 'inactive'}`}>{p.is_active ? 'available' : 'retired'}</span></td>
                  <td className="right nowrap">
                    <button className="btn ghost sm" onClick={() => setEditing(p)}>Edit</button>
                    <button className="btn ghost sm danger" onClick={() => remove(p)}>Delete</button>
                  </td>
                </tr>
              ))}
              {data?.data.length === 0 && <tr><td colSpan={5} className="empty">No plans yet. Create one to start subscribing customers.</td></tr>}
            </tbody>
          </table>
        </div>
        {data && <Pagination {...data} onPage={(page) => update({ page }, { resetPage: false })} onLimit={(limit) => update({ limit })} />}
      </div>
      {editing && <PlanForm plan={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload((n) => n + 1); }} />}
    </div>
  );
}

function PlanForm({ plan, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    price: plan ? String(plan.price_paise / 100) : '',
    is_active: plan ? Boolean(plan.is_active) : true,
  });
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, description: form.description, price_paise: Math.round(Number(form.price) * 100), is_active: form.is_active };
    try {
      await api(plan ? `/plans/${plan.id}` : '/plans', { method: plan ? 'PUT' : 'POST', body });
      onSaved();
    } catch (err) { setError(err); }
  };

  return (
    <Modal title={plan ? 'Edit plan' : 'New plan'} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <label>Name<input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>What's included<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label>Monthly price (₹)<input type="number" required min="1" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Available for new subscriptions</label>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn">Save</button>
        </div>
      </form>
    </Modal>
  );
}
