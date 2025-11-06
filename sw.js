const CACHE = 'ff-cache-v1';
const ASSETS = [
  '/', 'index.html', 'styles.css', 'app.js', 'worker.js', 'manifest.json'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e)=> e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e)=>{
  const {request} = e;
  if(request.method!=='GET') return;
  e.respondWith(
    caches.match(request).then(resp => resp || fetch(request).then(r=>{
      const copy = r.clone();
      caches.open(CACHE).then(c=> c.put(request, copy)).catch(()=>{});
      return r;
    }).catch(()=> caches.match('index.html')))
  );
});
