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
  const file = ASSETS[url.pathname === '/' ? 'index.html' : url.pathname.slice(1)];
  if (!Array.isArray(file)) return new Response('Not found',{status:404});
  return new Response(req.method==='HEAD'?null:file[1],{headers:{
    'Content-Type':file[0],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
  }});
}};
