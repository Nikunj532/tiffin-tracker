# Reasoning

## 1. Reading the problem

The whole product comes down to one sentence: *"every customer is billed only for the days they were actually served."*
Everything else (search, pagination, the dashboard) sits on top of that. So I built in this order:
**billing rules → subscribe/pause/resume → bill → lookups → auth, UI and polish**, as the brief suggested.

Before writing code I pinned down the questions the brief leaves open, because each one changes the bill:

| Question | Decision | Why |
|---|---|---|
| What does the monthly price buy? | Every **weekday** (Mon–Fri) of that month | "Lunch delivered every weekday" |
| How is a partial month billed? | `price × delivered weekdays ÷ weekdays in that month` | Months have 20–23 weekdays. Dividing by the actual count means a full month always costs exactly the plan price, never more or less |
| Do weekend pause days reduce the bill? | No | Nothing was going to be delivered anyway |
| Is the pause end date inclusive? | Yes, it's the last paused day. `null` = until resumed | Matches how people talk: "paused 7th to 11th" |
| What does "resume on the 17th" mean? | The 17th is the first delivery day again; the pause ends on the 16th | This is how the owner thinks about it, and it can't be off by one |
| Should active/paused be a stored flag? | **No, derive it from dates** | A stored flag goes stale the moment a scheduled pause starts or ends. With derived status, a pause scheduled for next week turns into "paused" by itself |
| What if the owner changes a plan's price? | The price is **copied onto the subscription** at subscribe time | Otherwise raising prices would silently rewrite existing customers' (and past) bills |
| Can generated bills change? | They're saved as snapshots; **Regenerate** recomputes them | A bill someone has seen should be stable, but the owner needs a way to correct it after fixing a missed pause |
| Money type | Integer **paise**, rounded once at the end | Avoids floating-point drift in totals |
| Multiple tiffin services? | Every row is scoped to an `owner_id` | "Build it for any tiffin service" |

## 2. Architecture choices

- **The billing engine is a pure function** (`server/src/billing.js`, `computeBill(sub, pauses, month)`). It doesn't touch the database or the clock, so it's easy to unit test, and the same function drives the live preview, saved bills and the dashboard projection. There's one source of truth for the rules.
- **Dates are `YYYY-MM-DD` strings with UTC arithmetic.** String comparison works for ISO dates, and UTC avoids a classic bug where a server in IST turns `2026-09-01` into the 31st.
- **SQLite via Node's built-in `node:sqlite`.** PostgreSQL wasn't installed on the dev machine, and I wanted the evaluator to go from clone to running without installing or configuring a database or compiling native modules. It's still a real relational database with foreign keys, unique constraints, indexes, transactions and a file on disk. The SQL is plain, so moving to Postgres later is mostly swapping the driver.
- **Express plus a thin layer of route files.** Validation happens at the edge, and every error has the same shape (`{error, details}`), which the UI shows inline.
- **Sorting is whitelisted.** The `sort` query param maps to a fixed dictionary of SQL expressions, so user input never reaches `ORDER BY`. There's a test that sends `sort=name;DROP TABLE users`.
- **The `as_of` query param** on status endpoints makes "who is paused on the 8th?" answerable and testable without mocking the clock.
- **React + Vite, with list state in the URL** (`?status=paused&sort=phone&page=2`). Refreshing, the back button and shared links all keep their filters.
- **A single deployable.** In production, Express serves the built React app, so there's one process and one port.

## 3. Edge cases handled

- A pause that overlaps another pause gets 409, with a message saying which pause it clashes with.
- A pause that ends before it starts, starts before the subscription, or starts after the subscription ends gets 400.
- Resuming on a date the customer isn't paused gets 400. Resuming on the pause's first day removes the pause instead of leaving an invalid range.
- Ending a subscription trims or removes pauses after the end date (in a transaction).
- A second overlapping subscription for the same customer gets 409.
- A duplicate phone for the same owner gets 409. Phone numbers are normalised (`98765 43210` and `98765-43210` both become `9876543210`), and lookup applies the same normalisation.
- Deleting a plan that has subscriptions gets 409; the UI suggests retiring the plan instead.
- Regenerating bills is idempotent: it deletes and re-inserts in one transaction, so a subscription that stopped overlapping the month doesn't leave a stale bill behind.
- Owner isolation: requesting another owner's customer or subscription returns 404, not 403, so IDs don't leak.

