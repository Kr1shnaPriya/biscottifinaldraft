const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const repo = require('./repo');
const { db } = require('./db');
const { hashPassword, verifyPassword, issueToken, verifyToken, rateLimiter } = require('./auth');

const { HttpError } = repo;
const IS_PROD = process.env.NODE_ENV === 'production';

/* ---------------- outgoing email (password reset) ---------------- */
const SMTP_CONFIGURED = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailer = SMTP_CONFIGURED
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@biscotti.local';

/* ---------------- helpers ---------------- */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const loginLimiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Please wait 15 minutes and try again.' });
const resetLimiter = rateLimiter({ windowMs: 60 * 60 * 1000, max: 8 });
const orderLimiter = rateLimiter({ windowMs: 60 * 60 * 1000, max: 20, message: 'Too many requests from this device. Please try again later.' });

const requireStaff = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [staff, secret] = await Promise.all([repo.getStaff(), repo.getSessionSecret()]);
  if (!staff || !verifyToken(token, secret, staff.passwordHash)) {
    throw new HttpError(401, 'Your staff session has expired. Please log in again.');
  }
  req.staff = staff;
  next();
});

const intId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Invalid id');
  return n;
};

function publicOrigin(req) {
  // Prefer an explicitly configured address: building links from the Host header
  // would let an attacker poison password-reset emails.
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 20 },
});

/* ================================================================== */
const router = express.Router();

/* ---------------- public ---------------- */
router.get('/health', wrap(async (req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, database: db.dialect, version: await repo.getVersion() });
}));

router.get('/menu', wrap(async (req, res) => {
  // `no-cache` + ETag = browsers always revalidate, and get a cheap 304 when nothing changed.
  const etag = `W/"menu-${await repo.getVersion()}"`;
  res.set({ 'Cache-Control': 'no-cache', ETag: etag });
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.json(await repo.getMenu());
}));

router.post('/orders', orderLimiter, upload.single('photo'), wrap(async (req, res) => {
  const order = await repo.addOrder(req.body || {}, req.file ? req.file.buffer : null);
  res.status(201).json({ ok: true, order });
}));

/* ---------------- staff auth ---------------- */
router.post('/staff/login', loginLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const staff = await repo.getStaff();
  const passwordOk = await verifyPassword(password || '', staff.passwordHash); // always run: constant-ish timing
  if (!(typeof username === 'string' && username === staff.username && passwordOk)) {
    throw new HttpError(401, 'Incorrect username or password');
  }
  const { token, expiresAt } = issueToken(await repo.getSessionSecret(), staff.passwordHash);
  res.json({ token, expiresAt, usingDefaultPassword: staff.isDefault });
}));

router.get('/staff/me', requireStaff, (req, res) => {
  res.json({ username: req.staff.username, email: req.staff.email, usingDefaultPassword: req.staff.isDefault });
});

router.post('/staff/change-password', requireStaff, wrap(async (req, res) => {
  const { currentPassword, newUsername, newPassword, newEmail } = req.body || {};
  if (!(await verifyPassword(currentPassword || '', req.staff.passwordHash))) {
    throw new HttpError(403, 'Current password is incorrect'); // 403, not 401: the login itself is still valid
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new HttpError(400, 'New password must be at least 6 characters');
  }
  const username = (typeof newUsername === 'string' && newUsername.trim()) || req.staff.username;
  const email = (typeof newEmail === 'string' && newEmail.trim()) || req.staff.email || '';
  await repo.updateStaff({ username, email, passwordHash: await hashPassword(newPassword) });
  // The old token is now invalid (it was bound to the old password) — hand back a fresh one.
  const fresh = await repo.getStaff();
  const { token, expiresAt } = issueToken(await repo.getSessionSecret(), fresh.passwordHash);
  res.json({ ok: true, username, email, token, expiresAt });
}));

router.post('/staff/forgot-password', resetLimiter, wrap(async (req, res) => {
  const email = typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const staff = await repo.getStaff();
  // Same response whether or not the email matches, so this can't be used to discover the address.
  const generic = { ok: true, message: "If that email is registered, we've sent a reset link to it." };
  if (!email || !staff.email || staff.email.trim().toLowerCase() !== email) return res.json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  await repo.saveResetToken(crypto.createHash('sha256').update(token).digest('hex'), Date.now() + 30 * 60 * 1000);
  const resetUrl = `${publicOrigin(req)}/?resetToken=${token}`;

  if (mailer) {
    try {
      await mailer.sendMail({
        from: EMAIL_FROM,
        to: staff.email,
        subject: 'Reset your Biscotti staff password',
        text: `Someone requested a password reset for the Biscotti staff login.\n\nReset it here (the link expires in 30 minutes and works once):\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>Someone requested a password reset for the Biscotti staff login.</p><p><a href="${resetUrl}">Click here to reset your password</a> (the link expires in 30 minutes and works once).</p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (err) {
      console.error('[mail] failed to send reset email:', err.message);
    }
    return res.json(generic);
  }

  console.log(`[reset] SMTP not configured — password reset link (valid 30 min): ${resetUrl}`);
  // Showing the link in the response is ONLY for local development. In production it would
  // let anyone who knows the staff email take over the account, so it is never returned there.
  res.json(IS_PROD ? generic : { ...generic, devResetUrl: resetUrl });
}));

router.post('/staff/reset-password', resetLimiter, wrap(async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (typeof token !== 'string' || typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new HttpError(400, 'A valid reset link and a new password (6+ characters) are required');
  }
  const ok = await repo.consumeResetToken(crypto.createHash('sha256').update(token).digest('hex'));
  if (!ok) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
  const staff = await repo.getStaff();
  await repo.updateStaff({ username: staff.username, email: staff.email, passwordHash: await hashPassword(newPassword) });
  res.json({ ok: true });
}));

/* ---------------- staff-only: menu editing ----------------
 * Every write returns the fresh menu, so the editing device is immediately in
 * sync with exactly what is stored in the database. */
const withMenu = async (res) => res.json({ ok: true, menu: await repo.getMenu() });

router.put('/categories/:id', requireStaff, wrap(async (req, res) => {
  await repo.updateCategory(req.params.id, req.body);
  await withMenu(res);
}));

router.post('/products/:catId', requireStaff, wrap(async (req, res) => {
  await repo.addProduct(req.params.catId, req.body);
  await withMenu(res);
}));

router.put('/products/:id', requireStaff, wrap(async (req, res) => {
  await repo.updateProduct(intId(req.params.id), req.body);
  await withMenu(res);
}));

router.delete('/products/:id', requireStaff, wrap(async (req, res) => {
  await repo.deleteProduct(intId(req.params.id));
  await withMenu(res);
}));

router.post('/gallery', requireStaff, wrap(async (req, res) => {
  await repo.addGalleryImage((req.body || {}).image);
  await withMenu(res);
}));

router.delete('/gallery/:id', requireStaff, wrap(async (req, res) => {
  await repo.deleteGalleryImage(intId(req.params.id));
  await withMenu(res);
}));

router.post('/reset', requireStaff, wrap(async (req, res) => {
  await repo.resetMenu();
  await withMenu(res);
}));

router.get('/orders', requireStaff, wrap(async (req, res) => {
  res.json(await repo.listOrders());
}));

module.exports = router;
