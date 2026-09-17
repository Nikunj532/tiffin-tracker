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
  const [modal, setModal] = useState(null); // 'edit' | 'subscribe' | 'pause' | 'resume' | 'end' | 'transfer'
  const [transferResult, setTransferResult] = useState(null);

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
      {transferResult && <TransferSummary result={transferResult} onClose={() => setTransferResult(null)} />}

      {current ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{current.plan_name} · {rupees(current.price_paise)}/month</h2>
              <p className="muted small">
                Since {fmtDate(current.start_date)}{current.end_date ? ` · ends ${fmtDate(current.end_date)}` : ''}
                {activePause && <> · <strong>Paused {activePause.end_date ? `until ${fmtDate(activePause.end_date)}` : 'until resumed'}</strong></>}
              </p>
              <TransferNote sub={current} />
            </div>
            <div className="row">
              {activePause
                ? <button className="btn" onClick={() => setModal('resume')}>▶ Resume</button>
                : <button className="btn warn" onClick={() => setModal('pause')}>⏸ Pause</button>}
              {activePause && <button className="btn ghost" onClick={() => setModal('pause')}>Schedule pause</button>}
              {!current.transferred_to && <button className="btn ghost" onClick={() => setModal('transfer')}>⇄ Transfer</button>}
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
          <span>{c.name} has no running subscription.{c.subscriptions[0]?.transferred_to && <> <TransferNote sub={c.subscriptions[0]} /></>}</span>
          <button className="btn" onClick={() => setModal('subscribe')}>Subscribe to a plan</button>
        </div>
      )}

      {(current || c.subscriptions[0]) && <BillPreview sub={current || c.subscriptions[0]} />}

      {c.subscriptions.length > 1 && (
        <div className="card">
          <h2>Subscription history</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Price</th><th>Start</th><th>End</th><th>Pauses</th><th>Transfer</th></tr></thead>
              <tbody>
                {c.subscriptions.map((s) => (
                  <tr key={s.id}><td>{s.plan_name}</td><td>{rupees(s.price_paise)}</td><td>{fmtDate(s.start_date)}</td><td>{fmtDate(s.end_date)}</td><td>{s.pauses.length}</td><td className="small"><TransferNote sub={s} /></td></tr>
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
      {modal === 'transfer' && <TransferForm sub={current} customer={c} onClose={() => setModal(null)} onDone={(r) => { setModal(null); load(); setTransferResult(r); }} />}
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

function TransferNote({ sub }) {
  if (!sub) return null;
  return (
    <>
      {sub.transferred_from && (
        <span className="transfer-note">↪ Taken over from <Link to={`/app/customers/${sub.transferred_from.customer_id}`}>{sub.transferred_from.customer_name}</Link> on {fmtDate(sub.start_date)}</span>
      )}
      {sub.transferred_to && (
        <span className="transfer-note">⇄ Transferred to <Link to={`/app/customers/${sub.transferred_to.customer_id}`}>{sub.transferred_to.customer_name}</Link> from {fmtDate(sub.transferred_to.start_date)}</span>
      )}
    </>
  );
}

function TransferForm({ sub, customer, onClose, onDone }) {
  const t = today();
  const minDate = sub.start_date >= t ? addDaysISO(sub.start_date, 1) : t;
  const [mode, setMode] = useState('existing');
  const [date, setDate] = useState(minDate);
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState(null);
  const [lookupMsg, setLookupMsg] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    setFound(null); setLookupMsg('');
    try {
      const c = await api(`/customers/phone/${encodeURIComponent(phone)}`);
      if (c.id === customer.id) setLookupMsg('That is the current customer.');
      else setFound(c);
    } catch (err) { setLookupMsg(err.status === 404 ? 'No customer with that phone. Use “New customer” instead.' : err.message); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === 'existing' && !found) throw new Error('Look up the customer who is taking over first.');
      const body = mode === 'existing' ? { effective_date: date, to_customer_id: found.id } : { effective_date: date, customer: form };
      onDone(await api(`/subscriptions/${sub.id}/transfer`, { method: 'POST', body }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title="Transfer subscription" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <p className="muted small">
          {customer.name}’s <strong>{sub.plan_name}</strong> ({rupees(sub.price_paise)}/month) passes to someone else mid-cycle.
          The plan, price and cycle carry over; each person is billed only for the weekdays they were served.
        </p>
        <ErrorNote error={error} />
        <label>New holder’s first delivery day
          <input type="date" required min={minDate} max={sub.end_date || undefined} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="muted small">{customer.name}’s last delivery will be the day before. Their pauses after that are dropped.</p>
        <div className="tabs" role="tablist">
          <button type="button" className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')}>Existing customer</button>
          <button type="button" className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>New customer</button>
        </div>
        {mode === 'existing' ? (
          <>
            <div className="row">
              <input type="tel" className="grow" placeholder="Phone of the customer taking over" value={phone} onChange={(e) => { setPhone(e.target.value); setFound(null); }} />
              <button type="button" className="btn ghost" onClick={lookup} disabled={!phone.trim()}>Find</button>
            </div>
            {found && <p className="small">✅ <strong>{found.name}</strong> · {found.phone} <StatusBadge status={found.status} /></p>}
            {lookupMsg && <p className="small muted">{lookupMsg}</p>}
          </>
        ) : (
          <>
            <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Phone<input type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label>Delivery address<textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
          </>
        )}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Transferring…' : 'Transfer'}</button>
        </div>
      </form>
    </Modal>
  );
}

function TransferSummary({ result, onClose }) {
  const s = result.billing_split;
  return (
    <div className="card callout ok stack" style={{ alignItems: 'stretch' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Transferred to <Link to={`/app/customers/${result.to.customer_id}`}>{result.to.customer_name}</Link> from {fmtDate(result.effective_date)}{result.created_customer ? ' (new customer created)' : ''}</strong>
        <button className="btn ghost sm" onClick={onClose}>✕</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{fmtMonth(s.month)}</th><th className="num">Served weekdays</th><th className="num">Paused</th><th className="num">Delivered</th><th className="num">Bill</th></tr></thead>
          <tbody>
            {[s.from, s.to].map((b) => (
              <tr key={b.customer_id}><td>{b.customer_name}</td><td className="num">{b.subscribed_days}/{b.working_days}</td><td className="num">{b.paused_days}</td><td className="num">{b.delivered_days}</td><td className="num"><strong>{rupees(b.amount_paise)}</strong></td></tr>
            ))}
            <tr><td><strong>Combined</strong></td><td /><td /><td /><td className="num"><strong>{rupees(s.combined_amount_paise)}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function addDaysISO(s, n) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
