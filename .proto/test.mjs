import { buildWorkAxis, optimizeOrderWork, layoutOnAxis, totalCostFromBlocks } from './work-axis.js';
import { autoSchedule as CURRENT, totalCost } from '../src/lib/scheduler.js';
import { accumulatedPressure } from '../src/lib/envelope.js';
import { advanceWork } from '../src/lib/calendar.js';
import { schedulableMinutes } from '../src/lib/tasks.js';

const DAY=86400000, now=new Date();
const SCH={bufferMinutes:0,days:[{dayOfWeek:0,enabled:false,startMinutes:540,endMinutes:1020},
 ...[1,2,3,4,5].map(d=>({dayOfWeek:d,enabled:true,startMinutes:540,endMinutes:1020})),
 {dayOfWeek:6,enabled:false,startMinutes:540,endMinutes:1020}]};
function rt(i){const d=[15,30,45,60,90,120][Math.floor(Math.random()*6)];
 const on=now.getTime()+(Math.random()*3-1)*DAY, pk=on+(0.5+Math.random()*5.5)*DAY;
 return{id:'task-'+i,description:'T'+i,estimatedMinutes:d,onset:new Date(on),peak:new Date(pk),
 peakPressure:0.3+Math.random()*0.7,createdAt:new Date(now.getTime()-Math.random()*DAY),
 scheduledBlocks:[],elapsedSeconds:0,remainingOverride:null,isCompleted:false,isDeleted:false,isLocked:false};}
function exact(tasks){const n=tasks.length,full=(1<<n)-1;
 const dur=tasks.map(t=>schedulableMinutes(t));
 const end=new Array(1<<n); end[0]=now;
 for(let m=1;m<=full;m++){const i=31-Math.clz32(m&-m);end[m]=advanceWork(end[m^(1<<i)],dur[i],SCH);}
 const memo=new Float64Array(1<<n).fill(-1);
 const solve=m=>{if(m===full)return 0;if(memo[m]!==-1)return memo[m];let b=Infinity;
  for(let i=0;i<n;i++){if(m&(1<<i))continue;const nm=m|(1<<i);
   const c=accumulatedPressure(tasks[i],end[nm])+solve(nm);if(c<b)b=c;}
  return memo[m]=b;};return solve(0);}

const log=console.log, quiet=f=>{console.log=()=>{};try{return f();}finally{console.log=log;}};
log('           PROTOTYPE (work axis)      vs      CURRENT (calendar repack)');
log('  n |  proto mean/max gap  | proto ms |  cur mean/max gap  | cur ms');
for(const n of [10,12,15,18]){
  const gp=[],gc=[]; let tp=0,tc=0,trials=0;
  for(let k=0;k<50;k++){
    const tasks=Array.from({length:n},(_,i)=>rt(i));
    const axis=buildWorkAxis(SCH,21);
    let t=performance.now();
    const order=optimizeOrderWork(tasks,SCH,axis);
    const blocks=layoutOnAxis(order,tasks,SCH,axis);
    tp+=performance.now()-t;
    if(!blocks) continue;
    t=performance.now(); const cb=quiet(()=>CURRENT(tasks,SCH)); tc+=performance.now()-t;
    if(!cb.length||new Set(cb.map(b=>b.taskId)).size<n) continue;
    const o=exact(tasks); if(o<=0) continue;
    gp.push((totalCostFromBlocks(blocks,tasks)-o)/o*100);
    gc.push((totalCost(cb,tasks)-o)/o*100);
    trials++;
  }
  const st=v=>`${(v.reduce((a,b)=>a+b,0)/v.length).toFixed(3)}%/${Math.max(...v).toFixed(2)}%`;
  log(`${String(n).padStart(3)} | ${st(gp).padStart(20)} | ${tp.toFixed(0).padStart(7)}ms | ${st(gc).padStart(18)} | ${tc.toFixed(0)}ms   (${trials} trials)`);
}
