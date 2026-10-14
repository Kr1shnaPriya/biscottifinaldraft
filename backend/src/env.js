/**
 * Tiny .env loader (no dependency). Reads backend/.env, then ../.env, and only fills in
 * variables that are not already set — so real environment variables (hosting dashboards,
 * Docker, Vercel) always win. Blank values are ignored.
 */
const fs = require('fs');
const path = require('path');

for (const file of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1].startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (value !== '' && process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
