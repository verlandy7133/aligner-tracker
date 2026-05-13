// Folder Helper — 本地 HTTP service，讓 web app 可以呼叫系統 explorer.exe 開資料夾。
// 由於瀏覽器擋掉 file:// 連結 (從 http://localhost 觸發)，
// 我們在 localhost:8765 跑一個小 service 接收請求，由它呼叫 OS。
//
// 安全：
//   - 只 listen 127.0.0.1 (不對外開放)
//   - 只允許開啟 ALLOWED_ROOTS 底下的路徑 (避免被惡意網頁打)
//   - 嚴格清掉路徑中的 quote 字元，再交給 explorer.exe
//
// 啟動：node scripts/folder-helper.mjs (或跟 vite 一起由 dev-launcher 啟動)

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PORT = 8765;
// 自動偵測安裝碟：優先 D 槽（vrlndy 主機慣例），否則用系統碟（C: 通常）
const DRIVE = fs.existsSync('D:\\') ? 'D:' : (process.env.SystemDrive || 'C:');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCAN_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'scan-aligner-folders.mjs');
const PATIENTS_JSON = path.join(PROJECT_ROOT, 'dev-data', 'patients-import.json');
const ROLE_FILE = path.join(PROJECT_ROOT, 'dev-data', 'clinic-role.txt');
const PATHS_FILE = path.join(PROJECT_ROOT, 'dev-data', 'clinic-paths.json');
const ANTHROPIC_KEY_FILE = path.join(PROJECT_ROOT, 'dev-data', 'anthropic-key.txt');

