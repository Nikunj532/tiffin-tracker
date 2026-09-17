import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ErrorNote } from '../components/ui.jsx';

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="auth-page">
      <Link to="/" className="brand big">🍱 Tiffin Tracker</Link>
      <div className="card auth-card">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(form.email, form.password); navigate('/app'); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Log in to manage your tiffin customers.">
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <label>Email<input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Password<input type="password" required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <button className="btn" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <p className="muted small">No account? <Link to="/register">Create one</Link> · Demo: demo@tiffin.app / demo1234</p>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', business_name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await register(form); navigate('/app/plans'); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell title="Start billing fairly" subtitle="Create your tiffin service account. Free.">
      <form onSubmit={submit} className="stack">
        <ErrorNote error={error} />
        <label>Your name<input required value={form.name} onChange={set('name')} /></label>
        <label>Tiffin service name<input placeholder="e.g. Maa Ki Rasoi" value={form.business_name} onChange={set('business_name')} /></label>
        <label>Email<input type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></label>
        <label>Password<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={form.password} onChange={set('password')} /><span className="muted small">8 to 72 characters</span></label>
        <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="muted small">Already registered? <Link to="/login">Log in</Link></p>
      </form>
    </AuthShell>
  );
}
