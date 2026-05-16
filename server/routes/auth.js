// /api/auth/* — 登入 / 登出 / 看當前 user / bootstrap admin
//
// Endpoints:
//   POST /api/auth/bootstrap-admin    第一個 admin 建立（users 表空時才能用、之後 403）
//   POST /api/auth/login              帳號密碼 → JWT
//   GET  /api/auth/me                 當前登入 user（從 token 解、再 fresh fetch DB）
//   POST /api/auth/logout             無狀態 JWT、client 自己丟 token 即可、此 endpoint 純為 audit

import express from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/db.js';
import {
  hashPassword,
  verifyPassword,
  signJwt,
  getJwtSecret,
} from '../lib/auth.js';
import { ROLE_TEMPLATES, ALL_PERMISSIONS } from '../lib/permissions.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function getSecret() {
  return getJwtSecret(process.env.DB_PATH || '/data/db.sqlite');
}

function userToPayload(u, permissions) {
  return {
    sub: u.id,
    username: u.username,
    role: u.role,
    permissions,
  };
}

function userToObj(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    permissions: JSON.parse(u.permissions || '[]'),
    isActive: u.is_active === 1,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    lastLoginAt: u.last_login_at,
  };
}

// ─── POST /api/auth/bootstrap-admin ───────────────────
// 第一次設定、users 表空時才開放
// body: { username, password, displayName? }
router.post('/bootstrap-admin', async (req, res) => {
  try {
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (count > 0) {
      return res.status(403).json({
        error: 'already_bootstrapped',
        message: '已有用戶、不能再 bootstrap、請用 /api/auth/login 登入或請 admin 新增帳號',
      });
    }
    const { username, password, displayName } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'validation_error', message: 'username + password required' });
    }
    if (typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'validation_error', message: '密碼至少 4 字' });
    }

    const hash = await hashPassword(password);
    const now = nowIso();
    const id = crypto.randomUUID();
    const role = 'admin';
    const permissions = ALL_PERMISSIONS;

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, permissions, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, username, hash, displayName || username, role, JSON.stringify(permissions), now, now);

    const token = signJwt(userToPayload({ id, username, role }, permissions), getSecret());
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.status(201).json({ data: { user: userToObj(u), token } });
  } catch (e) {
    console.error('[auth/bootstrap-admin]', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// ─── POST /api/auth/login ─────────────────────────────
// body: { username, password }
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'validation_error', message: 'username + password required' });
    }
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
    if (!u) {
      // 避免 timing attack：故意 await scrypt 一次
      await verifyPassword(password, 'scrypt$0$0');
      return res.status(401).json({ error: 'invalid_credentials', message: '帳號或密碼錯誤' });
    }
    const ok = await verifyPassword(password, u.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials', message: '帳號或密碼錯誤' });
    }
    // update last_login_at
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), u.id);

    const permissions = JSON.parse(u.permissions || '[]');
    const token = signJwt(userToPayload(u, permissions), getSecret());
    res.json({ data: { user: userToObj(u), token } });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────
// 回當前登入 user 的詳細資料（從 DB 重新拉、保證 permissions 是最新的）
router.get('/me', authRequired, (req, res) => {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(req.user.id);
  if (!u) {
    return res.status(401).json({ error: 'unauthorized', message: '帳號不存在或已停用' });
  }
  res.json({ data: userToObj(u) });
});

// ─── POST /api/auth/logout ────────────────────────────
// JWT 是無狀態、server 不存 session、所以 logout 純粹是 client 丟掉 token
// 此 endpoint 留著、未來可加 token blacklist
router.post('/logout', authRequired, (_req, res) => {
  res.json({ data: { ok: true } });
});

export default router;
