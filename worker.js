// Web Worker — sends a tick each second, throttled when page hidden via postMessage pacing.
let timer=null;
self.onmessage = (e)=>{
  if(e.data.type==='start'){
    clearInterval(timer);
    timer=setInterval(()=> postMessage({type:'tick'}), 1000);
  }else if(e.data.type==='stop'){
    clearInterval(timer); timer=null;
  }
};
