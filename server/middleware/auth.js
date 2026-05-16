// Auth middleware
//
// v0.6.0 Phase 1：stub、所有請求視為 system/admin
// v0.6.1 Phase 2（本檔）：真實 JWT 驗證 + role + permission 檢查
//
// 行為：
//   1. authOptional: 試解 JWT、有解出就塞 req.user；沒帶或失敗也讓請求繼續（給 /api/auth/login 用）
//   2. authRequired: 強制要有合法 JWT、否則 401
//   3. requirePermission(perm): authRequired + 檢查 req.user.permissions 是否含 perm、否則 403
//
// JWT 從 Authorization: Bearer <token> 拿。

import { verifyJwt, getJwtSecret } from '../lib/auth.js';
import { hasPermission } from '../lib/permissions.js';

// helper：從 req 抽 token
function extractToken(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'];
  if (!h || typeof h !== 'string') return null;
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

// 從 process env / db path 拿 JWT secret
let _secretCache = null;
function getSecret() {
  if (_secretCache) return _secretCache;
  const dbPath = process.env.DB_PATH || '/data/db.sqlite';
  _secretCache = getJwtSecret(dbPath);
  return _secretCache;
}

// authOptional — 試解、解不出無妨、req.user 可能是 undefined
export function authOptional(req, _res, next) {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    req.clientId = req.headers['x-client-id'] || null;
    return next();
  }
  try {
    const payload = verifyJwt(token, getSecret());
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions || [],
    };
  } catch (_e) {
    req.user = null;
  }
  req.clientId = req.headers['x-client-id'] || null;
  next();
}

// authRequired — 沒合法 token 就 401
export function authRequired(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: '需要登入' });
  }
  try {
    const payload = verifyJwt(token, getSecret());
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions || [],
    };
    req.clientId = req.headers['x-client-id'] || null;
    next();
  } catch (e) {
    return res.status(401).json({
      error: 'unauthorized',
      message: e.message === 'token expired' ? '登入過期、請重新登入' : '無效的 token',
    });
  }
}

// requirePermission — authRequired + 權限檢查
export function requirePermission(perm) {
  return (req, res, next) => {
    authRequired(req, res, (err) => {
      if (err) return next(err);
      if (!hasPermission(req.user.permissions, perm)) {
        return res.status(403).json({
          error: 'forbidden',
          message: `沒有權限：${perm}`,
          required: perm,
        });
      }
      next();
    });
  };
}

// 保留 Phase 1 的 authStub、給 PUBLIC endpoints / open phase 用
// 之後可移除、現在保留向下相容
export function authStub(req, _res, next) {
  req.user = {
    id: 'system',
    username: 'system',
    role: 'admin',
    permissions: ['*'],
  };
  req.clientId = req.headers['x-client-id'] || null;
  next();
}
