#!/usr/bin/env node
// 安裝 git hooks 到 .git/hooks/
//
// hooks 不被 git track、新 clone / 換機要重跑：
//   npm run install-hooks

import { copyFileSync, chmodSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const hooksSrc = join(repoRoot, 'scripts', 'hooks');

// Resolve git directory (handles submodules / worktrees)
const gitDir = spawnSync('git', ['rev-parse', '--git-dir'], {
  encoding: 'utf8',
  cwd: repoRoot,
  shell: false,
});
if (gitDir.status !== 0) {
  console.error('❌ Not a git repository (or git not in PATH)');
  process.exit(1);
}
const hooksDest = join(repoRoot, gitDir.stdout.trim(), 'hooks');
if (!existsSync(hooksDest)) mkdirSync(hooksDest, { recursive: true });

let count = 0;
for (const f of readdirSync(hooksSrc)) {
  const src = join(hooksSrc, f);
  const dest = join(hooksDest, f);
  copyFileSync(src, dest);
  try {
    chmodSync(dest, 0o755); // Unix exec bit (Windows ignores)
  } catch {}
  console.log(`  ✓ ${f} → ${dest}`);
  count++;
}

console.log('');
console.log(`✓ 安裝 ${count} 個 hook 到 ${hooksDest}`);
console.log('');
console.log('目前 hooks:');
console.log('  - post-commit: package.json version 變動時自動背景跑 npm run build-viewer');
