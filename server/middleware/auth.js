// Auth middleware — Phase 1 stub
//
// Phase 1: 無 auth、所有請求視為 'system' user / 'admin' role
// Phase 2+: 真實 JWT 驗證、塞 req.user
//
// 行為：
//   - 讀 X-User-Id header（client 帶哪個就用哪個、Phase 2 換成 JWT）
//   - 讀 X-Client-Id header（給 audit / SSE 排除自己用）
//   - 沒帶 → 預設 'system' / 'admin'

export function authStub(req, _res, next) {
  req.user = {
    id: req.headers['x-user-id'] || 'system',
    role: 'admin', // Phase 1 全部視為 admin
  };
  req.clientId = req.headers['x-client-id'] || null;
  next();
}
