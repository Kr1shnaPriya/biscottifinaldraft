/**
 * Data-access layer — every read/write the app performs goes through here.
 *
 * Images: staff photos arrive from the browser as (already resized) data URLs.
 * Instead of bloating the menu JSON with megabytes of base64, each image is
 * stored once in the `media` table and referenced by a short URL
 * (/media/<id>). The menu API therefore stays tiny and browsers cache images.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, migrate } = require('./db');
const { hashPassword } = require('./auth');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const SEED_FILE = path.join(__dirname, '..', 'seed', 'menu.seed.json');
const SEED_MENU = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));

/* ------------------------------------------------------------------ */
/* Settings + menu version                                             */
/* ------------------------------------------------------------------ */
async function getSetting(key, q = db.query.bind(db)) {
  const { rows } = await q('SELECT value FROM settings WHERE key = ?', [key]);
  return rows[0] ? rows[0].value : null;
}
const setSetting = (q, key, value) =>
  q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, String(value)]);

// Every menu write bumps this counter. Browsers use it (through the ETag) to
// know cheaply whether anything changed since they last looked.
const bumpVersion = (q) =>
  q(`INSERT INTO settings (key, value) VALUES ('menu_version', '1')
     ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT)`);

async function getVersion() {
  return parseInt((await getSetting('menu_version')) || '1', 10);
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;
const PLAIN_URL_RE = /^(https?:\/\/[^\s"'<>]{1,1900}|\/?[A-Za-z0-9_\-./%]{1,500})$/;

function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Validates raw image bytes and stores them (deduplicated by content hash). Returns '/media/<id>'. */
async function storeImageBuffer(q, buffer) {
  if (!buffer || !buffer.length) throw new HttpError(400, 'Empty image');
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image is too large (max 4 MB)');
  const mime = sniffMime(buffer);
  if (!mime) throw new HttpError(400, 'Unsupported image type. Use JPG, PNG, WebP or GIF.');
  const id = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32);
  await q('INSERT INTO media (id, mime, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [id, mime, buffer, Date.now()]);
  return `/media/${id}`;
}

/** Accepts a data URL (stored in the DB) or an ordinary URL/path (kept as-is). */
async function resolveImage(q, value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v) return '';
  if (v.startsWith('data:')) {
    const m = DATA_URL_RE.exec(v);
    if (!m) throw new HttpError(400, 'Unsupported image format');
    return storeImageBuffer(q, Buffer.from(m[2].replace(/\s/g, ''), 'base64'));
  }
  if (!PLAIN_URL_RE.test(v)) throw new HttpError(400, 'Invalid image address');
  return v;
}

async function getMedia(id) {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const { rows } = await db.query('SELECT mime, data FROM media WHERE id = ?', [id]);
  if (!rows[0]) return null;
  return { mime: rows[0].mime, data: Buffer.from(rows[0].data) };
}

/** Removes stored images that nothing references any more (1-hour grace for in-flight uploads). */
async function cleanupMedia() {
  try {
    await db.query(
      `DELETE FROM media
       WHERE created_at < ?
         AND ('/media/' || id) NOT IN (
           SELECT image FROM categories
           UNION SELECT image FROM products
           UNION SELECT image FROM gallery
           UNION SELECT photo FROM orders
           UNION SELECT value FROM settings WHERE key = 'bakeroom_image')`,
      [Date.now() - 60 * 60 * 1000]);
  } catch (err) {
    console.error('[media] cleanup skipped:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Menu — read                                                         */
/* ------------------------------------------------------------------ */
async function getMenu() {
  const [cats, prods, gal, bake, version] = await Promise.all([
    db.query('SELECT id, name, tagline, description, image, tone FROM categories ORDER BY sort_order, id'),
    db.query('SELECT id, category_id, name, price, tags, image FROM products ORDER BY sort_order, id'),
    db.query('SELECT id, image FROM gallery ORDER BY sort_order, id'),
    getSetting('bakeroom_image'),
    getVersion(),
  ]);

  const products = {};
  cats.rows.forEach((c) => { products[c.id] = []; });
  prods.rows.forEach((p) => {
    let tags = [];
    try { tags = JSON.parse(p.tags); } catch (_) { /* corrupt row → no tags */ }
    const item = { id: p.id, n: p.name, p: Number(p.price), t: tags };
    if (p.image) item.img = p.image;
    (products[p.category_id] || (products[p.category_id] = [])).push(item);
  });

  return {
    version,
    categories: cats.rows.map((c) => ({
      id: c.id, name: c.name, tagline: c.tagline, desc: c.description, image: c.image, tone: c.tone,
    })),
    products,
    bakeroomImage: bake || '',
    gallery: gal.rows.map((g) => g.image),
    galleryIds: gal.rows.map((g) => g.id),
  };
}

/* ------------------------------------------------------------------ */
/* Menu — validation                                                   */
/* ------------------------------------------------------------------ */
// Every cake's "Eggless … Charge ₹N" tag now reads the same: egg-free is included in the price.
const EGG_TAG_RE = /^eggless\b.*\bcharge\b/i;
const EGG_TAG_NEW = 'Eggfree extra charge included';
const normalizeEggTag = (tag) => (EGG_TAG_RE.test(String(tag).trim()) ? EGG_TAG_NEW : tag);

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanProduct(body = {}) {
  const n = str(body.n, 120);
  const p = typeof body.p === 'number' ? body.p : parseFloat(body.p);
  if (!n) throw new HttpError(400, 'Cake name is required');
  if (!Number.isFinite(p) || p < 0 || p > 10_000_000) throw new HttpError(400, 'Enter a valid price');
  const t = (Array.isArray(body.t) ? body.t : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 30);
  return { n, p, t };
}

/* ------------------------------------------------------------------ */
/* Menu — writes (every one is transactional and bumps the version)    */
/* ------------------------------------------------------------------ */
async function updateCategory(id, body = {}) {
  await db.tx(async (q) => {
    const { rows } = await q('SELECT id FROM categories WHERE id = ?', [id]);
    if (!rows[0]) throw new HttpError(404, 'Collection not found');
    const tagline = str(body.tagline, 200);
    const desc = str(body.desc, 800);
    if (tagline) await q('UPDATE categories SET tagline = ? WHERE id = ?', [tagline, id]);
    if (desc) await q('UPDATE categories SET description = ? WHERE id = ?', [desc, id]);
    if (typeof body.image === 'string' && body.image.trim()) {
      await q('UPDATE categories SET image = ? WHERE id = ?', [await resolveImage(q, body.image), id]);
    }
    await bumpVersion(q);
  });
  await cleanupMedia();
}

async function addProduct(catId, body) {
  const item = cleanProduct(body);
  await db.tx(async (q) => {
    const { rows } = await q('SELECT id FROM categories WHERE id = ?', [catId]);
    if (!rows[0]) throw new HttpError(404, 'Collection not found');
    const image = await resolveImage(q, body && body.img);
    const { rows: m } = await q('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products WHERE category_id = ?', [catId]);
    await q('INSERT INTO products (category_id, name, price, tags, image, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [catId, item.n, item.p, JSON.stringify(item.t), image, Number(m[0].m) + 1]);
    await bumpVersion(q);
  });
}

async function updateProduct(id, body) {
  const item = cleanProduct(body);
  await db.tx(async (q) => {
    const { rows } = await q('SELECT image FROM products WHERE id = ?', [id]);
    if (!rows[0]) throw new HttpError(404, 'Cake not found (it may have been removed on another device)');
    const newImage = await resolveImage(q, body && body.img);
    await q('UPDATE products SET name = ?, price = ?, tags = ?, image = ? WHERE id = ?',
      [item.n, item.p, JSON.stringify(item.t), newImage || rows[0].image, id]);
    await bumpVersion(q);
  });
  await cleanupMedia();
}

async function deleteProduct(id) {
  await db.tx(async (q) => {
    const r = await q('DELETE FROM products WHERE id = ?', [id]);
    if (!r.rowCount) throw new HttpError(404, 'Cake not found (it may have been removed on another device)');
    await bumpVersion(q);
  });
  await cleanupMedia();
}

async function addGalleryImage(image) {
  await db.tx(async (q) => {
    const src = await resolveImage(q, image);
    if (!src) throw new HttpError(400, 'Photo is required');
    const { rows } = await q('SELECT COALESCE(MAX(sort_order), 0) AS m FROM gallery');
    await q('INSERT INTO gallery (image, sort_order) VALUES (?, ?)', [src, Number(rows[0].m) + 1]);
    await bumpVersion(q);
  });
}

async function deleteGalleryImage(id) {
  await db.tx(async (q) => {
    const r = await q('DELETE FROM gallery WHERE id = ?', [id]);
    if (!r.rowCount) throw new HttpError(404, 'Photo not found (it may have been removed on another device)');
    await bumpVersion(q);
  });
  await cleanupMedia();
}

/** Replaces the whole menu with `menu` (same shape as the seed file). Used for seed, reset and import. */
async function replaceMenuTx(q, menu) {
  await q('DELETE FROM products');
  await q('DELETE FROM gallery');
  await q('DELETE FROM categories');

  const cats = Array.isArray(menu.categories) ? menu.categories : [];
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    await q('INSERT INTO categories (id, name, tagline, description, image, tone, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [str(c.id, 60), str(c.name, 120), str(c.tagline, 200), str(c.desc || c.description, 800),
        await resolveImage(q, c.image), str(c.tone, 40), i]);
  }
  const products = menu.products || {};
  for (const catId of Object.keys(products)) {
    const list = products[catId] || [];
    for (let i = 0; i < list.length; i++) {
      const item = cleanProduct(list[i]);
      item.t = item.t.map(normalizeEggTag);
      await q('INSERT INTO products (category_id, name, price, tags, image, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [catId, item.n, item.p, JSON.stringify(item.t), await resolveImage(q, list[i].img), i]);
    }
  }
  const gallery = Array.isArray(menu.gallery) ? menu.gallery : [];
  for (let i = 0; i < gallery.length; i++) {
    const src = await resolveImage(q, gallery[i]);
    if (src) await q('INSERT INTO gallery (image, sort_order) VALUES (?, ?)', [src, i]);
  }
  await setSetting(q, 'bakeroom_image', await resolveImage(q, menu.bakeroomImage));
  await bumpVersion(q);
}

const replaceMenu = async (menu) => { await db.tx((q) => replaceMenuTx(q, menu)); await cleanupMedia(); };
const resetMenu = () => replaceMenu(SEED_MENU);

/* ------------------------------------------------------------------ */
/* Orders (Bake Room custom-cake requests)                             */
/* ------------------------------------------------------------------ */
async function addOrder(fields, photoBuffer) {
  const order = {
    receivedAt: Date.now(),
    name: str(fields.name, 120), phone: str(fields.phone, 40), occasion: str(fields.occasion, 120),
    date: str(fields.date, 40), size: str(fields.size, 80), flavour: str(fields.flavour, 120),
    details: str(fields.details, 3000),
  };
  if (!order.name && !order.phone) throw new HttpError(400, 'Please include a name or phone number');
  return db.tx(async (q) => {
    const photo = photoBuffer ? await storeImageBuffer(q, photoBuffer) : '';
    const { rows } = await q(
      `INSERT INTO orders (received_at, name, phone, occasion, needed_on, size, flavour, details, photo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [order.receivedAt, order.name, order.phone, order.occasion, order.date, order.size, order.flavour, order.details, photo]);
    return { id: rows[0].id, ...order, receivedAt: new Date(order.receivedAt).toISOString(), photoUrl: photo || null };
  });
}

async function listOrders() {
  const { rows } = await db.query('SELECT * FROM orders ORDER BY received_at DESC, id DESC LIMIT 500');
  return rows.map((o) => ({
    id: o.id, receivedAt: new Date(Number(o.received_at)).toISOString(), name: o.name, phone: o.phone,
    occasion: o.occasion, date: o.needed_on, size: o.size, flavour: o.flavour, details: o.details,
    photoUrl: o.photo || null,
  }));
}

/* ------------------------------------------------------------------ */
/* Staff account + password reset                                      */
/* ------------------------------------------------------------------ */
async function getStaff() {
  const { rows } = await db.query('SELECT username, password_hash, email, is_default FROM staff WHERE id = 1');
  const s = rows[0];
  return s && { username: s.username, passwordHash: s.password_hash, email: s.email, isDefault: !!s.is_default };
}

async function updateStaff({ username, passwordHash, email }) {
  await db.query('UPDATE staff SET username = ?, password_hash = ?, email = ?, is_default = 0 WHERE id = 1',
    [username, passwordHash, email]);
}

async function saveResetToken(tokenHash, expiresAt) {
  await db.tx(async (q) => {
    await q('DELETE FROM reset_tokens'); // only the newest link is ever valid
    await q('INSERT INTO reset_tokens (token_hash, expires_at) VALUES (?, ?)', [tokenHash, expiresAt]);
  });
}

/** Single-use: returns true (and deletes the token) only if it exists and hasn't expired. */
async function consumeResetToken(tokenHash) {
  return db.tx(async (q) => {
    const { rows } = await q('SELECT expires_at FROM reset_tokens WHERE token_hash = ?', [tokenHash]);
    if (!rows[0]) return false; // wrong guess: leave the real token alone so nobody can cancel it by spamming
    await q('DELETE FROM reset_tokens WHERE token_hash = ?', [tokenHash]);
    return Number(rows[0].expires_at) > Date.now();
  });
}

let secretCache = null;
async function getSessionSecret() {
  if (secretCache) return secretCache;
  secretCache = process.env.SESSION_SECRET || (await getSetting('session_secret'));
  return secretCache;
}

/* ------------------------------------------------------------------ */
/* First-run initialisation                                            */
/* ------------------------------------------------------------------ */
async function init() {
  await migrate();

  const envPassword = process.env.STAFF_PASSWORD;
  const passwordHash = await hashPassword(envPassword || 'biscotti2026');
  const generatedSecret = crypto.randomBytes(48).toString('hex');

  await db.tx(async (q) => {
    // Cold starts on serverless can race; this lock makes first-run seeding happen exactly once.
    if (db.dialect === 'postgres') await q('SELECT pg_advisory_xact_lock(727274)');

    if (!(await getSetting('seeded', q))) {
      await replaceMenuTx(q, SEED_MENU);
      await setSetting(q, 'seeded', '1');
      console.log('[db] First run: loaded the default Biscotti menu.');
    }
    const { rows } = await q('SELECT id FROM staff WHERE id = 1');
    if (!rows[0]) {
      await q('INSERT INTO staff (id, username, password_hash, email, is_default) VALUES (1, ?, ?, ?, ?)',
        [process.env.STAFF_USERNAME || 'staff', passwordHash, process.env.STAFF_EMAIL || '', envPassword ? 0 : 1]);
      console.log('[db] First run: created the staff account.');
    }
    // One-time: databases created before this change still hold the old "Eggless Extra Charge ₹50" tags.
    if (!(await getSetting('migrated_eggfree_tag_v1', q))) {
      const { rows: all } = await q('SELECT id, tags FROM products');
      let changed = 0;
      for (const r of all) {
        let tags; try { tags = JSON.parse(r.tags); } catch (_) { continue; }
        const next = tags.map(normalizeEggTag);
        if (JSON.stringify(next) !== JSON.stringify(tags)) {
          await q('UPDATE products SET tags = ? WHERE id = ?', [JSON.stringify(next), r.id]);
          changed++;
        }
      }
      await setSetting(q, 'migrated_eggfree_tag_v1', '1');
      if (changed) { await bumpVersion(q); console.log(`[db] Updated the egg-free tag on ${changed} cakes.`); }
    }
    if (!(await getSetting('session_secret', q))) await setSetting(q, 'session_secret', generatedSecret);
  });
}

let readyPromise = null;
const ready = () => {
  if (!readyPromise) readyPromise = init().catch((err) => { readyPromise = null; throw err; });
  return readyPromise;
};

module.exports = {
  HttpError, ready, getVersion, getMenu, getMedia, cleanupMedia,
  updateCategory, addProduct, updateProduct, deleteProduct,
  addGalleryImage, deleteGalleryImage, resetMenu, replaceMenu,
  addOrder, listOrders,
  getStaff, updateStaff, saveResetToken, consumeResetToken, getSessionSecret,
  storeImageBuffer,
};
