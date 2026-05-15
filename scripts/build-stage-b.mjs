#!/usr/bin/env node
// 一鍵 build + export Stage B Docker image (aligner-viewer) 到 NAS sync 資料夾
//
// 流程：
//   1. 讀 package.json version
//   2. docker build -t aligner-viewer:<version>
//   3. docker save -o <NAS sync folder>\stage-b\aligner-viewer-<version>.tar
//   4. Drive Client 自動 sync 上 NAS
//   5. (手動) DSM Docker UI 載入 tar、replace container
//
// 用法：node scripts/build-stage-b.mjs  或  npm run build-viewer

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const version = pkg.version;

// NAS sync 資料夾（D 機 / 樓上筆電 / fallback、自動偵測）
const candidates = [
  'D:\\診所nas 矯正追蹤\\SynologyDrive\\stage-b',
  'W:\\0矯正追蹤\\stage-b',
  'C:\\SynologyDrive\\0矯正追蹤\\stage-b',
];

function color(c, s) {
  const codes = { cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', gray: '\x1b[90m', reset: '\x1b[0m' };
  return `${codes[c] || ''}${s}${codes.reset}`;
}

function run(cmd, args, opts = {}) {
  console.log(color('gray', `  $ ${cmd} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`));
  // shell: false 確保含空格的 args (如 NAS 路徑) 被正確 quote、不被 shell split
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) {
    console.error(color('red', `\n❌ command failed (exit ${r.status}): ${cmd}`));
    process.exit(r.status ?? 1);
  }
}

// Pick output dir
let outDir = null;
for (const p of candidates) {
  const parent = dirname(p);
  if (existsSync(parent)) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
    outDir = p;
    break;
  }
}
if (!outDir) {
  console.error(color('red', '❌ 找不到 NAS sync 資料夾。試了：'));
  for (const p of candidates) console.error('  ' + p);
  process.exit(1);
}

console.log('');
console.log(color('cyan', '╔══════════════════════════════════════════╗'));
console.log(color('cyan', '║  Stage B Image Build & Export            ║'));
console.log(color('cyan', '╚══════════════════════════════════════════╝'));
console.log(`  version: ${version}`);
console.log(`  output:  ${join(outDir, `aligner-viewer-${version}.tar`)}`);
console.log('');

// 1. Docker daemon check
const verCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
  shell: false,
});
if (verCheck.status !== 0) {
  console.error(color('red', '❌ Docker daemon 沒在跑、開 Docker Desktop 再試'));
  process.exit(1);
}
console.log(color('gray', `✓ Docker daemon ${verCheck.stdout.trim()}`));
console.log('');

// 2. Build
console.log(color('yellow', `[1/2] docker build -t aligner-viewer:${version}  (預計 5-10 分鐘、cache hit 快)...`));
run('docker', ['build', '-t', `aligner-viewer:${version}`, repoRoot]);
console.log(color('green', `  ✓ image built: aligner-viewer:${version}`));
console.log('');

// 3. Export tar
const outFile = join(outDir, `aligner-viewer-${version}.tar`);
console.log(color('yellow', `[2/2] docker save → ${outFile}...`));
run('docker', ['save', `aligner-viewer:${version}`, '-o', outFile]);
const sizeMB = (statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(color('green', `  ✓ tar 寫好 (${sizeMB} MB)`));
console.log('');

// 4. 清舊 tar（保留最近 3 個）
const tars = readdirSync(outDir)
  .filter((f) => /^aligner-viewer-.+\.tar$/.test(f))
  .map((f) => ({ f, mtime: statSync(join(outDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
if (tars.length > 3) {
  console.log(color('gray', '清舊 tar（保留最近 3 個）:'));
  for (const old of tars.slice(3)) {
    console.log(color('gray', `  rm ${old.f}`));
    unlinkSync(join(outDir, old.f));
  }
  console.log('');
}

// Summary + 下一步
console.log(color('green', '╔══════════════════════════════════════════╗'));
console.log(color('green', '║  ✓ Build & Export Done                   ║'));
console.log(color('green', '╚══════════════════════════════════════════╝'));
console.log('');
console.log(color('cyan', 'Next steps (手動):'));
console.log('  1. 等 Synology Drive Client 自動 sync tar 到 NAS (~1-2 分鐘、看 D 機 tray icon)');
console.log('  2. NAS DSM → Docker (DSM 6.x) 或 Container Manager (DSM 7.x):');
console.log('     影像 → 新增 → 從檔案新增');
console.log(`     檔位置：n歐耐恩n/0矯正追蹤/stage-b/aligner-viewer-${version}.tar`);
console.log('  3. 停舊 container "aligner-viewer" (右鍵停止 → 刪除舊 container、image 不刪、保留歷史)');
console.log('  4. 用新 image 建 container:');
console.log('     - 名稱: aligner-viewer');
console.log('     - 自動重新啟動: 啟用');
console.log('     - 連接埠: 8080 → 8080');
console.log('     - 共用資料夾: n歐耐恩n/0矯正追蹤 → /data (勾「唯讀」)');
console.log('  5. 啟動 + 確認: http://192.168.0.220:8080/api/health');
console.log(`     應該看到 {"ok": true, "version": "${version}", ...}`);
console.log('  6. iPad 內網 wifi 開 http://192.168.0.220:8080/');
console.log('');
