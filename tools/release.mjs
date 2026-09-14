// 发布与回滚（阶段四：迭代机制）
//
//   升版本 + 构建 + 校验（不提交）:
//     node tools/release.mjs patch        # 1.0.0 → 1.0.1
//     node tools/release.mjs minor        # 1.0.0 → 1.1.0
//     node tools/release.mjs major        # 1.0.0 → 2.0.0
//     node tools/release.mjs 1.2.3        # 直接指定
//   只构建校验、不动版本:
//     node tools/release.mjs build
//
// 回滚（见 COMPAT-AND-RELEASE.md）：产物是 git 里的普通文件，回滚就是 git revert 后重新构建推送：
//     git log --oneline --grep='阶段' | head        # 找要回滚的提交
//     git revert <sha> --no-edit && node build.mjs && cp dist/party-night.html index.html
//     git add -A && git commit --amend --no-edit && git push
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const arg = (process.argv[2] || 'build').trim();
const cur = readFileSync(join(root, 'VERSION'), 'utf8').trim();

function bump(v, kind) {
  const p = v.split('.').map(Number);
  if (kind === 'patch') return p[0] + '.' + p[1] + '.' + (p[2] + 1);
  if (kind === 'minor') return p[0] + '.' + (p[1] + 1) + '.0';
  if (kind === 'major') return (p[0] + 1) + '.0.0';
  return null;
}
const next = /^\d+\.\d+\.\d+$/.test(arg) ? arg : bump(cur, arg);
if (next) {
  writeFileSync(join(root, 'VERSION'), next + '\n');
  console.log('版本：' + cur + ' → ' + next);
} else {
  console.log('版本不变：' + cur + '（用法：patch | minor | major | x.y.z | build）');
}
execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit' });
// 先同步根目录 index.html 再校验：version-test 会断言"根 index.html 与产物逐字节一致"，
// 顺序反了的话第一次必然失败（这个坑踩过一次）。
copyFileSync(join(root, 'dist/party-night.html'), join(root, 'index.html'));
execFileSync(process.execPath, ['test/version-test.mjs'], { cwd: root, stdio: 'inherit' });
console.log('\n接下来：');
console.log('  git add -A && git commit -m "发布 v' + (next || cur) + '" && git tag v' + (next || cur) + ' && git push origin main --tags');
