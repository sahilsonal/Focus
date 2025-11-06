// Focus Friends — Part 1 core
// Lightweight state, IndexedDB wrapper, Web Worker timer.

const $ = (q)=>document.querySelector(q);
const $$=(q)=>document.querySelectorAll(q);
const state = {
  user: null,
  mode: 'pomodoro',
  running: false,
  remainingSec: 0,
  totalSec: 0,
  pomodoro: {work:25, short:5, long:15, cycles:4, phase:'work', cycle:1, breakCount:0},
  custom: {len:50, tag:''},
  today: {minutes:0, sessions:[], longest:0}
};

///// IndexedDB tiny helper
let db;
const DB_NAME='focus_friends';
const DB_VER=1;
const openDB=()=> new Promise((res,rej)=>{
  const req=indexedDB.open(DB_NAME,DB_VER);
  req.onupgradeneeded=e=>{
    const d=e.target.result;
    d.createObjectStore('kv'); // simple K/V
    const s=d.createObjectStore('sessions',{keyPath:'id'});
    s.createIndex('byDay','day');
  };
  req.onsuccess=()=>{db=req.result;res(db)};
  req.onerror=()=>rej(req.error);
});
const kvSet=(k,v)=> new Promise((res,rej)=>{
  const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(v,k);
  tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
});
const kvGet=(k)=> new Promise((res,rej)=>{
  const tx=db.transaction('kv'); const r=tx.objectStore('kv').get(k);
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
});
const putSession=(s)=> new Promise((res,rej)=>{
  const tx=db.transaction('sessions','readwrite'); tx.objectStore('sessions').put(s);
  tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
});
const getTodaySessions=()=> new Promise((res,rej)=>{
  const tx=db.transaction('sessions'); const idx=tx.objectStore('sessions').index('byDay');
  const key=todayKey(new Date()); const req=idx.getAll(key);
  req.onsuccess=()=>res(req.result||[]); req.onerror=()=>rej(req.error);
});

///// Utils
const rnd = (arr)=>arr[Math.floor(Math.random()*arr.length)];
const genName=()=>{
  const a=['Quick','Calm','Brave','Quiet','Bright','Sharp','Nimble','Solid','Neat','True'];
  const b=['Fox','Panda','Hawk','Otter','Tiger','Koala','Lynx','Bear','Whale','Wolf'];
  return `${rnd(a)} ${rnd(b)} ${Math.floor(100+Math.random()*900)}`;
};
const avatarEmoji = ()=> rnd(['🦊','🐼','🦉','🦄','🐯','🦁','🐻','🐨','🐳','🐱','🐧','🐢']);
const pad=(n)=>n.toString().padStart(2,'0');
const fmtTime=(sec)=>`${pad(Math.floor(sec/60))}:${pad(sec%60)}`;
const todayKey=(d)=>d.toISOString().slice(0,10);

///// Audio
const ding = $('#ding');

///// Worker timer
let worker;
const ensureWorker = ()=>{
  if(worker) return;
  worker = new Worker('worker.js', {type:'module'});
  worker.onmessage = (e)=>{
    if(e.data.type==='tick'){
      tick();
    }
  };
};

///// UI bindings
const welcome = $('#welcome');
const app = $('#app');
const displayName = $('#displayName');
const avatar = $('#avatar');

$('#btn-auto').onclick = async ()=>{
  await openDB();
  let existing = await kvGet('user');
  if(!existing){
    existing = { id: crypto.randomUUID(), name: genName(), avatar: avatarEmoji(), createdAt: Date.now() };
    await kvSet('user', existing);
  }
  state.user = existing;
  startApp();
};

function startApp(){
  welcome.classList.add('hidden');
  app.classList.remove('hidden');
  displayName.textContent = state.user.name;
  avatar.textContent = state.user.avatar;
  loadPrefs();
  bindNav();
  bindTimerControls();
  refreshToday();
  registerSW();
}

displayName.addEventListener('input', async ()=>{
  state.user.name = displayName.textContent.slice(0,40);
  await kvSet('user', state.user);
});

