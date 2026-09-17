# 🍱 Tiffin Tracker

Subscriptions, pauses and **pro-rated monthly bills** for home-style tiffin (lunch delivery) services.
Customers subscribe to a monthly plan and get lunch every weekday. When they pause for travel or a festival, those days are not charged.
At month-end the owner generates a bill for every customer in one click, and each bill covers only the days that customer was actually served.

| Layer | Tech |
|---|---|
| Database | SQLite through Node's built-in `node:sqlite` (file: `server/data/tiffin.db`) |
| API | Node.js 22.13+ / Express 4, JWT auth, bcrypt password hashing |
| UI | React 18 + React Router + Vite (plain CSS, responsive) |
| Tests | Node's built-in test runner (`node --test`): billing unit tests + end-to-end API test |

---

## 1. Setup

**Prerequisites:** Node.js **22.13 or newer** (developed on Node 24). You don't need to install a database, because SQLite ships with Node.

```bash
git clone <this-repo-url> tiffin-tracker
cd tiffin-tracker
npm run install:all        # installs server/ and client/ dependencies
cp server/.env.example server/.env   # optional; defaults work for local dev
npm run seed               # optional demo data
```

Demo login after seeding: **demo@tiffin.app / demo1234** (3 plans, 32 customers with active, paused, upcoming and ended subscriptions).

### Environment variables (`server/`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `JWT_SECRET` | insecure dev value (warns at startup) | Signs login tokens; **set this in production** |
| `DB_FILE` | `./data/tiffin.db` | SQLite file path (`:memory:` for throwaway runs) |

The server doesn't read `.env` files by itself. Export the variables in your shell, or run with `node --env-file=.env src/index.js`.

## 2. Run

### Development (hot reload, two terminals)

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open http://localhost:5173. Vite proxies `/api` to the API on port 4000.

### Production (single process)

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:4000. Express serves the API and the built React app together.

### Tests

```bash
npm test
```

- `server/test/billing.test.js`: 12 unit tests for the billing rules (mid-month start, weekday and weekend pauses, open-ended pauses, pauses spanning two months, a fully paused month, ended subscriptions, leap-year February, rounding).
- `server/test/api.test.js`: an end-to-end run against an in-memory database covering register/login, plan and customer validation, subscribe, pause, overlap rejection, resume, bill preview, bill generation (including regenerating), phone lookup, search, pagination, sorting, SQL-injection-safe sort keys, and making sure one owner can't see another owner's data.

## 3. Debugging

- **API request log:** every `/api` call is logged as `METHOD url -> status (ms)` in the server terminal. 5xx errors print a full stack trace.
- **Error format:** every error response looks like `{ "error": "message", "details": { field: "reason" } }`, and the UI shows it inline.
- **Inspect the database:** `sqlite3 server/data/tiffin.db` or any SQLite GUI (DB Browser for SQLite). You can also open a Node REPL:
  `node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('server/data/tiffin.db');console.table(d.prepare('select * from pauses').all())"`
- **Reset the data:** stop the server, delete `server/data/`, and run `npm run seed` again.
- **Time travel:** the list and dashboard endpoints accept `?as_of=YYYY-MM-DD`, so you can see who was active or paused on any date without changing the system clock.
- **Breakpoints:** `node --inspect src/index.js` (in `server/`), then attach from Chrome `chrome://inspect` or the VS Code debugger.
- **Common issues**
  - `No such built-in module: node:sqlite` means your Node is too old. Upgrade to 22.13 or newer.
  - A 401 on every request means the token expired (7 days) or `JWT_SECRET` changed. Log in again.
  - `EADDRINUSE :4000` means another process is using the port. Run with `PORT=4001` and update `client/vite.config.js` to match.

---

## 4. Billing rules

- Deliveries happen **Monday–Friday**. The monthly plan price covers **every weekday of the month**.
- `delivered days` = weekdays inside the subscription window (start to end, clipped to the month) that aren't covered by a pause.
- **`bill = round(plan price × delivered days ÷ weekdays in month)`**. Money is stored as integer **paise** and rounded once.
- A pause is a date range. `end_date` is the last paused day (inclusive), and `null` means paused until resumed. Pauses can't overlap.
- **Resume on date D** means D is the first delivery day again. The open pause gets `end_date = D − 1`; if D is the pause's first day, the pause is removed.
- The plan price is **copied onto the subscription** when the customer subscribes, so changing a plan's price later doesn't change existing customers' bills.
- **Status** is derived from dates, never stored: `active`, `paused`, `upcoming` (starts in the future) or `inactive`.
- **Generated bills are saved snapshots** (`bills` table). Regenerating a month recomputes them for everyone, which is idempotent.

## 5. Database schema

```
users          id, name, business_name, email (unique), password_hash, created_at
plans          id, owner_id→users, name, description, price_paise, is_active, created_at
customers      id, owner_id→users, name, phone, address, created_at      UNIQUE(owner_id, phone)
subscriptions  id, customer_id→customers, plan_id→plans, price_paise, start_date, end_date|null
pauses         id, subscription_id→subscriptions, start_date, end_date|null, reason
bills          id, subscription_id, month 'YYYY-MM', working_days, subscribed_days, paused_days,
               delivered_days, price_paise, amount_paise, generated_at   UNIQUE(subscription_id, month)
```

Every query is scoped to the logged-in owner, so any number of tiffin services can share one deployment.

---

## 6. REST API

