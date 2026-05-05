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

const PORT = 8765;
// 自動偵測安裝碟：優先 D 槽（vrlndy 主機慣例），否則用系統碟（C: 通常）
const DRIVE = fs.existsSync('D:\\') ? 'D:' : (process.env.SystemDrive || 'C:');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCAN_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'scan-aligner-folders.mjs');
const PATIENTS_JSON = path.join(PROJECT_ROOT, 'dev-data', 'patients-import.json');
const ROLE_FILE = path.join(PROJECT_ROOT, 'dev-data', 'clinic-role.txt');
const PATHS_FILE = path.join(PROJECT_ROOT, 'dev-data', 'clinic-paths.json');

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

  // 跑 update.ps1 -Silent，等完成回傳結果
  if (url.pathname === '/run-update') {
    if (readRole() !== 'master') {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'follower 不能跑更新' }));
      return;
    }
    const updateScript = path.join(PROJECT_ROOT, 'scripts', 'update.ps1');
    const ps = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updateScript, '-Silent'],
      { cwd: PROJECT_ROOT },
    );
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
