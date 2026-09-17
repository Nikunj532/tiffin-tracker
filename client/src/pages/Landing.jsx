import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const FEATURES = [
  ['⏸', 'Pause & resume in one tap', 'Travel, Diwali at home, a sick day: log a pause with dates or leave it open. Paused days are never charged.'],
  ['🧮', 'Fair pro-rated bills', 'Plan price × delivered weekdays ÷ weekdays in the month, worked out exactly. No spreadsheets and no arguments.'],
  ['📞', 'Find anyone by phone', 'Type the number a customer calls from and their plan, pauses and bill come up right away.'],
  ['🟢', 'Active vs paused at a glance', 'See how many tiffins to cook today and who is paused, upcoming or inactive.'],
  ['🗓', 'Delivery calendar', 'Each customer’s month shown day by day: delivered, paused, weekend, not subscribed.'],
  ['🔎', 'Search, sort, paginate', 'Handles 30 customers or 3,000. Filter, sort and page through customers, plans and bills.'],
];

const NEXT = [
  ['💬 WhatsApp bills + UPI links', 'Send each customer their monthly bill on WhatsApp with a UPI payment link, and mark bills paid automatically.'],
  ['🙋 Customer self-service pauses', 'A private link where customers pause or resume themselves before a daily cut-off, so the owner stops fielding calls.'],
  ['🛵 Kitchen & route sheet', 'A daily cooking count per plan and delivery routes grouped by area, printable for the delivery staff.'],
];

export default function Landing() {
  const { user } = useAuth();
  const cta = user ? { to: '/app', label: 'Open dashboard' } : { to: '/register', label: 'Start free' };

  return (
    <div className="landing">
      <header className="land-nav container">
        <span className="brand big">🍱 Tiffin Tracker</span>
        <nav className="row">
          {!user && <Link to="/login" className="btn ghost">Log in</Link>}
          <Link to={cta.to} className="btn">{cta.label}</Link>
        </nav>
      </header>

      <section className="hero container">
        <div>
          <p className="eyebrow">For home kitchens & tiffin services</p>
          <h1>Bill every customer only for the days you actually served.</h1>
          <p className="lead">
            Tiffin Tracker keeps your monthly lunch subscriptions, pauses and bills in one place. Customers pause for travel or festivals,
            and at month-end every bill is pro-rated automatically.
          </p>
          <div className="row">
            <Link to={cta.to} className="btn lg">{cta.label}</Link>
            {!user && <Link to="/login" className="btn ghost lg">Try the demo</Link>}
          </div>
          {!user && <p className="muted small">Demo login: demo@tiffin.app / demo1234</p>}
        </div>
        <div className="card hero-card" aria-hidden>
          <div className="muted small">September bill · Priya Iyer</div>
          <div className="bill-amount">₹2,318</div>
          <div className="muted small">₹3,000 × 17 delivered ÷ 22 weekdays</div>
          <div className="cal mini">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={`h${i}`} className="dow">{d}</div>)}
            <div />{/* Sept 2026 starts on a Tuesday */}
            {Array.from({ length: 30 }, (_, i) => {
              const d = i + 1; const dow = (d + 1) % 7;
              const cls = dow === 0 || dow === 6 ? 'weekend' : d >= 7 && d <= 11 ? 'paused' : 'delivered';
              return <div key={d} className={`day ${cls}`}>{d}</div>;
            })}
          </div>
          <div className="legend small"><span><i className="day delivered" /> Delivered</span><span><i className="day paused" /> Paused (Travel)</span></div>
        </div>
      </section>

      <section className="container band">
        <h2>The problem</h2>
        <div className="grid3">
          <div><h3>Notebook chaos</h3><p className="muted">Pauses scribbled in a diary or buried in WhatsApp chats get missed at month-end.</p></div>
          <div><h3>Awkward disputes</h3><p className="muted">“I was away that week!” Overcharging loses trust, and undercharging loses money.</p></div>
          <div><h3>Hours of math</h3><p className="muted">Counting weekdays and pauses for every customer by hand takes a whole evening, every month.</p></div>
        </div>
      </section>

      <section className="container">
        <h2>Key features</h2>
        <div className="grid3">
          {FEATURES.map(([icon, title, text]) => (
            <div key={title} className="card feature"><div className="icon">{icon}</div><h3>{title}</h3><p className="muted">{text}</p></div>
          ))}
        </div>
      </section>

      <section className="container band two-col">
        <div>
          <h2>Who it’s for</h2>
          <ul className="ticks">
            <li>Home cooks running a tiffin service for 10–500 customers</li>
            <li>Mess and dabba services delivering to offices and PGs</li>
            <li>Cloud kitchens with monthly meal subscriptions</li>
          </ul>
        </div>
        <div>
          <h2>How it helps</h2>
          <ul className="ticks">
            <li><strong>Accurate:</strong> bills match what was delivered, down to the paisa</li>
            <li><strong>Fast:</strong> month-end billing drops from hours to one click</li>
            <li><strong>Trusted:</strong> show customers a day-by-day calendar with their bill</li>
            <li><strong>Organised:</strong> know exactly how many tiffins to cook today</li>
          </ul>
        </div>
      </section>

      <section className="container">
        <h2>Coming next</h2>
        <div className="grid3">
          {NEXT.map(([title, text]) => (
            <div key={title} className="card feature next"><h3>{title}</h3><p className="muted">{text}</p></div>
          ))}
        </div>
      </section>

      <section className="container cta-band card">
        <h2>Stop losing money on paused days, and stop overcharging for them.</h2>
        <Link to={cta.to} className="btn lg">{cta.label}</Link>
      </section>

      <footer className="container muted small footer">© {new Date().getFullYear()} Tiffin Tracker · Built for tiffin services everywhere</footer>
    </div>
  );
}
