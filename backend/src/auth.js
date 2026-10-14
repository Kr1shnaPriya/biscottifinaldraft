/**
 * Authentication helpers.
 *
 *  - Passwords are stored as salted scrypt hashes (never plain text).
 *  - Login returns a signed, expiring token (HMAC-SHA256). Tokens are STATELESS:
 *    nothing is kept in server memory, so they keep working across server
 *    restarts and across the many instances serverless hosts like Vercel spin up.
 *  - A token is tied to the current password hash, so changing/resetting the
 *    password instantly logs out every other device.
 */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/* ---------------- passwords ---------------- */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, keyHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(keyHex, 'hex');
    const actual = await scrypt(String(password), Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

/* ---------------- signed tokens ---------------- */
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
// Binds a token to the current password: when the hash changes, old tokens stop working.
const passwordStamp = (passwordHash) => crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);

function issueToken(secret, passwordHash) {
  const payload = b64u(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS, pv: passwordStamp(passwordHash) }));
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt: Date.now() + TOKEN_TTL_MS };
}

function verifyToken(token, secret, passwordHash) {
  if (typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const good = Buffer.from(sign(payload, secret));
  const got = Buffer.from(sig);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() && data.pv === passwordStamp(passwordHash);
  } catch (_) {
    return false;
  }
}

/* ---------------- tiny in-memory rate limiter ----------------
 * Best-effort brute-force protection. (On serverless each instance keeps its own
 * counters, which still slows attackers down considerably.) */
function rateLimiter({ windowMs, max, message }) {
  const hits = new Map(); // key -> { count, resetAt }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
  }, 60_000).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt < now) { entry = { count: 0, resetAt: now + windowMs }; hits.set(key, entry); }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message || 'Too many attempts. Please wait a few minutes and try again.' });
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, issueToken, verifyToken, rateLimiter };
