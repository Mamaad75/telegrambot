#!/usr/bin/env node
/** Jarchi 1000-user HTTP resilience test. Use against /health or /health/ready. */
const base=String(process.env.BACKEND_URL||"http://127.0.0.1:3002").replace(/\/+$/,""), path=process.env.HEALTH_PATH||"/health";
const total=Math.max(1,Number(process.env.USERS||1000)), rounds=Math.max(1,Number(process.env.ROUNDS||3));
const concurrency=Math.max(1,Math.min(total,Number(process.env.CONCURRENCY||250))), timeoutMs=Number(process.env.REQUEST_TIMEOUT_MS||10000), budget=Number(process.env.P95_BUDGET_MS||750);
const percentile=(a,p)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor((p/100)*s.length))]};
async function one(i){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs),st=performance.now();try{const r=await fetch(`${base}${path}`,{signal:c.signal,headers:{"X-Load-Test-User":String(i)}});return{ok:r.ok,status:r.status,ms:performance.now()-st}}catch(e){return{ok:false,status:0,ms:performance.now()-st,error:e.name}}finally{clearTimeout(t)}}
async function round(){const out=[];let next=0;const ws=Array.from({length:Math.min(concurrency,total)},async()=>{while(true){const i=next++;if(i>=total)return;out.push(await one(i))}});await Promise.all(ws);return out}
const all=[];for(let r=0;r<rounds;r++){const x=await round();all.push(...x);console.log(JSON.stringify({round:r+1,total,ok:x.filter(v=>v.ok).length,errors:x.filter(v=>!v.ok).length,p50_ms:Math.round(percentile(x.map(v=>v.ms),50)),p95_ms:Math.round(percentile(x.map(v=>v.ms),95)),p99_ms:Math.round(percentile(x.map(v=>v.ms),99))}))}
const p95=percentile(all.map(v=>v.ms),95),failures=all.filter(v=>!v.ok).length;const pass=failures===0&&p95<=budget;console.log(JSON.stringify({summary:true,total_requests:all.length,failures,p95_ms:Math.round(p95),budget_ms:budget,pass}));process.exitCode=pass?0:1;
