
const GAME_ORIGIN = 'https://ashbound-deck-hunt.takeshita0205ayumu.chatgpt.site';
const GAME_ASSET_PREFIX = '/game-assets/';
const SNAPSHOT_ASSET_PREFIX = '/game-snapshot/';
const PLAY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const GAME_SCRIPTS = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi;
const STYLE_LINKS = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/gi;

function gameAssetPath(url, extension, prefix) {
  const [name] = url.split('?');
  if (!/^[\w.-]+$/.test(name) || !name.endsWith(extension)) {
    throw Error('未対応の本編アセット: ' + name);
  }
  return prefix + url;
}

function previewHtml(html, prefix=GAME_ASSET_PREFIX) {
  const scripts = [...html.matchAll(GAME_SCRIPTS)];
  if (!scripts.length || scripts.length !== [...html.matchAll(/<script\b/gi)].length ||
      !/<\/body>/i.test(html)) {
    throw Error('本編の読み込み構成が変更されました。');
  }
  let hasRuntime = false;
  const preview = html.replace(GAME_SCRIPTS, (tag, url) => {
    const path = gameAssetPath(url, '.js', prefix);
    const [name] = url.split('?');
    if (name === 'balance-live.js') return '';
    if (name === 'balance-settings.js') return '<script src="/balance-settings.js"></script>';
    if (name === 'balance-runtime.js') hasRuntime = true;
    return tag.replace('src="' + url + '"', 'src="' + path + '"');
  }).replace(STYLE_LINKS, (tag, url) =>
    tag.replace('href="' + url + '"', 'href="' + gameAssetPath(url, '.css', prefix) + '"')
  );
  if (!hasRuntime) throw Error('本編のバランス調整機能が見つかりません。');
  const marked = prefix === SNAPSHOT_ASSET_PREFIX
    ? preview.replace(/<html\b/i, '<html data-balance-snapshot="true"')
    : preview;
  return marked.replace(/<script\b/i, '<script src="/balance-preview.js"></script>$&');
}

async function fetchGame(path, method) {
  const response = await fetch(GAME_ORIGIN + path, {
    method,
    redirect: 'manual',
    headers: {'Cache-Control': 'no-cache'},
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error('本編の取得に失敗しました（HTTP ' + response.status + '）。');
  return response;
}

async function servePreview(req, url) {
  try {
    if (url.pathname.startsWith(SNAPSHOT_ASSET_PREFIX)) {
      const name=url.pathname.slice(SNAPSHOT_ASSET_PREFIX.length);
      if (!/^[\w.-]+\.(?:js|css)$/.test(name) || !Object.hasOwn(GAME_FALLBACK,name)) return new Response(null,{status:404});
      const type=name.endsWith('.css')?'text/css':'application/javascript';
      return new Response(req.method==='HEAD'?null:GAME_FALLBACK[name],{
        headers:{...PLAY_HEADERS,'Content-Type':type+'; charset=utf-8'},
      });
    }
    if (url.pathname === '/play.html') {
      const upstream = await fetchGame('/', 'GET');
      if (!upstream.headers.get('Content-Type')?.includes('text/html')) throw Error('本編のHTMLが取得できません。');
      const html = previewHtml(await upstream.text());
      return new Response(req.method === 'HEAD' ? null : html, {
        headers: {...PLAY_HEADERS, 'Content-Type': 'text/html; charset=utf-8'},
      });
    }
    const name = url.pathname.slice(GAME_ASSET_PREFIX.length);
    if (!/^[\w.-]+\.(?:js|css)$/.test(name)) return new Response(null, {status: 404});
    const mime = name.endsWith('.css') ? 'text/css' : 'application/javascript';
    const upstream = await fetchGame('/' + name + url.search, req.method);
    const type = upstream.headers.get('Content-Type') ?? '';
    if (!(mime === 'text/css' ? type.startsWith('text/css') : /^(?:application|text)\/(?:x-)?javascript\b/i.test(type))) {
      throw Error('本編アセットの形式が一致しません。');
    }
    return new Response(upstream.body, {
      headers: {...PLAY_HEADERS, 'Content-Type': mime + '; charset=utf-8'},
    });
  } catch (error) {
    console.warn('本編アセット取得失敗',url.pathname,String(error.message));
    if (url.pathname === '/play.html' && GAME_FALLBACK['index.html']) {
      return new Response(req.method === 'HEAD' ? null : previewHtml(GAME_FALLBACK['index.html'],SNAPSHOT_ASSET_PREFIX),{
        headers:{...PLAY_HEADERS,'Content-Type':'text/html; charset=utf-8'},
      });
    }
    return new Response(req.method === 'HEAD' ? null : '公開中の本編データを取得できませんでした。', {
      status: 502, headers: {...PLAY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8'},
    });
  }
}

const json = (body,status) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

export default {async fetch(req,env) {
  const url = new URL(req.url);
  if (url.pathname === '/api/publish-balance') {
    if (!req.headers.get('oai-authenticated-user-id') || !env.BALANCE_PUBLISH_KEY) return json({error:'forbidden'},403);
    if (req.method !== 'GET' && req.method !== 'PUT') return json({error:'method'},405);
    if (req.method === 'PUT' && (req.headers.get('origin') !== url.origin ||
        !req.headers.get('content-type')?.startsWith('application/json'))) return json({error:'origin'},403);
    try {
      let body = '';
      if (req.method === 'PUT') {
        if (Number(req.headers.get('content-length')) > 64000) return json({error:'size'},413);
        body = await req.text();
        if (body.length > 64000) return json({error:'size'},413);
      }
      const expires = String(Date.now() + 60000);
      const bytes = new TextEncoder();
      const key = await crypto.subtle.importKey('raw',bytes.encode(env.BALANCE_PUBLISH_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const signed = await crypto.subtle.sign('HMAC',key,bytes.encode(req.method+'\n'+expires+'\n'+body));
      const signature = Array.from(new Uint8Array(signed),x=>x.toString(16).padStart(2,'0')).join('');
      return json({proof:expires+'.'+signature},200);
    } catch {
      return json({error:'unavailable'},503);
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null,{status:405});
  if (url.pathname === '/play.html' || url.pathname.startsWith(GAME_ASSET_PREFIX) || url.pathname.startsWith(SNAPSHOT_ASSET_PREFIX)) {
    return servePreview(req, url);
  }
  const file = ASSETS[url.pathname === '/' ? 'index.html' : url.pathname.slice(1)];
  if (!Array.isArray(file)) return new Response('Not found',{status:404});
  return new Response(req.method==='HEAD'?null:file[1],{headers:{
    'Content-Type':file[0],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
  }});
}};