///// Preferences
function loadPrefs(){
  $('#pWork').value = state.pomodoro.work;
  $('#pShort').value = state.pomodoro.short;
  $('#pLong').value = state.pomodoro.long;
  $('#pCycles').value = state.pomodoro.cycles;
  $('#cLen').value = state.custom.len;
  $('#cTag').value = state.custom.tag;
}

///// Nav
function bindNav(){
  $('#navTimer').onclick = ()=> showView('timer');
  $('#navSettings').onclick = ()=> showView('settings');
}
function showView(id){
  $$('.view').forEach(v=>v.classList.add('hidden'));
  $('#view-'+id).classList.remove('hidden');
  $$('.tab').forEach(t=>t.classList.remove('active'));
  $('#nav'+id[0].toUpperCase()+id.slice(1)).classList.add('active');
}

///// Mode switch
const modeBtns = $$('.mode-switch .chip');
modeBtns.forEach(b=> b.onclick = ()=>{
  modeBtns.forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  state.mode = b.dataset.mode;
  $('#pomodoroControls').classList.toggle('hidden', state.mode!=='pomodoro');
  $('#customControls').classList.toggle('hidden', state.mode!=='custom');
  setReadyLabel();
});

///// Timer logic
let endTs = 0; // epoch ms
let currentPhase = 'work'; // or break
let currentCycle = 1;

function setReadyLabel(){
  $('#subLabel').textContent = state.mode==='pomodoro'
    ? `Work ${$('#pWork').value}m • ${$('#pCycles').value} cycles`
    : `Custom ${$('#cLen').value}m ${$('#cTag').value?('• '+$('#cTag').value):''}`;
  updateRing(0);
  $('#timerLabel').textContent='00:00';
}

function bindTimerControls(){
  setReadyLabel();
  $('#pWork').onchange = e=> state.pomodoro.work = +e.target.value;
  $('#pShort').onchange = e=> state.pomodoro.short = +e.target.value;
  $('#pLong').onchange = e=> state.pomodoro.long = +e.target.value;
  $('#pCycles').onchange = e=> state.pomodoro.cycles = +e.target.value;
  $('#cLen').onchange = e=> state.custom.len = +e.target.value;
  $('#cTag').onchange = e=> state.custom.tag = e.target.value;

  $('#btnStart').onclick = startTimer;
  $('#btnPause').onclick = pauseTimer;
  $('#btnStop').onclick = stopTimer;
  $('#btnPlus5').onclick = ()=> adjust(300);
  $('#btnMinus1').onclick = ()=> adjust(-60);
  $('#soundToggle').onchange = ()=>{};
  $('#accentPicker').onchange = (e)=>{
    document.documentElement.style.setProperty('--accent', e.target.value);
  };
  $('#btnClear').onclick = async ()=>{
    if(!confirm('Clear all local data?')) return;
    indexedDB.deleteDatabase(DB_NAME);
    location.reload();
  };
  $('#btnInstall').onclick = ()=> deferredPrompt?.prompt();
}

function setControls(running){
  $('#btnStart').disabled = running;
  $('#btnPause').disabled = !running;
  $('#btnStop').disabled = !running;
}

function startTimer(){
  ensureWorker();
  if(state.mode==='pomodoro'){
    currentPhase='work'; currentCycle=1;
    state.totalSec = state.remainingSec = state.pomodoro.work*60;
    $('#todayMode').textContent='Pomodoro';
    $('#subLabel').textContent=`Cycle ${currentCycle}/${state.pomodoro.cycles} — Work`;
  }else{
    state.totalSec = state.remainingSec = state.custom.len*60;
    $('#todayMode').textContent='Custom';
    $('#subLabel').textContent= state.custom.tag ? state.custom.tag : 'Custom';
  }
  endTs = Date.now() + state.remainingSec*1000;
  state.running = true;
  setControls(true);
  worker.postMessage({type:'start'});
}

function pauseTimer(){
  state.running=false;
  setControls(false);
  worker.postMessage({type:'stop'});
  $('#subLabel').textContent = 'Paused';
}

