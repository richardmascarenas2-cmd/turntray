/* Keeps a saved copy of the app on each device so it still opens on networks that block turntray.com.
   The app's data (requests, photos) comes from Google Firebase, which those networks allow, so only the
   page itself needs to come from this saved copy.
   - Pages and app files: try the network first (so updates show up), fall back to the saved copy.
   - Firebase library files from gstatic: use the saved copy, they never change for a given version. */
const CACHE = 'turntray-v2';
const SHELL = [
  './', 'index.html', 'bio.html', 'firebase-config.js',
  'manifest.webmanifest', 'bio.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png',
  'bio-icon-64.png', 'bio-icon-180.png', 'bio-icon-192.png', 'bio-icon-512.png',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'
];
const NET_TIMEOUT_MS = 4000;

self.addEventListener('install', e=>{
  e.waitUntil((async()=>{
    const c = await caches.open(CACHE);
    // Add one by one so a single failure doesn't stop the rest from being saved.
    await Promise.all(SHELL.map(u=>c.add(new Request(u, {cache:'reload'})).catch(()=>{})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys()) if(k!==CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function withTimeout(p, ms){
  return new Promise((res, rej)=>{ const t=setTimeout(()=>rej(new Error('timeout')), ms); p.then(v=>{clearTimeout(t); res(v);}, e=>{clearTimeout(t); rej(e);}); });
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firebase library files: saved copy first.
  if(url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')){
    e.respondWith((async()=>{
      const hit = await caches.match(req, {ignoreVary:true}) || await caches.match(url.href);
      if(hit) return hit;
      const res = await fetch(req);
      const c = await caches.open(CACHE); c.put(req, res.clone()).catch(()=>{});
      return res;
    })());
    return;
  }

  // Only this site's own files from here on (Firestore, sign-in, etc. go straight to the network).
  if(url.origin !== self.location.origin) return;
  if(url.pathname.startsWith('/__/')) return;

  e.respondWith((async()=>{
    const c = await caches.open(CACHE);
    // Save under the plain path (no ?query) so any link to the page finds it later.
    // Keep saving even if the network is slow and the saved copy was shown instead.
    const net = fetch(req, {cache:'no-store'}).then(res=>{
      if(res && res.ok && res.type === 'basic') c.put(url.origin + url.pathname, res.clone()).catch(()=>{});
      return res;
    });
    e.waitUntil(net.catch(()=>{}));
    try{
      return await withTimeout(net, NET_TIMEOUT_MS);
    }catch(err){
      let path = url.pathname;
      if(path === '/' ) path = '/index.html';
      const hit = await c.match(url.origin + path) || await c.match(req, {ignoreSearch:true})
        || (req.mode === 'navigate' ? (await c.match(url.origin + '/index.html') || await c.match(url.origin + '/')) : null);
      if(hit) return hit;
      throw err;
    }
  })());
});
