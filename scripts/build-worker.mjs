import fs from 'node:fs';
if (!fs.existsSync('game-source.json') || !fs.existsSync('dist/play.html')) {
 throw new Error('先に scripts/import-game.mjs で本編のソースを取り込んでください。');
}
const assets={};
const source = JSON.parse(fs.readFileSync('game-source.json', 'utf8'));
const editor = ['index.html','play.html','balance-editor.css','balance-editor.js','balance-preview.js','balance-runtime.js','balance-settings.js'];
for(const name of new Set([...editor, ...source.assets])){
 const type={html:'text/html',js:'application/javascript',css:'text/css'}[name.split('.').at(-1)];
 if (!/^[\w.-]+$/.test(name) || !type) throw new Error('未対応のアセット: ' + name);
 assets[name]=[type+'; charset=utf-8',fs.readFileSync('dist/'+name,'utf8')];
}
fs.mkdirSync('dist/server',{recursive:true});
fs.writeFileSync('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\n'+fs.readFileSync('worker/index.mjs','utf8'));
