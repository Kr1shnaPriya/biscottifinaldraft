/**
 * End-to-end smoke test:  npm test
 *
 * Starts the real server against a throw-away SQLite database, exercises the
 * API, then KILLS and RESTARTS the server to prove that data survives.
 * (To test against PostgreSQL instead, run with TEST_DATABASE_URL=postgres://…)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'biscotti-test-'));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let server;
function start() {
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: TMP, NODE_ENV: 'test', STAFF_EMAIL: 'owner@example.com' };
  delete env.STAFF_PASSWORD; delete env.VERCEL;
  if (process.env.TEST_DATABASE_URL) env.DATABASE_URL = process.env.TEST_DATABASE_URL; else delete env.DATABASE_URL;
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(d));
  return waitUntilUp();
}
async function waitUntilUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
}
const stop = () => new Promise((r) => { server.once('exit', r); server.kill('SIGTERM'); });

const api = async (method, url, { body, token, headers } = {}) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = text; }
  return { status: res.status, json, headers: res.headers };
};

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };

(async () => {
  console.log(`Using temp database in ${TMP}\n`);
  await start();
  let token, menu, productId;

  await test('health check reports the database', async () => {
    const r = await api('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.ok(['sqlite', 'postgres'].includes(r.json.database));
  });

  await test('first run seeds the default menu', async () => {
    const r = await api('GET', '/api/menu');
    menu = r.json;
    assert.equal(menu.categories.length, 7);
    assert.equal(Object.values(menu.products).flat().length, 61);
    assert.equal(menu.gallery.length, 34);
    assert.ok(Object.values(menu.products).flat().every((p) => Number.isInteger(p.id)));
  });

  await test('menu supports ETag / 304 revalidation', async () => {
    const first = await api('GET', '/api/menu');
    const second = await api('GET', '/api/menu', { headers: { 'If-None-Match': first.headers.get('etag') } });
    assert.equal(second.status, 304);
  });

  await test('writes without a login are rejected', async () => {
    assert.equal((await api('POST', '/api/products/classic', { body: { n: 'X', p: 1 } })).status, 401);
    assert.equal((await api('GET', '/api/orders')).status, 401);
  });

  await test('wrong password rejected, right password returns a token', async () => {
    assert.equal((await api('POST', '/api/staff/login', { body: { username: 'staff', password: 'nope' } })).status, 401);
    const ok = await api('POST', '/api/staff/login', { body: { username: 'staff', password: 'biscotti2026' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.usingDefaultPassword, true);
    token = ok.json.token;
  });

  await test('add a cake → appears in the menu with an id', async () => {
    const r = await api('POST', '/api/products/classic', { token, body: { n: 'Test Cake', p: 999, t: ['Small ₹100'] } });
    assert.equal(r.status, 200);
    const item = r.json.menu.products.classic.find((p) => p.n === 'Test Cake');
    assert.ok(item && item.p === 999 && item.t[0] === 'Small ₹100');
    productId = item.id;
  });

  await test('edit a cake by id', async () => {
    const r = await api('PUT', `/api/products/${productId}`, { token, body: { n: 'Test Cake 2', p: 1234.5, t: [] } });
    assert.equal(r.status, 200);
    const item = r.json.menu.products.classic.find((p) => p.id === productId);
    assert.equal(item.n, 'Test Cake 2'); assert.equal(item.p, 1234.5);
  });

  await test('invalid input is rejected', async () => {
    assert.equal((await api('POST', '/api/products/classic', { token, body: { n: '', p: 5 } })).status, 400);
    assert.equal((await api('POST', '/api/products/classic', { token, body: { n: 'A', p: -3 } })).status, 400);
    assert.equal((await api('POST', '/api/products/nope', { token, body: { n: 'A', p: 3 } })).status, 404);
    assert.equal((await api('PUT', '/api/categories/classic', { token, body: { image: 'javascript:alert(1)' } })).status, 400);
    assert.equal((await api('PUT', '/api/categories/classic', { token, body: { image: 'data:image/png;base64,aGVsbG8gd29ybGQ=' } })).status, 400);
  });

  await test('photo upload is stored in the database and served from /media', async () => {
    const r = await api('PUT', '/api/products/' + productId, { token, body: { n: 'Test Cake 2', p: 10, t: [], img: PNG } });
    const img = r.json.menu.products.classic.find((p) => p.id === productId).img;
    assert.match(img, /^\/media\/[a-f0-9]{32}$/);
    const media = await fetch(BASE + img);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('content-type'), 'image/png');
    assert.ok(JSON.stringify(r.json).length < 20000, 'menu JSON must stay small (no base64 inside)');
  });

  await test('gallery add + delete by id', async () => {
    const added = await api('POST', '/api/gallery', { token, body: { image: PNG } });
    assert.equal(added.json.menu.gallery.length, 35);
    const id = added.json.menu.galleryIds[34];
    const removed = await api('DELETE', `/api/gallery/${id}`, { token });
    assert.equal(removed.json.menu.gallery.length, 34);
    assert.equal((await api('DELETE', `/api/gallery/${id}`, { token })).status, 404);
  });

  await test('editing a cake deleted on another device gives a clear 404', async () => {
    const extra = await api('POST', '/api/products/regular', { token, body: { n: 'Temp', p: 5 } });
    const id = extra.json.menu.products.regular.find((p) => p.n === 'Temp').id;
    await api('DELETE', `/api/products/${id}`, { token });            // "device A" deletes it
    const r = await api('PUT', `/api/products/${id}`, { token, body: { n: 'Temp', p: 6 } }); // "device B" edits it
    assert.equal(r.status, 404);
  });

  await test('Bake Room request with photo is saved (public) and visible to staff', async () => {
    const form = new FormData();
    form.set('name', 'Asha'); form.set('phone', '9999999999'); form.set('details', 'Unicorn theme');
    form.set('photo', new Blob([Buffer.from(PNG.split(',')[1], 'base64')], { type: 'image/png' }), 'ref.png');
    const created = await api('POST', '/api/orders', { body: form });
    assert.equal(created.status, 201);
    const list = await api('GET', '/api/orders', { token });
    assert.equal(list.json[0].name, 'Asha');
    assert.match(list.json[0].photoUrl, /^\/media\//);
  });

  // ---- the important one ----
  await test('DATA SURVIVES A SERVER RESTART', async () => {
    const before = (await api('GET', '/api/menu')).json;
    await stop();
    await start();
    const after = (await api('GET', '/api/menu')).json;
    assert.deepStrictEqual(after, before);
    assert.ok(after.products.classic.some((p) => p.n === 'Test Cake 2'));
    const again = await api('POST', '/api/staff/login', { body: { username: 'staff', password: 'biscotti2026' } });
    assert.equal(again.status, 200, 'old/new login tokens + staff account persist');
    token = again.json.token;
    assert.equal((await api('GET', '/api/orders', { token })).json.length, 1);
  });

  await test('a token issued before the restart is still valid (stateless sessions)', async () => {
    assert.equal((await api('GET', '/api/staff/me', { token })).status, 200);
  });

  await test('changing the password logs out old sessions and persists', async () => {
    const r = await api('POST', '/api/staff/change-password', { token, body: { currentPassword: 'biscotti2026', newPassword: 'newpass123', newUsername: 'owner', newEmail: 'owner@example.com' } });
    assert.equal(r.status, 200);
    assert.equal((await api('GET', '/api/staff/me', { token })).status, 401, 'old token must stop working');
    assert.equal((await api('GET', '/api/staff/me', { token: r.json.token })).status, 200);
    assert.equal((await api('POST', '/api/staff/login', { body: { username: 'owner', password: 'newpass123' } })).status, 200);
    assert.equal((await api('POST', '/api/staff/login', { body: { username: 'staff', password: 'biscotti2026' } })).status, 401);
    token = r.json.token;
  });

  await test('forgot-password → reset link works once and sets a new password', async () => {
    const wrong = await api('POST', '/api/staff/forgot-password', { body: { email: 'someone@else.com' } });
    assert.equal(wrong.json.devResetUrl, undefined);
    const f = await api('POST', '/api/staff/forgot-password', { body: { email: 'OWNER@example.com' } });
    const resetToken = new URL(f.json.devResetUrl).searchParams.get('resetToken');
    assert.ok(resetToken);
    assert.equal((await api('POST', '/api/staff/reset-password', { body: { token: 'bad', newPassword: 'whatever1' } })).status, 400);
    assert.equal((await api('POST', '/api/staff/reset-password', { body: { token: resetToken, newPassword: 'resetpass1' } })).status, 200);
    assert.equal((await api('POST', '/api/staff/reset-password', { body: { token: resetToken, newPassword: 'again12345' } })).status, 400, 'single use');
    const login = await api('POST', '/api/staff/login', { body: { username: 'owner', password: 'resetpass1' } });
    assert.equal(login.status, 200);
    token = login.json.token;
  });

  await test('reset menu restores the defaults (orders & login untouched)', async () => {
    const r = await api('POST', '/api/reset', { token });
    assert.equal(r.json.menu.products.classic.some((p) => p.n === 'Test Cake 2'), false);
    assert.equal(Object.values(r.json.menu.products).flat().length, 61);
    assert.equal((await api('GET', '/api/orders', { token })).json.length, 1);
  });

  await stop();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nAll ${passed} checks passed.`);
})().catch(async (err) => {
  console.error('\n✗ FAILED:', err.message);
  if (err.expected !== undefined) console.error('  expected:', err.expected, '\n  actual:  ', err.actual);
  try { if (server) server.kill('SIGKILL'); } catch (_) { /* ignore */ }
  process.exit(1);
});
