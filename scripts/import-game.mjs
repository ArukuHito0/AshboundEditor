import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';

const [checkout, revision, extra] = process.argv.slice(2);
if (!checkout || !/^[a-f0-9]{40}$/i.test(revision ?? '') || extra) {
  throw Error('使い方: node scripts/import-game.mjs <本編のチェックアウト> <40桁のコミットSHA>');
}

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const git = (...args) => execFileSync('git', ['-C', resolve(checkout), ...args], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
const commit = git('rev-parse', '--verify', revision + '^{commit}').trim();
const readAsset = name => git('show', commit + ':dist/' + name);
const editorScripts = new Set(['balance-preview.js', 'balance-settings.js', 'balance-runtime.js']);
const editorAssets = new Set([...editorScripts, 'balance-editor.js', 'balance-editor.css', 'index.html', 'play.html']);
const assets = new Map();
function importAsset(name, extension) {
  if (!/^[\w.-]+$/.test(name) || !name.endsWith(extension) || editorAssets.has(name)) {
    throw Error('未対応の本編アセット: ' + name);
  }
  if (!assets.has(name)) {
    const content = readAsset(name);
    if (extension === '.js') new Script(content, {filename: name});
    assets.set(name, content);
  }
}

const html = readAsset('index.html');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi)];
if (!scripts.length || scripts.length !== [...html.matchAll(/<script\b/gi)].length) {
  throw Error('本編のスクリプト読み込み構成を確認してください');
}
for (const match of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/gi)) {
  importAsset(match[1].split('?')[0], '.css');
}
let firstGameScript;
const preview = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi, (tag, url) => {
  const name = url.split('?')[0];
  if (editorScripts.has(name) || name === 'balance-live.js') return '';
  importAsset(name, '.js');
  if (firstGameScript) return tag;
  firstGameScript = name;
  return '<script src="balance-preview.js"></script>' + tag;
});
if (!firstGameScript || !/<\/body>/i.test(preview)) throw Error('試遊画面の挿入位置が見つかりません');
const play = preview.replace(/<\/body>/i, '<script src="balance-settings.js"></script><script src="balance-runtime.js"></script>$&');
for (const name of editorScripts) readFileSync(resolve(dist, name));
for (const [name, content] of assets) writeFileSync(resolve(dist, name), content);
writeFileSync(resolve(dist, 'play.html'), play);
writeFileSync(new URL('../game-source.json', import.meta.url), JSON.stringify({commit, assets:[...assets.keys()]}, null, 2) + '\n');
console.log('本編 ' + commit + ' から ' + assets.size + ' ファイルを取り込みました');
