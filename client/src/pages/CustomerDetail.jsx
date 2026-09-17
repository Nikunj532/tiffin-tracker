import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, fmtMonth, rupees, today } from '../api.js';
import { ErrorNote, Modal, StatusBadge } from '../components/ui.jsx';
import { CustomerForm } from './Customers.jsx';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // 'edit' | 'subscribe' | 'pause' | 'resume' | 'end'

  const load = useCallback(() => api(`/customers/${id}`).then(setC).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);

  if (error && !c) return <ErrorNote error={error} />;
  if (!c) return <p className="muted">Loading…</p>;

  const t = today();
  const current = c.subscriptions.find((s) => !s.end_date || s.end_date >= t);
  const activePause = current?.pauses.find((p) => p.start_date <= t && (!p.end_date || p.end_date >= t));
  const done = () => { setModal(null); load(); };

  const remove = async () => {
    if (!confirm(`Delete ${c.name} and all their subscription history? This cannot be undone.`)) return;
    try { await api(`/customers/${c.id}`, { method: 'DELETE' }); navigate('/app/customers'); } catch (err) { setError(err); }
  };
  const cancelPause = async (p) => {
    if (!confirm(`Remove the pause from ${fmtDate(p.start_date)}? Those days will be billed.`)) return;
    try { await api(`/pauses/${p.id}`, { method: 'DELETE' }); load(); } catch (err) { setError(err); }
  };

  return (
    <div className="stack-lg">
      <Link to="/app/customers" className="small">← Customers</Link>
      <div className="page-head">
        <div>
          <h1>{c.name} <StatusBadge status={c.status} /></h1>
          <p className="muted">📞 {c.phone}{c.address ? ` · 📍 ${c.address}` : ''}</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => setModal('edit')}>Edit</button>
          <button className="btn ghost danger" onClick={remove}>Delete</button>
        </div>
      </div>
      <ErrorNote error={error} />

      {current ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{current.plan_name} · {rupees(current.price_paise)}/month</h2>
              <p className="muted small">
                Since {fmtDate(current.start_date)}{current.end_date ? ` · ends ${fmtDate(current.end_date)}` : ''}
                {activePause && <> · <strong>Paused {activePause.end_date ? `until ${fmtDate(activePause.end_date)}` : 'until resumed'}</strong></>}
              </p>
            </div>
            <div className="row">
              {activePause
                ? <button className="btn" onClick={() => setModal('resume')}>▶ Resume</button>
                : <button className="btn warn" onClick={() => setModal('pause')}>⏸ Pause</button>}
              {activePause && <button className="btn ghost" onClick={() => setModal('pause')}>Schedule pause</button>}
              {!current.end_date && <button className="btn ghost" onClick={() => setModal('end')}>End subscription</button>}
            </div>
          </div>

          <h3>Pauses</h3>
          {current.pauses.length === 0 ? <p className="muted">No pauses. Every weekday is billed.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>From</th><th>To</th><th>Reason</th><th /></tr></thead>
                <tbody>
                  {current.pauses.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.start_date)}</td>
                      <td>{p.end_date ? fmtDate(p.end_date) : <em>until resumed</em>}</td>
                      <td className="muted">{p.reason || '—'}</td>
                      <td className="right"><button className="btn ghost sm" onClick={() => cancelPause(p)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card callout">
          <span>{c.name} has no running subscription.</span>
          <button className="btn" onClick={() => setModal('subscribe')}>Subscribe to a plan</button>
        </div>
      )}

      {(current || c.subscriptions[0]) && <BillPreview sub={current || c.subscriptions[0]} />}

      {c.subscriptions.length > 1 && (
        <div className="card">
          <h2>Subscription history</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Price</th><th>Start</th><th>End</th><th>Pauses</th></tr></thead>
              <tbody>
                {c.subscriptions.map((s) => (
                  <tr key={s.id}><td>{s.plan_name}</td><td>{rupees(s.price_paise)}</td><td>{fmtDate(s.start_date)}</td><td>{fmtDate(s.end_date)}</td><td>{s.pauses.length}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal === 'edit' && <CustomerForm customer={c} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'subscribe' && <SubscribeForm customer={c} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'pause' && <PauseForm sub={current} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'resume' && <DateAction title="Resume deliveries" label="First delivery day" submitLabel="Resume" hint="The pause ends the day before this date."
        path={`/subscriptions/${current.id}/resume`} field="date" min={activePause.start_date} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'end' && <DateAction title="End subscription" label="Last delivery day" submitLabel="End subscription" hint="The customer is billed up to and including this day."
        path={`/subscriptions/${current.id}/end`} field="end_date" min={current.start_date} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

function SubscribeForm({ customer, onClose, onDone }) {
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState({ plan_id: '', start_date: today() });
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/plans', { query: { limit: 100 } }).then((r) => {
      const active = r.data.filter((p) => p.is_active);
      setPlans(active);
      if (active[0]) setForm((f) => ({ ...f, plan_id: active[0].id }));
    }).catch(setError);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    try { await api(`/customers/${customer.id}/subscriptions`, { method: 'POST', body: { ...form, plan_id: Number(form.plan_id) } }); onDone(); }
    catch (err) { setError(err); }
  };

  return (
    <Modal title={`Subscribe ${customer.name}`} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        {plans.length === 0 ? <p className="muted">No active plans. <Link to="/app/plans">Create one first.</Link></p> : (
          <>
            <label>Plan
              <select value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} – {rupees(p.price_paise)}/month</option>)}
              </select>
            </label>
            <label>Start date<input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
            <div className="row end">
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn">Subscribe</button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

function PauseForm({ sub, onClose, onDone }) {
  const [form, setForm] = useState({ start_date: today(), end_date: '', reason: '' });
  const [openEnded, setOpenEnded] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api(`/subscriptions/${sub.id}/pause`, { method: 'POST', body: { ...form, end_date: openEnded ? null : form.end_date } });
      onDone();
    } catch (err) { setError(err); }
  };

  return (
    <Modal title="Pause deliveries" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <div className="grid2">
          <label>First paused day<input type="date" required min={sub.start_date} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
          <label>Last paused day<input type="date" required={!openEnded} disabled={openEnded} min={form.start_date} value={openEnded ? '' : form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={openEnded} onChange={(e) => setOpenEnded(e.target.checked)} /> Pause until I resume manually</label>
        <label>Reason (optional)<input placeholder="Travel, festival, unwell…" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        <p className="muted small">Paused weekdays are not billed.</p>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn warn">Pause</button>
        </div>
      </form>
    </Modal>
  );
}

function DateAction({ title, label, hint, submitLabel, path, field, min, onClose, onDone }) {
  const [date, setDate] = useState(today());
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try { await api(path, { method: 'POST', body: { [field]: date } }); onDone(); } catch (err) { setError(err); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <label>{label}<input type="date" required min={min} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <p className="muted small">{hint}</p>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn">{submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

function BillPreview({ sub }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [bill, setBill] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    api(`/subscriptions/${sub.id}/bill`, { query: { month } }).then(setBill).catch(setError);
  }, [sub, month]);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Bill for {fmtMonth(month)}</h2>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      <ErrorNote error={error} />
      {bill && (
        <div className="bill-grid">
          <div>
            <div className="bill-amount">{rupees(bill.amount_paise)}</div>
            <p className="muted small">{rupees(bill.price_paise)} × {bill.delivered_days} delivered ÷ {bill.working_days} weekdays in month</p>
            <dl className="facts">
              <dt>Weekdays in month</dt><dd>{bill.working_days}</dd>
              <dt>Subscribed weekdays</dt><dd>{bill.subscribed_days}</dd>
              <dt>Paused weekdays</dt><dd>{bill.paused_days}</dd>
              <dt>Delivered</dt><dd><strong>{bill.delivered_days}</strong></dd>
            </dl>
          </div>
          <MonthCalendar month={month} sub={sub} />
        </div>
      )}
    </div>
  );
}

/** Visual calendar mirroring the server's billing rules. */
function MonthCalendar({ month, sub }) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday-first
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<div key={`x${i}`} />);
  for (let d = 1; d <= days; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    const dow = new Date(y, m - 1, d).getDay();
    let cls = 'delivered';
    if (dow === 0 || dow === 6) cls = 'weekend';
    else if (ds < sub.start_date || (sub.end_date && ds > sub.end_date)) cls = 'outside';
    else if (sub.pauses.some((p) => p.start_date <= ds && (!p.end_date || ds <= p.end_date))) cls = 'paused';
    cells.push(<div key={ds} className={`day ${cls}`} title={`${fmtDate(ds)}: ${cls}`}>{d}</div>);
  }
  return (
    <div>
      <div className="cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="dow">{d}</div>)}
        {cells}
      </div>
      <div className="legend small">
        <span><i className="day delivered" /> Delivered</span>
        <span><i className="day paused" /> Paused</span>
        <span><i className="day weekend" /> Weekend</span>
        <span><i className="day outside" /> Not subscribed</span>
      </div>
    </div>
  );
}
