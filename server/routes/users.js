// /api/users — admin 管帳號 CRUD
//
// 全部 endpoint 需要 settings.users permission（一般是 admin 才有）
//
// Endpoints:
//   GET    /api/users           列所有帳號
//   POST   /api/users           新增帳號
//   PUT    /api/users/:id       改帳號（含 permissions 勾選）
//   POST   /api/users/:id/password  改密碼
//   DELETE /api/users/:id       刪帳號
//
// 注意：永遠不回 password_hash 給 client

import express from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/db.js';
import { hashPassword } from '../lib/auth.js';
import { ROLE_TEMPLATES, ALL_PERMISSIONS } from '../lib/permissions.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function userToObj(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    permissions: JSON.parse(u.permissions || '[]'),
    isActive: u.is_active === 1,
    passwordless: u.passwordless === 1,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    lastLoginAt: u.last_login_at,
  };
}

function validatePermissions(perms) {
  if (!Array.isArray(perms)) return false;
  return perms.every((p) => ALL_PERMISSIONS.includes(p));
}

// 全部 endpoint 都需要 settings.users 權限
router.use(requirePermission('settings.users'));

// ─── GET /api/users ──────────────────────────────────
router.get('/', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  res.json({ data: rows.map(userToObj) });
});

// ─── POST /api/users ─────────────────────────────────
// body: { username, password?, displayName?, role, permissions?, passwordless? }
// 若 permissions 沒帶、套 role template
// passwordless=true → 不需要 password、login 只用 username
router.post('/', audit('user'), async (req, res) => {
  try {
    const { username, password, displayName, role, permissions, passwordless } = req.body || {};
    if (!username) {
      return res.status(400).json({ error: 'validation_error', message: 'username required' });
    }
    const isPasswordless = passwordless === true;
    if (!isPasswordless) {
      if (!password) {
        return res.status(400).json({ error: 'validation_error', message: 'password required (or set passwordless=true)' });
      }
      if (typeof password !== 'string' || password.length < 4) {
        return res.status(400).json({ error: 'validation_error', message: '密碼至少 4 字' });
      }
    }
    if (!role || !(role in ROLE_TEMPLATES) && role !== 'custom') {
      return res.status(400).json({ error: 'validation_error', message: 'role 必須是預設 template 或 "custom"' });
    }

    let effectivePerms;
    if (Array.isArray(permissions)) {
      if (!validatePermissions(permissions)) {
        return res.status(400).json({ error: 'validation_error', message: 'permissions 含無效項目' });
      }
      effectivePerms = permissions;
    } else {
      effectivePerms = ROLE_TEMPLATES[role] || [];
    }

    const db = getDb();
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) {
      return res.status(409).json({ error: 'already_exists', message: 'username 已存在' });
    }

    // passwordless 帳號 password_hash 存空字串、verifyPassword 永遠失敗（無法被一般 login 路徑進）
    const hash = isPasswordless ? '' : await hashPassword(password);
    const now = nowIso();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, permissions, is_active, passwordless, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(id, username, hash, displayName || username, role, JSON.stringify(effectivePerms), isPasswordless ? 1 : 0, now, now);

    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.status(201).json({ data: userToObj(u) });
  } catch (e) {
    console.error('[users POST]', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// ─── PUT /api/users/:id ──────────────────────────────
// body: { displayName?, role?, permissions?, isActive?, passwordless? }
// 不可改 password、用 /api/users/:id/password 那條
// 不可改 username（避免身份混亂）
// passwordless 切換為 true 時、password_hash 清空（之後只能用 username 登入、不能再回去密碼登入直到 admin 重設密碼）
// passwordless 切換為 false 時、password_hash 仍是空、admin 必須額外呼叫 /password 設新密碼
router.put('/:id', audit('user'), (req, res) => {
  const id = req.params.id;
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  req.beforeRow = userToObj(u);

  const { displayName, role, permissions, isActive, passwordless } = req.body || {};
  let nextDisplayName = u.display_name;
  let nextRole = u.role;
  let nextPerms = u.permissions;
  let nextActive = u.is_active;
  let nextPasswordless = u.passwordless;
  let nextHash = u.password_hash;

  if (displayName !== undefined) nextDisplayName = displayName;
  if (role !== undefined) {
    if (!(role in ROLE_TEMPLATES) && role !== 'custom') {
      return res.status(400).json({ error: 'validation_error', message: 'role 無效' });
    }
    nextRole = role;
  }
  if (permissions !== undefined) {
    if (!validatePermissions(permissions)) {
      return res.status(400).json({ error: 'validation_error', message: 'permissions 含無效項目' });
    }
    nextPerms = JSON.stringify(permissions);
  }
  if (isActive !== undefined) {
    nextActive = isActive ? 1 : 0;
  }
  if (passwordless !== undefined) {
    nextPasswordless = passwordless ? 1 : 0;
    if (passwordless) {
      // 切到 passwordless、清空 hash（即便先前有密碼也作廢）
      nextHash = '';
    }
  }

  db.prepare(`
    UPDATE users SET display_name = ?, role = ?, permissions = ?, is_active = ?, passwordless = ?, password_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(nextDisplayName, nextRole, nextPerms, nextActive, nextPasswordless, nextHash, nowIso(), id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ data: userToObj(updated) });
});

// ─── POST /api/users/:id/password ─────────────────────
// body: { newPassword }
router.post('/:id/password', audit('user'), async (req, res) => {
  try {
    const id = req.params.id;
    const { newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
      return res.status(400).json({ error: 'validation_error', message: '密碼至少 4 字' });
    }
    const db = getDb();
    const u = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!u) return res.status(404).json({ error: 'not_found' });

    const hash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hash, nowIso(), id);
    res.json({ data: { ok: true } });
  } catch (e) {
    console.error('[users password]', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// ─── DELETE /api/users/:id ───────────────────────────
// 不能刪自己（避免 admin 把自己鎖出）
router.delete('/:id', audit('user'), (req, res) => {
  const id = req.params.id;
  if (req.user.id === id) {
    return res.status(400).json({ error: 'cannot_delete_self', message: '不能刪除自己的帳號' });
  }
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  req.beforeRow = userToObj(u);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ data: { id, deleted: true } });
});

export default router;
