import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorNote } from '../components/ui.jsx';

const SAMPLE = `Customer Name,Mobile No,Address,Meal Plan,Start Date
ASHA IYER,+91 92000 00001,"12, MG Road",veg mini,01/09/2026
Ravi Kumar,92000-00002,,Non-Veg Thali,2026-09-03
asha iyer,9200000001,,Veg Mini,5 Sep 2026
,9200000003,,Veg Mini,2026-09-01
Meena,,,Veg Mini,2026-09-01
Kiran,9200000004,,Veg Mini,
Tara,9200000005,,Pizza Plan,2026-09-01
Neha Joshi,9200000006,,VEG FULL THALI,Sep 25 2026
`;

export default function ImportCustomers() {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [plans, setPlans] = useState([]);
  const [defaultPlan, setDefaultPlan] = useState('');
  const [defaultStart, setDefaultStart] = useState('');
  const [report, setReport] = useState(null);
  const [tab, setTab] = useState('imported');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/plans', { query: { limit: 100 } }).then((r) => setPlans(r.data.filter((p) => p.is_active))).catch(setError); }, []);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result)); setReport(null); };
    reader.readAsText(file);
  };

  const submit = async (dryRun) => {
    setBusy(true); setError(null);
    try {
      const r = await api('/import/customers', {
        method: 'POST',
        body: { csv, dry_run: dryRun, default_plan_id: defaultPlan ? Number(defaultPlan) : undefined, default_start_date: defaultStart || undefined },
      });
      setReport(r);
      setTab(r.imported ? 'imported' : r.rejected ? 'rejected' : 'deduped');
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Import customers</h1>
          <p className="muted">Paste or upload a customer list, even a messy one. Phones are cleaned, dates in mixed formats are read, duplicates are merged, and bad rows are listed with reasons.</p>
        </div>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <label className="btn ghost" style={{ flexDirection: 'row' }}>
            📄 Choose CSV file
            <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} hidden />
          </label>
          <span className="muted small">{fileName || 'or paste below'}</span>
          <button className="btn ghost sm" onClick={() => { setCsv(SAMPLE); setFileName(''); setReport(null); }}>Load messy sample</button>
        </div>
        <textarea rows={9} className="mono" placeholder={'name,phone,address,plan,start_date\nAsha Iyer,9876543210,"12, MG Road",Veg Mini,01/09/2026'}
          value={csv} onChange={(e) => { setCsv(e.target.value); setReport(null); }} />
        <p className="muted small">
          Columns are matched by name (<code>name</code>/<code>customer</code>, <code>phone</code>/<code>mobile</code>, <code>address</code>, <code>plan</code>, <code>start_date</code>/<code>start</code>).
          Dates like 2026-09-01, 01/09/2026, 1 Sep 2026 and Sep 1, 2026 all work; ambiguous dd/mm are read day-first.
          Plans are matched to <Link to="/app/plans">your plans</Link> by name.
        </p>
        <div className="grid2">
          <label>Plan when blank (optional)
            <select value={defaultPlan} onChange={(e) => setDefaultPlan(e.target.value)}>
              <option value="">Reject rows without a plan</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Start date when blank (optional)
            <input type="date" value={defaultStart} onChange={(e) => setDefaultStart(e.target.value)} />
          </label>
        </div>
        <ErrorNote error={error} />
        <div className="row end">
          <button className="btn ghost" disabled={busy || !csv.trim()} onClick={() => submit(true)}>Preview (no changes)</button>
          <button className="btn" disabled={busy || !csv.trim()} onClick={() => submit(false)}>{busy ? 'Working…' : 'Import'}</button>
        </div>
      </div>

      {report && (
        <>
          <div className={`card callout ${report.dry_run ? '' : 'ok'}`}>
            <span>{report.dry_run ? 'Preview only: nothing has been saved yet.' : 'Import complete.'} {report.total_rows} rows read{report.blank_rows_ignored ? `, ${report.blank_rows_ignored} empty line(s) ignored` : ''}{report.unknown_columns.length ? `, ignored columns: ${report.unknown_columns.join(', ')}` : ''}.</span>
            {report.dry_run && report.imported > 0 && <button className="btn" onClick={() => submit(false)} disabled={busy}>Import {report.imported} now</button>}
          </div>
          <div className="stats">
            {[['imported', '✅ Imported', 'active'], ['deduped', '🔁 Deduped', 'upcoming'], ['rejected', '⛔ Rejected', 'paused']].map(([k, label]) => (
              <button key={k} className={`card stat stat-btn ${tab === k ? 'selected' : ''}`} onClick={() => setTab(k)}>
                <div className="stat-value">{report[k]}</div><div className="stat-label">{label}</div>
              </button>
            ))}
          </div>

          <div className="card flush">
            <div className="table-wrap">
              {tab === 'imported' && (
                <table>
                  <thead><tr><th>Row</th><th>Customer</th><th>Phone</th><th>Plan</th><th>Start</th><th>Notes</th></tr></thead>
                  <tbody>
                    {report.details.imported.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>{r.customer_id ? <Link to={`/app/customers/${r.customer_id}`}>{r.name}</Link> : r.name} <span className={`badge ${r.customer === 'new' ? 'active' : 'upcoming'}`}>{r.customer}</span></td>
                        <td>{r.phone}</td><td>{r.plan}</td><td className="nowrap">{r.start_date}</td>
                        <td className="small muted">{r.warnings.join('; ') || '—'}</td>
                      </tr>
                    ))}
                    {!report.details.imported.length && <tr><td colSpan={6} className="empty">Nothing imported.</td></tr>}
                  </tbody>
                </table>
              )}
              {tab === 'deduped' && (
                <table>
                  <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Why skipped</th></tr></thead>
                  <tbody>
                    {report.details.deduped.map((r) => (
                      <tr key={r.row}><td>{r.row}</td><td>{r.name}</td><td>{r.phone}</td><td className="small">{r.reason}</td></tr>
                    ))}
                    {!report.details.deduped.length && <tr><td colSpan={4} className="empty">No duplicates.</td></tr>}
                  </tbody>
                </table>
              )}
              {tab === 'rejected' && (
                <table>
                  <thead><tr><th>Row</th><th>Data</th><th>Problems</th></tr></thead>
                  <tbody>
                    {report.details.rejected.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td className="small mono">{Object.values(r.data).map((v) => String(v ?? '').trim() || '∅').join(' | ')}</td>
                        <td><ul className="reasons">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul></td>
                      </tr>
                    ))}
                    {!report.details.rejected.length && <tr><td colSpan={3} className="empty">No rejected rows.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
