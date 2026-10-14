# Biscotti Cake Factory — Website

Customer website + staff-editable menu for Biscotti Cake Factory (Mathara, Calicut),
with a Node/Express API and a **real database**. Whatever staff save is stored in the
database, survives refreshes, restarts and redeploys, and is the same on every device.

```
biscotti-website/
├── frontend/            The website (HTML/CSS/JS, photos)
├── backend/
│   ├── server.js        Web server (serves the site + API + uploaded photos)
│   ├── src/             db.js (SQLite/PostgreSQL) · repo.js (queries) · routes.js · auth.js
│   ├── seed/            The original Biscotti menu — loaded on first run / "Reset menu"
│   ├── scripts/         smoke-test.js · import-from-redis.js
│   └── data/            SQLite database file lives here (created automatically)
├── .env.example         Every setting, documented
├── Dockerfile           One-container deployment
└── vercel.json          Vercel deployment
```

## 1. Run it on your computer (2 minutes)

Requires [Node.js 18+](https://nodejs.org).

```bash
cd backend
npm install
npm start
```

Open **http://localhost:3000**. Staff login on first run: **staff / biscotti2026** —
change it straight away (Staff mode → *Change password*).

No setup needed: the database file `backend/data/biscotti.db` is created for you and filled
with the default menu. To back it up, stop the server and copy that file (or, while running:
`sqlite3 backend/data/biscotti.db ".backup backup.db"`).

## 2. Put it online so every device sees the same data

Data is shared across devices only when the site runs on a server that all devices reach.
Pick **one** of these. The code chooses the database automatically: if `DATABASE_URL` is set it
uses PostgreSQL, otherwise a SQLite file.

### Option A — Vercel + free PostgreSQL (what you were already using)

Vercel's disk is thrown away between requests, so it needs an external database.

1. Create a free PostgreSQL database — [Neon](https://neon.tech) is the easiest (in Vercel:
   your project → **Storage** → add **Neon**; this adds `DATABASE_URL` for you).
   Otherwise copy Neon's connection string and add it yourself under **Settings → Environment Variables**
   as `DATABASE_URL`.
2. Also add `PUBLIC_URL` (your site address, e.g. `https://yourshop.vercel.app`) and, if you want the
   "Forgot password?" email to work, the `SMTP_*` variables from `.env.example`.
3. Deploy. Open `https://your-site/api/health` — it must say `"database":"postgres"`.

> Without `DATABASE_URL` on Vercel the API answers with a clear "database not connected" message
> instead of pretending to save.

### Option B — Render / Railway / Fly / a VPS (SQLite, no extra service)

These run a normal Node server. You **must** attach a persistent disk/volume, otherwise the database file
is erased on every deploy (free plans without a disk can't do this — use Option A there).

- Build command: `cd backend && npm install` · Start command: `cd backend && npm start`
- Mount the disk at e.g. `/data` and set `DATA_DIR=/data`
- Set `PUBLIC_URL`, and optionally `STAFF_PASSWORD` for the very first run.

Or use the included **Dockerfile**: `docker build -t biscotti .` then
`docker run -p 3000:3000 -v biscotti-data:/data biscotti`.

### Moving data from the old version (Upstash Redis on Vercel)

If staff already edited the live menu on the old version, copy it over once. Get the Redis URL/token from
Vercel → Storage → your Redis store (`.env.local` tab), then:

```bash
cd backend
KV_REST_API_URL="https://…" KV_REST_API_TOKEN="…" DATABASE_URL="postgres://…" npm run import:redis
```

It only reads from Redis and replaces the new database's menu, staff login and requests with the old ones.
(Edits that an earlier version saved only inside one device's browser were never shared and can't be recovered;
this version deletes those stale browser copies automatically.)

## 3. How saving works

- The browser **never** keeps the real data. Staff edits are sent to the server; the page updates only after the
  server confirms and returns what is now stored. If a save fails (offline, session expired) a red message says
  so — nothing is silently kept on one device.
- Open devices re-check the menu every 30 seconds and whenever the tab/app is reopened, so a price changed on
  the shop's phone appears on customers' screens without a manual refresh.
- Edits target cakes by **id**, so two staff phones editing at once can't overwrite the wrong cake.
- Staff photos are shrunk in the browser, then stored **inside the database** (`media` table) and served from
  `/media/<id>` with long caching — the menu data itself stays tiny.
- Staff stay logged in across a page refresh in the same tab; closing the tab logs out.

## 4. Settings (environment variables)

All optional — see `.env.example`. Real environment variables always override `backend/.env`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Empty → SQLite file. **Required on Vercel.** |
| `DATA_DIR` | Folder for the SQLite file (point at a persistent disk in production). |
| `STAFF_USERNAME` / `STAFF_PASSWORD` / `STAFF_EMAIL` | First-run staff login. Changeable later in the site. |
| `PUBLIC_URL` | Your site's address; used in password-reset emails (prevents Host-header spoofing). |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `EMAIL_FROM` | Sends the "Forgot password?" email. |
| `SESSION_SECRET` | Optional fixed signing secret; otherwise one is generated and stored in the database. |

## 5. Security notes

- Passwords are stored as salted **scrypt** hashes, never plain text. Login tokens are signed and expire after 8 h.
- Changing or resetting the password immediately logs out every other device.
- Login, password-reset and request endpoints are rate-limited; reset links last 30 min and work once.
- Without SMTP configured, the reset link is written to the **server log** only. (It is shown in the browser
  only when running locally, never in production.)
- Menu text is HTML-escaped; uploaded images are checked by content (JPG/PNG/WebP/GIF only, ≤ 4 MB).
- Change the default password before going live — the site reminds staff until they do.

## 6. API reference

Prefix `/api`. Staff endpoints need `Authorization: Bearer <token>` from `/staff/login`. Every successful staff
write returns `{ ok: true, menu }` with the fresh menu.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Database type + menu version |
| GET | `/menu` | — | Collections, cakes, gallery (ETag / 304 supported) |
| POST | `/orders` | — | Bake Room request (multipart, optional `photo`) |
| POST | `/staff/login` | — | `{username,password}` → `{token}` |
| POST | `/staff/forgot-password` · `/staff/reset-password` | — | Email reset flow |
| GET | `/staff/me` | staff | Current username/email |
| POST | `/staff/change-password` | staff | `{currentPassword,newPassword,newUsername?,newEmail?}` |
| PUT | `/categories/:id` | staff | `{tagline,desc,image}` |
| POST | `/products/:catId` | staff | `{n,p,t,img?}` add a cake |
| PUT / DELETE | `/products/:id` | staff | Edit / remove a cake by id |
| POST | `/gallery` | staff | `{image}` add a gallery photo |
| DELETE | `/gallery/:id` | staff | Remove a gallery photo |
| POST | `/reset` | staff | Restore the default menu (keeps requests and login) |
| GET | `/orders` | staff | List Bake Room requests |
| GET | `/media/:id` *(no `/api`)* | — | An uploaded photo |

Note: the current Bake Room section sends enquiries through WhatsApp, so no on-site form posts to `/orders`
yet. The endpoint and table are ready if you add one.

## 7. Tests

```bash
cd backend
npm test                                              # SQLite
TEST_DATABASE_URL="postgres://user:pass@host/db" npm test   # PostgreSQL (use a throw-away database!)
```

Starts the real server, exercises login, editing, photos, orders and password reset, then **kills and restarts
the server and checks that every change is still there**.

## Troubleshooting

- **"Changes only show on my phone"** — open `/api/health`. If it errors or shows the wrong database, the site is
  not talking to your database (check `DATABASE_URL`). Staff-mode saves now show a red error instead of
  silently saving locally.
- **First load is slow after idle** — free hosts sleep; the site retries automatically and shows the last known menu meanwhile.
- **Forgot the staff password and no SMTP set up** — request a reset on the login screen and read the link
  from the server logs, or delete the `staff` row and restart to recreate the default login.
