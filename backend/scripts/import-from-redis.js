/**
 * One-time import of data saved by the OLD version of this site (Upstash Redis on Vercel)
 * into the new database.
 *
 *   KV_REST_API_URL=...  KV_REST_API_TOKEN=...  DATABASE_URL=...  npm run import:redis
 *
 * (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN also work.)
 * You can find the two Redis values in Vercel → Storage → your Redis store → .env.local tab.
 *
 * It copies: the menu + gallery (replacing the new database's menu), the staff
 * username/e-mail/password (re-saved securely hashed), and any Bake Room requests.
 * It only READS from Redis — nothing there is changed or deleted.
 */
require('../src/env');
const { db } = require('../src/db');
const repo = require('../src/repo');
const { hashPassword } = require('../src/auth');

const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function redisGet(key) {
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Redis responded ${res.status} for "${key}" — check the URL and token.`);
  let { result } = await res.json();
  if (typeof result === 'string') { try { result = JSON.parse(result); } catch (_) { /* plain string */ } }
  return result || null;
}

(async () => {
  if (!url || !token) {
    console.error('Set KV_REST_API_URL and KV_REST_API_TOKEN (see the comment at the top of this file).');
    process.exit(1);
  }
  await repo.ready();

  const menu = await redisGet('biscotti:menu');
  if (menu && menu.categories && menu.products) {
    await repo.replaceMenu(menu);
    const n = Object.values(menu.products).reduce((a, l) => a + l.length, 0);
    console.log(`✓ Menu imported: ${menu.categories.length} collections, ${n} cakes, ${(menu.gallery || []).length} gallery photos`);
  } else {
    console.log('– No saved menu found in Redis (the site was still using the defaults); nothing to import.');
  }

  const auth = await redisGet('biscotti:auth');
  if (auth && auth.username && auth.password) {
    await repo.updateStaff({ username: auth.username, email: auth.email || '', passwordHash: await hashPassword(auth.password) });
    console.log(`✓ Staff login imported (username "${auth.username}", same password as before)`);
  } else {
    console.log('– No custom staff login found; the default one stays in place.');
  }

  const orders = await redisGet('biscotti:orders');
  if (Array.isArray(orders) && orders.length) {
    for (const o of orders.slice().reverse()) {
      await db.query(
        `INSERT INTO orders (received_at, name, phone, occasion, needed_on, size, flavour, details, photo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`,
        [Date.parse(o.receivedAt) || Date.now(), o.name || '', o.phone || '', o.occasion || '', o.date || '', o.size || '', o.flavour || '', o.details || '']);
    }
    console.log(`✓ ${orders.length} Bake Room request(s) imported`);
  }

  console.log('\nDone. You can leave the old Redis store connected or delete it — the site no longer uses it.');
  await db.close();
})().catch((err) => { console.error('Import failed:', err.message); process.exit(1); });
