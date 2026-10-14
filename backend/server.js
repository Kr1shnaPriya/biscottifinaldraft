require('./src/env'); // load backend/.env first
/**
 * Biscotti Cake Factory — server
 *
 *  - Serves the static website (../frontend)
 *  - JSON API under /api (menu, staff login, menu editing, custom-cake requests)
 *  - Serves staff-uploaded photos from the database under /media/:id
 *
 * Data lives in a real database (see src/db.js): SQLite by default, or
 * PostgreSQL when DATABASE_URL is set. Nothing important is kept in memory
 * or in browser storage, so data survives refreshes, restarts and redeploys
 * and is identical on every device.
 */
const express = require('express');
const path = require('path');
const repo = require('./src/repo');
const routes = require('./src/routes');
const { db } = require('./src/db');

const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const app = express();
app.set('trust proxy', 1); // correct client IPs / https behind Render, Railway, Vercel, nginx…
app.disable('x-powered-by');

/* ---------------- security headers ---------------- */
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.use(express.json({ limit: '4mb' })); // photos arrive pre-shrunk by the browser (~100–300 KB)

/* ---------------- make sure the database is ready ---------------- */
const ensureReady = (req, res, next) => repo.ready().then(() => next(), next);

/* ---------------- uploaded photos ---------------- */
app.get('/media/:id', ensureReady, async (req, res, next) => {
  try {
    const media = await repo.getMedia(req.params.id);
    if (!media) return res.status(404).end();
    const etag = `"${req.params.id}"`;
    res.set({ 'Content-Type': media.mime, ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable' });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.send(media.data);
  } catch (err) { next(err); }
});

/* ---------------- API ---------------- */
app.use('/api', ensureReady, routes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------------- website ---------------- */
app.use(express.static(FRONTEND_DIR, {
  setHeaders(res, file) {
    // Pages and scripts always revalidate (so updates show immediately); images may be cached.
    if (/\.(jpe?g|png|webp|gif|svg|ico)$/i.test(file)) res.set('Cache-Control', 'public, max-age=604800');
    else res.set('Cache-Control', 'no-cache');
  },
}));

/* ---------------- errors ---------------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = Number.isInteger(err.status) ? err.status : 500;
  let message = err.message;

  if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
    status = 413; message = 'That photo is too large. Please choose a smaller one.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; message = 'Invalid request';
  } else if (err.code && String(err.code).startsWith('LIMIT_')) {
    status = 400; message = 'Invalid upload';
  }

  if (status >= 500 && !err.expose) {
    console.error('[error]', req.method, req.originalUrl, err);
    message = 'Something went wrong on our side. Please try again.';
  }
  if (!res.headersSent) res.status(status).json({ error: message });
});

/* ---------------- start ---------------- */
if (!IS_VERCEL) {
  repo.ready()
    .then(() => {
      const server = app.listen(PORT, () => {
        console.log(`\nBiscotti is running →  http://localhost:${PORT}`);
        console.log(`Database: ${db.dialect === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : `SQLite file at ${db.file}`}`);
        if (!process.env.STAFF_PASSWORD) {
          console.log('Staff login: staff / biscotti2026 (default — change it from Staff mode → Change password)');
        }
      });
      const shutdown = () => server.close(() => db.close().finally(() => process.exit(0)));
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((err) => { console.error('Could not start — database error:', err.message); process.exit(1); });
}

// Vercel's Node runtime imports this file and uses the exported app as the request handler.
module.exports = app;
