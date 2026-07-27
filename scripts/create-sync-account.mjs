#!/usr/bin/env node
// 一次性：用 admin 身分呼叫 /api/users 建「sync」帳號，給每天 12:00 的 Excel 自動匯入用。
//
// 權限（最小化）：patient.view + patient.create + patient.edit
//                order.view  + order.create  + order.edit
//   ❌ 不給任何 delete、不給 settings.*（含 settings.data、所以碰不到 bulk upsert）
//   ❌ 非 passwordless
//
// ⚠️ 這支只需跑一次、由 admin 執行。不直接 INSERT DB（會繞過 audit）。
//
// 用法（PowerShell，帳密走環境變數、不寫進檔案、不進 git）：
//   $env:ADMIN_USER='你的admin帳號'; $env:ADMIN_PASS='你的admin密碼'
//   $env:NEW_SYNC_PASS='給sync帳號的新密碼(至少4字)'
//   node scripts/create-sync-account.mjs
//
// 或若你已經有 admin token：
//   $env:ADMIN_TOKEN='eyJ...'; $env:NEW_SYNC_PASS='...'
//   node scripts/create-sync-account.mjs
//
// 成功後：把 SYNC_USER=sync / SYNC_PASS=<NEW_SYNC_PASS> 寫進 scripts/.sync-env（已 gitignore）。

const NAS_API = process.env.NAS_API || 'http://100.115.111.45:8080';
const NAS_LAN = process.env.NAS_LAN_FALLBACK || 'http://192.168.0.220:8080';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const ADMIN_TOKEN_ENV = process.env.ADMIN_TOKEN || '';
const NEW_SYNC_PASS = process.env.NEW_SYNC_PASS || '';
const NEW_SYNC_USER = process.env.NEW_SYNC_USER || 'sync';

const SYNC_PERMISSIONS = [
  'patient.view',
  'patient.create',
  'patient.edit',
  'order.view',
  'order.create',
  'order.edit',
];

function die(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

async function tryBoth(pathPart, opts) {
  try {
    return await fetch(NAS_API + pathPart, { ...opts, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    console.log(`  (Tailscale 不通: ${e.message}、試 LAN fallback)`);
    return await fetch(NAS_LAN + pathPart, { ...opts, signal: AbortSignal.timeout(8000) });
  }
}

async function main() {
  if (!NEW_SYNC_PASS || NEW_SYNC_PASS.length < 4) {
    die('缺 NEW_SYNC_PASS（給 sync 帳號的新密碼、至少 4 字）。');
  }

  // 1. 取得 admin token
  let token = ADMIN_TOKEN_ENV;
  if (!token) {
    if (!ADMIN_USER || !ADMIN_PASS) {
      die('請設 ADMIN_TOKEN，或 ADMIN_USER + ADMIN_PASS 讓腳本 login。');
    }
    console.log(`[1/2] 用 ${ADMIN_USER} login 拿 admin token...`);
    const r = await tryBoth('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) die(`admin login 失敗 HTTP ${r.status} ${j?.message || ''}`);
    token = j?.data?.token;
    if (!token) die('login 回應無 token');
    if (!(j?.data?.user?.permissions || []).includes('settings.users')) {
      die('此帳號沒有 settings.users 權限、無法建帳號。請用真正的 admin 帳號。');
    }
    console.log('  ✓ 拿到 admin token');
  }

  // 2. 建 sync 帳號（custom role、最小權限、無 delete、無 settings.*）
  console.log(`[2/2] 建 ${NEW_SYNC_USER} 帳號（${SYNC_PERMISSIONS.join(' + ')}）...`);
  const r = await tryBoth('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      username: NEW_SYNC_USER,
      password: NEW_SYNC_PASS,
      displayName: 'Excel 自動匯入服務帳號',
      role: 'custom',
      permissions: SYNC_PERMISSIONS,
      passwordless: false,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 409) {
    console.log(`  ⚠️ ${NEW_SYNC_USER} 帳號已存在。若忘記密碼、請在帳號管理頁重設、或用 /api/users/:id/password。`);
    console.log(`     （權限請確認只有 ${SYNC_PERMISSIONS.join(' + ')}）`);
    process.exit(0);
  }
  if (!r.ok) die(`建帳號失敗 HTTP ${r.status} ${j?.message || JSON.stringify(j)}`);
  console.log(`  ✓ 建好：${j?.data?.username}（權限 ${JSON.stringify(j?.data?.permissions)}）`);
  console.log('');
  console.log('下一步：把以下兩行寫進 scripts/.sync-env（已 gitignore）：');
  console.log(`  SYNC_USER=${NEW_SYNC_USER}`);
  console.log('  SYNC_PASS=<你剛設的 NEW_SYNC_PASS>');
  console.log('');
  console.log('然後驗證：node scripts/auto-import-excel.mjs --dry-run');
}

main().catch((e) => die(e.message));
