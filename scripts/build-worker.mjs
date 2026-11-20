import fs from 'node:fs';
const assets={};
const editor = ['index.html','balance-editor.css','balance-editor.js','balance-preview.js','balance-settings.js'];
for(const name of editor){
 const type={html:'text/html',js:'application/javascript',css:'text/css'}[name.split('.').at(-1)];
 if (!/^[\w.-]+$/.test(name) || !type) throw new Error('未対応のアセット: ' + name);
 assets[name]=[type+'; charset=utf-8',fs.readFileSync('dist/'+name,'utf8')];
}
fs.mkdirSync('dist/server',{recursive:true});
fs.writeFileSync('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\n'+fs.readFileSync('worker/index.mjs','utf8'));
