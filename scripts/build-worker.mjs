import fs from 'node:fs';
const assets={};
const editor = ['index.html','balance-editor.css','balance-editor.js','balance-preview.js','balance-settings.js'];
for(const name of editor){
 const type={html:'text/html',js:'application/javascript',css:'text/css'}[name.split('.').at(-1)];
 if (!/^[\w.-]+$/.test(name) || !type) throw new Error('未対応のアセット: ' + name);
 assets[name]=[type+'; charset=utf-8',fs.readFileSync('dist/'+name,'utf8')];
}
// The deploy build supplies an exact snapshot of the public game release.
const gameDir=process.env.ASHBOUND_PUBLISHED_DIST;
const fallback={};
if(gameDir){
 const html=fs.readFileSync(gameDir+'/index.html','utf8');
 const names=new Set(['index.html',...[...html.matchAll(/(?:src|href)="([\w.-]+\.(?:js|css))(?:\?[^"]*)?"/gi)].map(match=>match[1])]);
 for(const name of names)fallback[name]=fs.readFileSync(gameDir+'/'+name,'utf8');
}
fs.mkdirSync('dist/server',{recursive:true});
fs.writeFileSync('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\nconst GAME_FALLBACK='+JSON.stringify(fallback)+';\n'+fs.readFileSync('worker/index.mjs','utf8'));