function stopTimer(){
  worker.postMessage({type:'stop'});
  finalizeSession(true);
}

function adjust(delta){
  if(!state.running) return;
  state.remainingSec = Math.max(0, state.remainingSec + delta);
  endTs = Date.now() + state.remainingSec*1000;
  renderTime();
}

function tick(){
  if(!state.running) return;
  state.remainingSec = Math.max(0, Math.round((endTs - Date.now())/1000));
  renderTime();
  if(state.remainingSec<=0){
    // chime
    if($('#soundToggle').checked){ try{ ding.currentTime=0; ding.play(); }catch{} }
    if(state.mode==='pomodoro'){
      stepPomodoro();
    }else{
      finalizeSession(false);
    }
  }
}

function stepPomodoro(){
  if(currentPhase==='work'){
    // save work session
    finalizeSession(false, {pomodoro:true, phase:'work'});
    const isLong = (currentCycle % state.pomodoro.cycles===0);
    const b = isLong ? state.pomodoro.long : state.pomodoro.short;
    currentPhase='break';
    state.totalSec = state.remainingSec = b*60;
    endTs = Date.now() + state.remainingSec*1000;
    $('#subLabel').textContent= isLong ? 'Long Break' : 'Short Break';
  }else{
    // break ended
    if(currentCycle >= state.pomodoro.cycles){
      state.running=false;
      setControls(false);
      $('#subLabel').textContent='Finished';
      return;
    }
    currentCycle++;
    currentPhase='work';
    state.totalSec = state.remainingSec = state.pomodoro.work*60;
    endTs = Date.now() + state.remainingSec*1000;
    $('#subLabel').textContent=`Cycle ${currentCycle}/${state.pomodoro.cycles} — Work`;
  }
}

function updateRing(progress){
  const circ=339.292; // 2πr for r=54
  const off = Math.max(0, circ*(1-progress));
  document.querySelector('.progress').style.strokeDashoffset = off;
}

function renderTime(){
  const sec = state.remainingSec;
  $('#timerLabel').textContent = fmtTime(sec);
  updateRing(1 - (sec/state.totalSec));
}

async function finalizeSession(stoppedManually, extra={}){
  const dur = Math.round((state.totalSec - state.remainingSec));
  state.running=false;
  setControls(false);
  worker.postMessage({type:'stop'});
  if(dur>0){
    const now = new Date();
    const sess = {
      id: crypto.randomUUID(),
      userId: state.user.id,
      startedAt: Date.now() - dur*1000,
      endedAt: Date.now(),
      durationSec: dur,
      mode: state.mode,
      tag: state.mode==='custom' ? (state.custom.tag||null) : null,
      cycles: state.mode==='pomodoro'? currentCycle : 1,
      day: todayKey(now),
      stoppedManually: !!stoppedManually,
      ...extra
    };
    await putSession(sess);
  }
  setReadyLabel();
  refreshToday();
}

async function refreshToday(){
  const sessions = await getTodaySessions();
  const total = sessions.reduce((a,s)=>a+s.durationSec,0);
  const longest = Math.max(0,...sessions.map(s=>s.durationSec));
  $('#todayTotal').textContent = `${Math.round(total/60)}m`;
  $('#todaySessions').textContent = sessions.length;
  $('#todayLongest').textContent = `${Math.round(longest/60)}m`;
  const list = $('#todayList');
  list.innerHTML='';
  sessions.sort((a,b)=>a.startedAt-b.startedAt).forEach(s=>{
    const li=document.createElement('li');
    li.textContent = `${new Date(s.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} — ${Math.round(s.durationSec/60)}m ${s.mode}${s.tag?(' • '+s.tag):''}`;
    list.appendChild(li);
  });
}

///// PWA install
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault(); deferredPrompt=e; $('#btnInstall').disabled=false;
});

///// SW
async function registerSW(){
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('sw.js'); }catch{}
  }
}

// auto-open if user already exists
(async ()=>{
  await openDB();
  const u = await kvGet('user');
  if(u){ state.user=u; startApp(); }
})();