Base URL: `/api`. Request and response bodies are JSON. All endpoints except `auth/register`, `auth/login` and `health` need `Authorization: Bearer <token>`.
Dates are `YYYY-MM-DD`, months are `YYYY-MM`, and money is in **paise** (₹1 = 100).

**Paginated list responses** have this shape: `{ data: [...], page, limit, total, totalPages, sort, order }`.
Common query params: `page` (default 1), `limit` (1–100, default 10), `sort`, `order` (`asc` or `desc`), `search`.

### Auth
| Method | Endpoint | Body / Query | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, business_name?, email, password (≥8) }` | Create an owner account → `{ token, user }` |
| POST | `/api/auth/login` | `{ email, password }` | Log in → `{ token, user }` |
| GET | `/api/auth/me` | | Current user |

### Plans
| Method | Endpoint | Body / Query | Description |
|---|---|---|---|
| GET | `/api/plans` | `search, page, limit, sort=name\|price\|subscribers\|created_at, order` | List plans with current subscriber counts |
| POST | `/api/plans` | `{ name, description?, price_paise, is_active? }` | Create a plan |
| GET | `/api/plans/:id` | | Get a plan |
| PUT | `/api/plans/:id` | same as POST | Update a plan (existing subscriptions keep their price) |
| DELETE | `/api/plans/:id` | | Delete a plan (409 if it has subscriptions; retire it instead) |

### Customers
| Method | Endpoint | Body / Query | Description |
|---|---|---|---|
| GET | `/api/customers` | `search` (name/phone/address), `status=active\|paused\|upcoming\|inactive`, `page, limit, sort=name\|phone\|plan\|status\|created_at, order, as_of?` | List and search customers with derived status. Also returns `counts` per status |
| GET | `/api/customers/phone/:phone` | `as_of?` | **Look up a customer by phone** (spaces and dashes ignored) |
| POST | `/api/customers` | `{ name, phone, address? }` | Create a customer (409 if the phone already exists) |
| GET | `/api/customers/:id` | `as_of?` | Customer detail with all subscriptions and pauses |
| PUT | `/api/customers/:id` | `{ name, phone, address? }` | Update a customer |
| DELETE | `/api/customers/:id` | | Delete a customer and their history |

### Subscriptions, pause and resume
| Method | Endpoint | Body / Query | Description |
|---|---|---|---|
| POST | `/api/customers/:id/subscriptions` | `{ plan_id, start_date? }` | **Subscribe** a customer to a plan (one running subscription at a time) |
| GET | `/api/subscriptions/:id` | | Subscription with its pauses |
| POST | `/api/subscriptions/:id/pause` | `{ start_date?, end_date?, reason? }` | **Pause** (omit `end_date` to pause until resumed). 409 on overlap |
| POST | `/api/subscriptions/:id/resume` | `{ date? }` | **Resume**: `date` is the first delivery day again (default today) |
| DELETE | `/api/pauses/:id` | | Remove a pause entered by mistake |
| POST | `/api/subscriptions/:id/end` | `{ end_date? }` | End a subscription (last delivery day, inclusive) |
| GET | `/api/subscriptions/:id/bill` | `month=YYYY-MM` | **Live pro-rated bill preview** for one subscription |

### Bills
| Method | Endpoint | Body / Query | Description |
|---|---|---|---|
| POST | `/api/bills/generate` | `{ month }` | Generate or regenerate bills for every subscription in the month → `{ bills_generated, total_amount_paise }` |
| GET | `/api/bills` | `month, search` (customer name/phone), `page, limit, sort=name\|phone\|plan\|amount\|delivered\|paused, order` | List saved bills with a `summary` (total amount, delivered and paused days) |

### Dashboard and health
| Method | Endpoint | Body / Query | Description |
|---|---|---|---|
| GET | `/api/dashboard` | `as_of?` | Active, paused, upcoming and inactive counts, tiffins to deliver today, projected month revenue, customers paused today |
| GET | `/api/health` | | Liveness check |

### Example

```bash
TOKEN=$(curl -s localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@tiffin.app","password":"demo1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -s "localhost:4000/api/customers?status=paused&sort=name&limit=5" -H "Authorization: Bearer $TOKEN"
curl -s -X POST localhost:4000/api/subscriptions/1/pause -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"start_date":"2026-10-20","end_date":"2026-10-24","reason":"Diwali"}'
curl -s -X POST localhost:4000/api/bills/generate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"month":"2026-10"}'
```

---

## 7. UI pages

| Route | Page |
|---|---|
| `/` | Landing page: what it is, features, audience, benefits, what's coming next |
| `/register`, `/login` | Owner sign-up and login |
| `/app` | Dashboard: today's tiffin count, active and paused counts, projected revenue, phone lookup |
| `/app/customers` | Search, status tabs, sortable columns, pagination, add customer |
| `/app/customers/:id` | Subscribe, pause, resume, end; pause history; monthly bill with a day-by-day calendar |
| `/app/plans` | Create, edit, retire and delete plans (search, sort, paginate) |
| `/app/bills` | Pick a month, generate bills, search, sort, paginate, see totals |

## 8. Project structure

```
server/
  src/billing.js        pure billing function (the core rules)
  src/dates.js          UTC-safe date helpers
  src/db.js             schema and connection
  src/http.js           errors, auth middleware, pagination/sort whitelist
  src/routes/*.js       auth, plans, customers, subscriptions, bills, dashboard
  src/seed.js           demo data
  test/                 unit and API tests
client/
  src/pages/*.jsx       Landing, Auth, Dashboard, Customers, CustomerDetail, Plans, Bills
  src/components/       Layout and shared UI (pagination, sortable headers, modal)
```
