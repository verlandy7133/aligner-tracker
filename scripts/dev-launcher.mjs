// Dev launcher — 同時啟動 Vite + folder-helper。
// launch.json 跑這支，免得要開兩個 terminal。

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// 用當前執行 node 的絕對路徑 spawn，避免 PATH 問題
const NODE = process.execPath;

function start(name, args, color) {
  const child = spawn(NODE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  child.stdout.on('data', (d) =>
    process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')),
  );
  child.stderr.on('data', (d) =>
    process.stderr.write(d.toString().split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')),
  );
  child.on('exit', (code) => {
    console.log(`${tag} exited (code=${code})`);
  });
  return child;
}

const vite = start('vite', [path.join(root, 'node_modules/vite/bin/vite.js'), root], '36');
const helper = start('helper', [path.join(root, 'scripts/folder-helper.mjs')], '33');

const cleanup = () => {
  vite.kill();
  helper.kill();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
