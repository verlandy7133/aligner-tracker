// 密碼 hash + JWT sign / verify
//
// 用 Node 內建 crypto（無 native build、無 npm dep）：
//   - scrypt 算密碼 hash（安全、推薦）
//   - HMAC-SHA256 算 JWT signature (HS256)
//
// JWT secret 從 /data/jwt-secret.txt 讀、第一次跑自動生成 64-byte random、寫進去。
// （存 NAS volume、server 重啟 token 仍有效）

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCRYPT_KEY_LEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

// ─── 密碼 hash ────────────────────────────────────────
// 格式：scrypt$<salt-hex>$<hash-hex>
export async function hashPassword(plain) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(plain, salt, SCRYPT_KEY_LEN, SCRYPT_PARAMS, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt.toString('hex')}$${derived.toString('hex')}`);
    });
  });
}

export async function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(plain, salt, expected.length, SCRYPT_PARAMS, (err, derived) => {
      if (err) return reject(err);
      // 用 timingSafeEqual 防 timing attack
      resolve(crypto.timingSafeEqual(expected, derived));
    });
  });
}

// ─── JWT secret 管理 ──────────────────────────────────
// 讀取優先序（v0.6.8 防禦縱深 — 讓 secret 可離開「可被 /api/file serve 的 /data」）：
//   1. process.env.JWT_SECRET       — 直接給值（NAS 設環境變數最省事）
//   2. process.env.JWT_SECRET_PATH  — 指向「未掛進 serve 目錄」的檔（如 /run/secrets/jwt）
//   3. fallback：現行 <dbPath 同層>/jwt-secret.txt（未設 env 時維持原行為、向下相容）
// 注意：本次只加「讀取來源優先序」、不主動更換 secret 值（換 secret 會讓現有 token 全失效）。
let _jwtSecret = null;
export function getJwtSecret(dbPath) {
  if (_jwtSecret) return _jwtSecret;
  // (1) 環境變數直接給值
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    _jwtSecret = process.env.JWT_SECRET.trim();
    return _jwtSecret;
  }
  // (2) 環境變數指向 secret 檔（放非 serve 目錄）
  const envPath = process.env.JWT_SECRET_PATH;
  if (envPath && fs.existsSync(envPath)) {
    _jwtSecret = fs.readFileSync(envPath, 'utf8').trim();
    return _jwtSecret;
  }
  // (3) fallback：跟 db.sqlite 放同層、namespace 用 <dir>/jwt-secret.txt
  const dir = path.dirname(dbPath);
  const secretFile = path.join(dir, 'jwt-secret.txt');
  if (fs.existsSync(secretFile)) {
    _jwtSecret = fs.readFileSync(secretFile, 'utf8').trim();
    return _jwtSecret;
  }
  // 首次跑、生 64-byte random
  const newSecret = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(secretFile, newSecret + '\n', { mode: 0o600 });
  console.log(`[auth] 第一次跑、生成 JWT secret 寫進 ${secretFile}`);
  _jwtSecret = newSecret;
  return _jwtSecret;
}

// ─── JWT sign / verify (HS256) ────────────────────────
function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function base64urlDecode(s) {
  return Buffer.from(s, 'base64url');
}

export function signJwt(payload, secret, ttlSec = 8 * 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSec };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(fullPayload));
  const data = `${h}.${p}`;
  const sig = base64url(
    crypto.createHmac('sha256', secret).update(data).digest(),
  );
  return `${data}.${sig}`;
}

export function verifyJwt(token, secret) {
  if (!token || typeof token !== 'string') throw new Error('no token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad token format');
  const [h, p, sig] = parts;
  const data = `${h}.${p}`;
  const expected = base64url(
    crypto.createHmac('sha256', secret).update(data).digest(),
  );
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('bad signature');
  }
  const payload = JSON.parse(base64urlDecode(p).toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token expired');
  }
  return payload;
}