## 4. How I tested

1. **Billing unit tests first** (`server/test/billing.test.js`, 12 tests). I worked out each expected number independently: I used a small script to count weekdays for September 2026 (22, starts Tuesday), August 2026 (21) and February 2028 (21, leap year), then did the arithmetic by hand, e.g. ₹3,000 × 17 ÷ 22 = ₹2,318.18 → 231818 paise. Cases: full month, mid-month start, weekday pause, weekend-only pause, open-ended pause, a pause spanning two months, a fully paused month, an ended subscription, a future subscription, leap year, multiple pauses, and the overlap helper.
2. **End-to-end API test** (`server/test/api.test.js`). It boots the real Express app on a random port with an in-memory database and walks through the whole owner story: register and login (wrong password, duplicate email, case-insensitive email), validation errors, subscribe, pause, overlap rejection, open pause then resume, status on a given date, bill preview, generate and regenerate, phone lookup, search, pagination, both sort directions, a SQL-injection attempt on sort, and a second owner who must see nothing.
3. **Manual browser walkthrough** against the seeded data, on the production build:
   - The dashboard showed 17 active, 8 paused and 3 upcoming, matching the seed script's rules.
   - Aarav's page: paused 15–20 Sep, so 4 paused weekdays (19–20 is a weekend). The bill was ₹2,500 × 18 ÷ 22 = ₹2,045.45 ✔ and the calendar showed the right days struck through.
   - Clicked **Resume** (today, 17 Sep). The pause was trimmed to 15–16 Sep, status flipped to Active, and the bill became ₹2,272.73 (20 days) ✔.
   - Tried an overlapping pause (16–18 Sep): the modal showed "Overlaps an existing pause starting 2026-09-15 to 2026-09-16" ✔. Then paused 21–23 Sep, and the bill became ₹1,931.82 (17 days) ✔.
   - The Customers list with `status=paused`, sorted by phone descending, 5 per page, gave "1–5 of 7, Page 1 / 2" ✔.
   - Generated September bills: 30 bills, and the total matched the dashboard projection after the pause changes ✔.
   - The landing page at 375 px width had no horizontal scroll ✔.

## 5. Issues found and fixed

| Problem | How it showed up | Fix |
|---|---|---|
| `npm test` crashed with `Cannot find module …\server\test` | Node 24's test runner treats a bare directory argument as a module to run | Changed the script to a glob: `node --test "test/**/*.test.js"` |
| One of my own test assertions was wrong | While writing the bills sort test I first expected Bala (13 days) to have the larger bill; Asha has 15 | Corrected the expectation before the first run and added a comment explaining the numbers. It was a reminder to compute expected values rather than guess them |
| The seed script created impossible data | Reading the seed logic again: some customers got a "paused today" row even though their subscription had already ended or hadn't started yet, and one customer (index 24) got two overlapping pauses | Only running subscriptions get pauses, and the two pause rules are now mutually exclusive. The seed data now passes the same rules the API enforces |
| The landing-page sample calendar was misaligned | On the mobile check, the demo calendar started on the 1st in the Monday column, but Sept 2026 starts on a Tuesday | Added weekday headers and a leading blank cell |
| Login looked broken during the browser check | Clicking "Log in" with the automation tool did nothing | The server log showed no request at all. Values were filled and a programmatic click logged in fine, so it was the automation tool's click coordinates, not the app. No change needed, but I checked the server log before assuming either way |

## 6. Trade-offs and what I'd do with more time

- **Public holidays** aren't modelled. The next step would be a per-owner `holidays` table that `computeBill` subtracts from both the numerator and the denominator.
- **Per-day pricing** (e.g. the owner wants ₹150/day flat) would be a second billing strategy on the plan. The pure function makes that a small change.
- **Payments:** bills have no `paid` status yet. It's the obvious next step alongside WhatsApp and UPI links (listed on the landing page).
- **Refresh tokens and rate limiting on login** would matter before a public launch. Right now there's a 7-day JWT stored in localStorage.
- **Postgres in production:** SQLite is great for a single small business on one server. For a multi-tenant SaaS I'd switch drivers and add migrations tooling.