// 讀 Anthropic API key（AI 一鍵填入用）
function readAnthropicKey() {
  try {
    const raw = fs.readFileSync(ANTHROPIC_KEY_FILE, 'utf8').trim();
    // 防呆：剝掉可能存在的 export / quote / 註解
    const cleaned = raw
      .split('\n')[0] // 只第一行
      .replace(/^(export\s+)?ANTHROPIC_API_KEY\s*=\s*/, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    return cleaned || null;
  } catch {
    return null;
  }
}

// ─── 路徑設定（NAS-ready）───────────────────────────────
// clinic-paths.json schema:
//   {
//     "dataRoot": "Z:\\矯正追蹤",        // 病患資料夾 + 授權書 + Excel 都在這底下
//     "syncFile": "Z:\\矯正追蹤\\sync.json"  // 跨機同步用的單一 JSON 檔
//   }
// 不存在 → fallback 到舊邏輯（{DRIVE}\矯正、無同步檔）
function readPathsConfig() {
  const fallback = {
    dataRoot: `${DRIVE}\\矯正`,
    syncFile: '', // 空字串 = 沒設定，跨機同步功能不可用
  };
  try {
    const raw = fs.readFileSync(PATHS_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    return {
      dataRoot: typeof cfg.dataRoot === 'string' && cfg.dataRoot.trim() ? cfg.dataRoot.trim() : fallback.dataRoot,
      syncFile: typeof cfg.syncFile === 'string' ? cfg.syncFile.trim() : '',
    };
  } catch {
    return fallback;
  }
}

function writePathsConfig(cfg) {
  const out = {
    dataRoot: typeof cfg.dataRoot === 'string' ? cfg.dataRoot.trim() : '',
    syncFile: typeof cfg.syncFile === 'string' ? cfg.syncFile.trim() : '',
  };
  if (!out.dataRoot) throw new Error('dataRoot 必填');
  fs.writeFileSync(PATHS_FILE, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

// 動態組 allowlist：dataRoot + syncFile 所在資料夾 + 開發專案資料夾
function getAllowedRoots() {
  const cfg = readPathsConfig();
  const roots = [cfg.dataRoot, `${DRIVE}\\dev\\矯正追蹤-app`];
  if (cfg.syncFile) {
    roots.push(path.dirname(cfg.syncFile));
  }
  // 維持向後相容：D:\矯正 / C:\矯正（v0.1.6 以前版本可能寫死這個）
  if (cfg.dataRoot !== `${DRIVE}\\矯正`) {
    roots.push(`${DRIVE}\\矯正`);
  }
  return [...new Set(roots)];
}

// 讀本機角色：master = 持有真實 矯正/ 資料夾、可掃描；follower = 開發機，只能透過 backup 還原。
// dev-data/clinic-role.txt 不存在或內容不是 "master" → 預設 follower（保守、防誤動）
function readRole() {
  try {
    return fs.readFileSync(ROLE_FILE, 'utf8').trim().toLowerCase() === 'master'
      ? 'master'
      : 'follower';
  } catch {
    return 'follower';
  }
}

// 把 D:\xxx remap 到當前 DRIVE\xxx（向後相容 v0.1.0 寫死路徑的資料）
function remapPath(target) {
  if (DRIVE !== 'D:' && /^D:\\/.test(target)) {
    return DRIVE + target.slice(2);
  }
  return target;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // 防爆：5MB 上限（sync 全 DB 通常 1-2MB）
      if (buf.length > 5 * 1024 * 1024) {
        reject(new Error('payload too large (>5MB)'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'aligner-folder-helper' }));
    return;
  }

  if (url.pathname === '/role') {
    const role = readRole();
    const cfg = readPathsConfig();
    const dataRoot = cfg.dataRoot;
    const scanFolder = path.join(dataRoot, '病患資料夾');
    const scanFolderExists = fs.existsSync(scanFolder);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      role,
      drive: DRIVE,
      dataRoot,
      scanFolder,
      scanFolderExists,
      syncFile: cfg.syncFile,
    }));
    return;
  }

  // 讀路徑設定
  if (url.pathname === '/paths' && req.method === 'GET') {
    const cfg = readPathsConfig();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ...cfg,
      pathsFile: PATHS_FILE,
      pathsFileExists: fs.existsSync(PATHS_FILE),
    }));
    return;
  }

  // 寫路徑設定（master only）
  if (url.pathname === '/paths' && req.method === 'POST') {
    if (readRole() !== 'master') {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'follower 不能改路徑設定' }));
      return;
    }
    (async () => {
      try {
        const body = await readJsonBody(req);
        const parsed = JSON.parse(body);
        const written = writePathsConfig(parsed);
        console.log(`[folder-helper] paths updated: dataRoot=${written.dataRoot}, syncFile=${written.syncFile || '(none)'}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, paths: written, hint: '重啟 helper 後完整生效' }));
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ─── 跨機同步：sync-stat / sync-read / sync-write ──────
  // 設計：syncFile 是個 JSON 檔（同 backup 格式），App 透過這 3 個 endpoint 讀寫
  // mtime 比對由 App 端做（fetch /sync-stat 比 localStorage lastSyncedAt）

  if (url.pathname === '/sync-stat') {
    const cfg = readPathsConfig();
    if (!cfg.syncFile) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '尚未設定 syncFile（請去設定 → 路徑設定）', configured: false }));
      return;
    }
    if (!fs.existsSync(cfg.syncFile)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'syncFile 不存在', syncFile: cfg.syncFile, configured: true, exists: false }));
      return;
    }
    try {
      const stat = fs.statSync(cfg.syncFile);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        configured: true,
        exists: true,
        syncFile: cfg.syncFile,
        mtime: stat.mtime.toISOString(),
        size: stat.size,
      }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname === '/sync-read') {
    const cfg = readPathsConfig();
    if (!cfg.syncFile) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '尚未設定 syncFile' }));
      return;
    }
    if (!fs.existsSync(cfg.syncFile)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'syncFile 不存在', syncFile: cfg.syncFile }));
      return;
    }
    try {
      const content = fs.readFileSync(cfg.syncFile, 'utf8');
      const stat = fs.statSync(cfg.syncFile);
      res.setHeader('Content-Type', 'application/json');
      // 直接回 raw content（前端再 JSON.parse）+ metadata header
      res.setHeader('X-Sync-Mtime', stat.mtime.toISOString());
      res.setHeader('X-Sync-Size', String(stat.size));
      res.end(content);
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname === '/sync-write' && req.method === 'POST') {
    // sync-write 兩台機都要能寫（不限 master only）— 因為兩台都會編輯
    const cfg = readPathsConfig();
    if (!cfg.syncFile) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '尚未設定 syncFile' }));
      return;
    }
    (async () => {
      try {
        const body = await readJsonBody(req);
        // 驗證是合法 JSON（不解析內容、只確認結構）
        try {
          JSON.parse(body);
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'body 不是合法 JSON' }));
          return;
        }
        // 確保目錄存在
        const dir = path.dirname(cfg.syncFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        // 原子寫：先寫 .tmp、再 rename（避免半寫的 sync.json 被另一台讀到）
        const tmpFile = cfg.syncFile + '.tmp';
        fs.writeFileSync(tmpFile, body, 'utf8');
        fs.renameSync(tmpFile, cfg.syncFile);
        const stat = fs.statSync(cfg.syncFile);
        console.log(`[folder-helper] sync-write: ${cfg.syncFile} (${stat.size} bytes)`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          ok: true,
          syncFile: cfg.syncFile,
          mtime: stat.mtime.toISOString(),
          size: stat.size,
        }));
      } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // 掃 Excel 下單記錄、跑 python takeover script 出 JSON
  if (url.pathname === '/scan-excel') {
    const cfg = readPathsConfig();
    const excelFolder = path.join(cfg.dataRoot, '下單Excel');
    if (!fs.existsSync(excelFolder)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Excel 資料夾不存在：${excelFolder}（請先建立並放入 .xlsx）` }));
      return;
    }
    const env = { ...process.env, ALIGNER_EXCEL_FOLDER: excelFolder, PYTHONIOENCODING: 'utf-8' };
    const log = [];
    const runPython = (script, args) =>
      new Promise((resolve) => {
        const fullArgs = [path.join(PROJECT_ROOT, 'scripts', script), ...(args ?? [])];
        const p = spawn('python', fullArgs, {
          cwd: PROJECT_ROOT,
          env,
        });
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => (out += d.toString()));
        p.stderr.on('data', (d) => (err += d.toString()));
        p.on('close', (code) => {
          log.push({ script, exitCode: code, stdout: out.slice(-3000), stderr: err.slice(-1000) });
          resolve(code);
        });
        p.on('error', (e) => {
          log.push({ script, exitCode: -1, error: e.message });
          resolve(-1);
        });
      });

    (async () => {
      // 用新版 takeover script（讀單檔兩 sheet）取代舊兩支
      const code = await runPython('import-clinic-takeover.py', []);
      const success = code === 0;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success, excelFolder, log }));
    })();
    return;
  }

  if (url.pathname === '/rescan-folders') {
    // 注：scan 不再限制 master only — 開發機跟筆電都可掃自己的資料夾
    // 跑 scan script (用當前 node)，產生最新 patients-import.json，回傳給前端
    // 把 dataRoot 透過 env 傳給 scan script
    const cfg = readPathsConfig();
    const env = { ...process.env, ALIGNER_DATA_ROOT: cfg.dataRoot };
    const child = spawn(process.execPath, [SCAN_SCRIPT], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code !== 0) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: stderr || `scan exited ${code}`, stdout }));
        return;
      }
      try {
        const json = fs.readFileSync(PATIENTS_JSON, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.end(json);
      } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    child.on('error', (err) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // 檢查 GitHub 有沒有新 commit（git fetch + 看 origin/main 比 HEAD 多幾個）
  if (url.pathname === '/check-update') {
    if (readRole() !== 'master') {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'follower 不能檢查更新' }));
      return;
    }
    const fetchProc = spawn('git', ['fetch', 'origin'], { cwd: PROJECT_ROOT });
    fetchProc.on('close', (code) => {
      if (code !== 0) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'git fetch 失敗 (沒網路 or git 沒裝?)' }));
        return;
      }
      // 比較
      const proc = spawn('git', ['rev-list', '--count', 'HEAD..origin/main'], { cwd: PROJECT_ROOT });
      let out = '';
      proc.stdout.on('data', (d) => (out += d.toString()));
      proc.on('close', () => {
        const behind = parseInt(out.trim(), 10) || 0;
        // 取現在 HEAD + origin/main 的 short hash
        const headProc = spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: PROJECT_ROOT });
        let headHash = '';
        headProc.stdout.on('data', (d) => (headHash += d.toString()));
        headProc.on('close', () => {
          const remoteProc = spawn('git', ['rev-parse', '--short', 'origin/main'], { cwd: PROJECT_ROOT });
          let remoteHash = '';
          remoteProc.stdout.on('data', (d) => (remoteHash += d.toString()));
          remoteProc.on('close', () => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ behind, current: headHash.trim(), latest: remoteHash.trim() }));
          });
        });
      });
    });
    fetchProc.on('error', (err) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'spawn git failed: ' + err.message }));
    });
    return;
  }

  // 列所有 git tag + 當前 HEAD + origin/main hash（給 App dropdown 用）
  if (url.pathname === '/list-tags') {
    if (readRole() !== 'master') {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'follower 不能查 tag（沒 git fetch 過）' }));
      return;
    }
    // 先 fetch tag 確保最新
    const fetchProc = spawn('git', ['fetch', '--tags', 'origin'], { cwd: PROJECT_ROOT });
    fetchProc.on('close', (fetchCode) => {
      if (fetchCode !== 0) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'git fetch --tags 失敗（沒網路 or git 沒裝?)' }));
        return;
      }
      // 列 tag（v 開頭、按 semver desc）
      const tagProc = spawn('git', ['tag', '--list', 'v*', '--sort=-version:refname'], { cwd: PROJECT_ROOT });
      let tagOut = '';
      tagProc.stdout.on('data', (d) => (tagOut += d.toString()));
      tagProc.on('close', () => {
        const tags = tagOut
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        // 抓 HEAD short hash
        const headProc = spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: PROJECT_ROOT });
        let headHash = '';
        headProc.stdout.on('data', (d) => (headHash += d.toString()));
        headProc.on('close', () => {
          // 抓 origin/main short hash
          const remoteProc = spawn('git', ['rev-parse', '--short', 'origin/main'], { cwd: PROJECT_ROOT });
          let remoteHash = '';
          remoteProc.stdout.on('data', (d) => (remoteHash += d.toString()));
          remoteProc.on('close', () => {
            // 看當前 HEAD 是哪個 tag（如果有對應）
            const tagAtHeadProc = spawn('git', ['tag', '--points-at', 'HEAD'], { cwd: PROJECT_ROOT });
            let tagAtHeadOut = '';
            tagAtHeadProc.stdout.on('data', (d) => (tagAtHeadOut += d.toString()));
            tagAtHeadProc.on('close', () => {
              const currentTag = tagAtHeadOut.split('\n').map((s) => s.trim()).find(Boolean) || null;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  tags,
                  currentHash: headHash.trim(),
                  currentTag,
                  latestMain: remoteHash.trim(),
                }),
              );
            });
          });
        });
      });
    });
    return;
  }

  // 寫 backup 到 dataRoot/app-backups/（給「切版本前自動 export backup」用）
  if (url.pathname === '/write-backup' && req.method === 'POST') {
    if (readRole() !== 'master') {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'follower 不能寫 backup' }));
      return;
    }
    const name = url.searchParams.get('name');
    if (!name || !/^[A-Za-z0-9._-]+\.json$/.test(name)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'name 必填且只能英數._-、結尾 .json' }));
      return;
    }
    const cfg = readPathsConfig();
    const backupDir = path.join(cfg.dataRoot, 'app-backups');
    const target = path.join(backupDir, name);
    (async () => {
      try {
        const body = await readJsonBody(req);
        // 驗證 JSON
        try {
          JSON.parse(body);
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'body 不是合法 JSON' }));
          return;
        }
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }
        fs.writeFileSync(target, body, 'utf8');
        const stat = fs.statSync(target);
        console.log(`[folder-helper] write-backup: ${target} (${stat.size} bytes)`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, path: target, size: stat.size }));
      } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // 跑 update.ps1 -Silent，等完成回傳結果
  // 可選 query: ?ref=<tag>，傳給 update.ps1 -Ref；沒帶 = 升 latest
  if (url.pathname === '/run-update') {
    if (readRole() !== 'master') {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'follower 不能跑更新' }));
      return;
    }
    const ref = url.searchParams.get('ref') || '';
    // 嚴格驗 ref 格式：只允許 [A-Za-z0-9._/-]，避免 shell injection
    if (ref && !/^[A-Za-z0-9._/-]+$/.test(ref)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'ref 格式不合（只允許英數._/-）' }));
      return;
    }
    const updateScript = path.join(PROJECT_ROOT, 'scripts', 'update.ps1');
    const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updateScript, '-Silent'];
    if (ref) {
      psArgs.push('-Ref', ref);
    }
    const ps = spawn('powershell', psArgs, { cwd: PROJECT_ROOT });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => (stdout += d.toString()));
    ps.stderr.on('data', (d) => (stderr += d.toString()));
    ps.on('close', (code) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: code === 0,
          exitCode: code,
          stdout: stdout.slice(-4000), // 截最後 4KB 防瀏覽器爆炸
          stderr: stderr.slice(-2000),
        }),
      );
    });
    ps.on('error', (err) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'spawn powershell failed: ' + err.message }));
    });
    return;
  }

  // 列指定資料夾底下所有圖片檔（給病患照片 slot 選擇器用）
  // query: folder=<path>, types=jpg,png,jpeg,heic (預設這四個)
  if (url.pathname === '/list-folder-files') {
    const target = url.searchParams.get('folder');
    if (!target) {
      res.statusCode = 400;
      res.end('missing folder');
      return;
    }
    const typesParam = url.searchParams.get('types') || 'jpg,jpeg,png,heic';
    const types = typesParam.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    const remapped = remapPath(target);
    const allowed = getAllowedRoots();
    if (!allowed.some((root) => remapped.startsWith(root))) {
      res.statusCode = 403;
      res.end(`not in allowlist (allowed: ${allowed.join(', ')})`);
      return;
    }
    if (!fs.existsSync(remapped)) {
      res.statusCode = 404;
      res.end(`folder not found: ${remapped}`);
      return;
    }
    try {
      const entries = fs.readdirSync(remapped, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((n) => {
          const ext = path.extname(n).slice(1).toLowerCase();
          return types.includes(ext);
        })
        .sort();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ folder: remapped, count: files.length, names: files }));
    } catch (e) {
      res.statusCode = 500;
      res.end(`readdir failed: ${e.message}`);
    }
    return;
  }

  // 檢查 Anthropic API key 是否設定（給 App 決定要不要顯示「🤖 一鍵填入」按鈕）
  if (url.pathname === '/anthropic-key-status') {
    const key = readAnthropicKey();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      configured: !!key,
      file: ANTHROPIC_KEY_FILE,
    }));
    return;
  }

  // AI 一鍵填入：把病患資料夾內所有照片丟 Claude vision、自動配對到 12 個 slot
  // query: folder=<absolute-path>
  // 回 { images: [...filenames], mappings: [{ filename, slot, confidence, reason }], usage: { input_tokens, output_tokens } }
  if (url.pathname === '/classify-photos') {
    const folder = url.searchParams.get('folder');
    if (!folder) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'missing folder query' }));
      return;
    }
    const apiKey = readAnthropicKey();
    if (!apiKey) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: '尚未設定 Anthropic API key',
          hint: `請在 ${ANTHROPIC_KEY_FILE} 寫入 sk-ant-... 的 key (純文字、一行)`,
        }),
      );
      return;
    }

    const remapped = remapPath(folder);
    const allowed = getAllowedRoots();
    if (!allowed.some((root) => remapped.startsWith(root))) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `folder not in allowlist (allowed: ${allowed.join(', ')})` }));
      return;
    }
    if (!fs.existsSync(remapped)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `folder not found: ${remapped}` }));
      return;
    }

    (async () => {
      try {
        // 1. 列出所有圖片檔（Claude vision 不支援 HEIC、先 skip）
        const entries = fs.readdirSync(remapped, { withFileTypes: true });
        const allImages = entries
          .filter((e) => e.isFile())
          .map((e) => e.name)
          .filter((n) => /\.(jpe?g|png|webp|gif)$/i.test(n));
        const heicImages = entries
          .filter((e) => e.isFile())
          .map((e) => e.name)
          .filter((n) => /\.heic$/i.test(n));

        if (allImages.length === 0) {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              images: [],
              mappings: [],
              warnings: heicImages.length ? [`${heicImages.length} 張 HEIC 不支援、需要先轉成 JPG`] : [],
            }),
          );
          return;
        }

        // 2. Read + 用 sharp resize 到 1024px max + JPEG 質量 75% + base64
        // 原圖通常 2-5MB、resize 後 ~50-200KB、避免超過 Anthropic 32MB request limit
        // 也順便支援 PNG / WEBP 統一轉 JPEG（Claude vision 都吃）
        const MAX_IMAGES = 20;
        const batchImages = allImages.slice(0, MAX_IMAGES);
        const content = [];
        for (let i = 0; i < batchImages.length; i++) {
          const filename = batchImages[i];
          try {
            const resized = await sharp(path.join(remapped, filename))
              .resize({
                width: 1024,
                height: 1024,
                fit: 'inside',
                withoutEnlargement: true,
              })
              .jpeg({ quality: 75 })
              .toBuffer();
            content.push({ type: 'text', text: `Photo #${i + 1}: ${filename}` });
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: resized.toString('base64'),
              },
            });
          } catch (e) {
            console.warn(`[classify-photos] skip ${filename}: ${e.message}`);
          }
        }
        console.log(
          `[classify-photos] prepared ${(content.length - batchImages.length) / 1} images for Claude (after resize)`,
        );

        // 3. Prompt：詳細列 14 個 slot 定義、要 Claude 返回 raw JSON array
        const systemPrompt = `You are analyzing dental orthodontic patient photos to classify each into one of 14 standard slots.

Reply with **ONLY a valid JSON array** (no markdown fences, no explanation outside JSON), one entry per input photo, in the SAME order as provided.

Each entry MUST be:
{
  "filename": "<exact filename from input>",
  "slot": "<one of slot keys below, or 'unknown'>",
  "confidence": <0.0-1.0>,
  "reason": "<short Chinese or English reason>"
}

Slot keys:
- portraitFrontalRest: 人像正面休息（face frontal, mouth neutral/closed, no smile, head at 0°）
- portraitFrontalSmile: 人像正面微笑（face frontal, smiling showing teeth, head at 0°）
- portraitOblique45Rest: 人像 45° 斜位休息（half-profile angle, no smile）
- portraitOblique45Smile: 人像 45° 斜位微笑（half-profile angle, smiling）
- portraitProfileRest: 人像 90° 側面休息（full side profile, no smile）
- portraitProfileSmile: 人像 90° 側面微笑（full side profile, smiling）
- pano: X-ray panoramic（黑白全口環口 X 光、寬幅、顯示所有牙齒）
- ceph: X-ray cephalometric（側顱 X 光、側面骨架）
- frontClosed: intraoral front view, 上下牙咬合（牙齒閉合的口內正面照）
- frontOpen: intraoral front view, 口張開（露出舌頭/牙齦的口內正面照）
- leftClosed: intraoral left side view, 牙齒閉合（左側口內咬合照、看到左邊側牙）
- rightClosed: intraoral right side view, 牙齒閉合（右側口內咬合照、看到右邊側牙）
- upperOcclusal: 上顎咬合面（mirror 反射拍上顎、看到所有上排牙齒從上往下視角）
- lowerOcclusal: 下顎咬合面（mirror 反射拍下顎、看到所有下排牙齒從下往上視角）

Rules:
- Each slot should be assigned to at most ONE photo. If multiple photos seem to fit the same slot, only assign it to the BEST fit; the rest become "unknown".
- If a photo clearly does not match any slot (e.g. a document scan, an unrelated image), use "unknown".
- Be conservative: prefer "unknown" with low confidence over wrong slot.`;

        const userText = `Analyze these ${batchImages.length} photos and classify each.`;
        const messages = [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }, ...content],
          },
        ];

        // 4. Anthropic API call
        // 用 alias model name（無 date suffix）— Anthropic 自動 redirect 到最新版
        const apiBody = {
          model: 'claude-haiku-4-5',
          max_tokens: 4000,
          system: systemPrompt,
          messages,
        };

        console.log(`[classify-photos] folder=${remapped}, images=${batchImages.length}`);
        const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(apiBody),
        });

        if (!apiResp.ok) {
          const errText = await apiResp.text();
          console.error('[classify-photos] API error', apiResp.status, errText);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: `Anthropic API ${apiResp.status}`,
              detail: errText.slice(0, 500),
            }),
          );
          return;
        }

        const apiData = await apiResp.json();
        const replyText = apiData.content?.[0]?.text ?? '';

        // 5. Parse JSON from reply（strip markdown fence 容錯）
        let mappings;
        try {
          const cleaned = replyText
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
          mappings = JSON.parse(cleaned);
          if (!Array.isArray(mappings)) {
            throw new Error('Expected JSON array');
          }
        } catch (e) {
          console.error('[classify-photos] parse error', e, 'reply:', replyText.slice(0, 500));
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: 'Claude 回應不是合法 JSON',
              raw: replyText.slice(0, 1000),
            }),
          );
          return;
        }

        const warnings = [];
        if (heicImages.length) {
          warnings.push(`${heicImages.length} 張 HEIC 不支援（Claude vision 限制）、需先轉 JPG`);
        }
        if (allImages.length > MAX_IMAGES) {
          warnings.push(`只分析前 ${MAX_IMAGES} 張、其餘 ${allImages.length - MAX_IMAGES} 張要分批跑（之後做）`);
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            images: batchImages,
            mappings,
            usage: apiData.usage,
            model: apiData.model,
            warnings,
          }),
        );
      } catch (e) {
        console.error('[classify-photos] exception', e);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // 串圖片 binary（用 <img src="http://localhost:8765/serve-image?path=..."> 引用）
  if (url.pathname === '/serve-image') {
    const target = url.searchParams.get('path');
    if (!target) {
      res.statusCode = 400;
      res.end('missing path');
      return;
    }
    const remapped = remapPath(target);
    const allowed = getAllowedRoots();
    if (!allowed.some((root) => remapped.startsWith(root))) {
      res.statusCode = 403;
      res.end(`not in allowlist`);
      return;
    }
    if (!fs.existsSync(remapped)) {
      res.statusCode = 404;
      res.end(`not found: ${remapped}`);
      return;
    }
    const ext = path.extname(remapped).slice(1).toLowerCase();
    const mime = (
      {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        heic: 'image/heic',
        heif: 'image/heif',
        bmp: 'image/bmp',
        tiff: 'image/tiff',
      }[ext]
    ) || 'application/octet-stream';
    try {
      const stat = fs.statSync(remapped);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 分鐘 cache（圖換了會過期）
      const stream = fs.createReadStream(remapped);
      stream.pipe(res);
      stream.on('error', (e) => {
        console.error('[folder-helper] serve-image stream error:', e);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
    } catch (e) {
      res.statusCode = 500;
      res.end(`stat/stream failed: ${e.message}`);
    }
    return;
  }

  // 列出指定資料夾底下所有 subfolder 名（給 App 端做 name match 用）
  if (url.pathname === '/list-folder-names') {
    const target = url.searchParams.get('folder');
    if (!target) {
      res.statusCode = 400;
      res.end('missing folder');
      return;
    }
    const remapped = remapPath(target);
    const allowed = getAllowedRoots();
    if (!allowed.some((root) => remapped.startsWith(root))) {
      res.statusCode = 403;
      res.end(`not in allowlist (allowed roots: ${allowed.join(', ')})`);
      return;
    }
    if (!fs.existsSync(remapped)) {
      res.statusCode = 404;
      res.end(`folder not found: ${remapped}`);
      return;
    }
    try {
      const entries = fs.readdirSync(remapped, { withFileTypes: true });
      const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ folder: remapped, count: folders.length, names: folders }));
    } catch (e) {
      res.statusCode = 500;
      res.end(`readdir failed: ${e.message}`);
    }
    return;
  }

  // v0.3.19: 批次檢查多個路徑是否實際存在（給 sourceFolder 健檢用）
  //   POST body: { paths: string[] }
  //   回 { results: { [path]: boolean } }
  //   走 path remap (W:\0矯正追蹤\... → /data/... 之類)、但不過 allowlist
  //   （健檢的目的就是要看歷史路徑是否存在、不該被 allowlist 擋掉）
  if (url.pathname === '/check-paths' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readJsonBody(req);
        const parsed = JSON.parse(body);
        const paths = Array.isArray(parsed?.paths) ? parsed.paths : [];
        const results = {};
        for (const p of paths) {
          if (!p || typeof p !== 'string') {
            results[p] = false;
            continue;
          }
          try {
            const remapped = remapPath(p);
            results[p] = fs.existsSync(remapped);
          } catch {
            results[p] = false;
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, results, checked: paths.length }));
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // 建立資料夾（含 path remap + allowlist 守門）
  if (url.pathname === '/create-folder') {
    if (readRole() !== 'master') {
      res.statusCode = 403;
      res.end('follower 不能建立資料夾，請在 master (筆電) 操作');
      return;
    }
    const target = url.searchParams.get('path');
    if (!target) {
      res.statusCode = 400;
      res.end('missing path');
      return;
    }
    const remapped = remapPath(target);
    const allowed = getAllowedRoots();
    if (!allowed.some((root) => remapped.startsWith(root))) {
      res.statusCode = 403;
      res.end(`path not in allowlist (allowed: ${allowed.join(', ')})`);
      return;
    }
    if (fs.existsSync(remapped)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ created: false, alreadyExisted: true, path: remapped }));
      return;
    }
    try {
      fs.mkdirSync(remapped, { recursive: true });
      console.log(`[folder-helper] created folder: ${remapped}`);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ created: true, path: remapped }));
    } catch (e) {
      res.statusCode = 500;
      res.end(`mkdir failed: ${e.message}`);
    }
    return;
  }

  // 在指定資料夾找符合 pattern 的 PDF 並用系統預設程式開（用途：指示單、轉介單等）
  if (url.pathname === '/find-and-open') {
    const folder = url.searchParams.get('folder');
    const pattern = url.searchParams.get('pattern') || '';
    if (!folder || !pattern) {
      res.statusCode = 400;
      res.end('missing folder or pattern');
      return;
    }
    const remapped = remapPath(folder);
    const allowed = getAllowedRoots();
    if (!allowed.some((root) => remapped.startsWith(root))) {
      res.statusCode = 403;
      res.end(`folder not in allowlist`);
      return;
    }
    if (!fs.existsSync(remapped)) {
      res.statusCode = 404;
      res.end(`folder not found: ${remapped}`);
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(remapped, { withFileTypes: true });
    } catch (e) {
      res.statusCode = 500;
      res.end(`readdir failed: ${e.message}`);
      return;
    }
    const match = entries.find(
      (f) => f.isFile() && f.name.toLowerCase().endsWith('.pdf') && f.name.includes(pattern),
    );
    if (!match) {
      res.statusCode = 404;
      res.end(`no PDF matching "${pattern}" in folder`);
      return;
    }
    const filePath = path.join(remapped, match.name);
    const safe = filePath.replace(/["`]/g, '');
    const child = spawn('cmd.exe', ['/c', 'start', '""', safe], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => console.error('[folder-helper] spawn error:', err));
    child.unref();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ opened: filePath }));
    return;
  }

  if (url.pathname === '/open-folder' || url.pathname === '/open-file') {
    const target = url.searchParams.get('path');
    if (!target) {
      res.statusCode = 400;
      res.end('missing path');
      return;
    }
    // 跨機部署 path remap：v0.1.0 之前的資料寫死 D:\，本機若沒 D 槽（部署在 C 槽機器）
    // 自動把開頭碟符 D: 改寫為當前 DRIVE，避免要回去修 IndexedDB 內 800+ 寫死路徑
    const remapped = remapPath(target);
    if (remapped !== target) {
      console.log(`[folder-helper] path remap: ${target} → ${remapped}`);
    }
    const allowed = getAllowedRoots();
    if (!allowed.some((root) => remapped.startsWith(root))) {
      res.statusCode = 403;
      res.end(`path not in allowlist (allowed: ${allowed.join(', ')})`);
      return;
    }
    if (!fs.existsSync(remapped)) {
      res.statusCode = 404;
      res.end(`not found: ${remapped}`);
      return;
    }
    const safe = remapped.replace(/["`]/g, '');
    // open-folder → explorer.exe；open-file → 用系統預設程式 (start "")
    if (url.pathname === '/open-folder') {
      const child = spawn('explorer.exe', [safe], { detached: true, stdio: 'ignore' });
      child.on('error', (err) => console.error('[folder-helper] spawn error:', err));
      child.unref();
    } else {
      // 用 cmd 的 start 命令以系統預設程式開檔（PDF → Acrobat / Edge / 等）
      const child = spawn('cmd.exe', ['/c', 'start', '""', safe], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', (err) => console.error('[folder-helper] spawn error:', err));
      child.unref();
    }
    res.statusCode = 200;
    res.end('opened');
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const cfg = readPathsConfig();
  const allowed = getAllowedRoots();
  console.log(`[folder-helper] listening on http://127.0.0.1:${PORT}`);
  console.log(`[folder-helper] role: ${readRole()} (drive: ${DRIVE})`);
  console.log(`[folder-helper] dataRoot: ${cfg.dataRoot}`);
  console.log(`[folder-helper] syncFile: ${cfg.syncFile || '(not configured)'}`);
  console.log(`[folder-helper] allowlist: ${allowed.join(', ')}`);
});
