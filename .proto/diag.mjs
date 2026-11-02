import { buildWorkAxis, optimizeOrderWork, layoutOnAxis, totalCostFromBlocks, sequenceCostWork } from './work-axis.js';
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
function exactWithOrder(tasks){const n=tasks.length,full=(1<<n)-1;
 const dur=tasks.map(t=>schedulableMinutes(t));
 const end=new Array(1<<n); end[0]=now;
 for(let m=1;m<=full;m++){const i=31-Math.clz32(m&-m);end[m]=advanceWork(end[m^(1<<i)],dur[i],SCH);}
 const memo=new Float64Array(1<<n).fill(-1), choice=new Int8Array(1<<n).fill(-1);
 const solve=m=>{if(m===full)return 0;if(memo[m]!==-1)return memo[m];let b=Infinity,bi=-1;
  for(let i=0;i<n;i++){if(m&(1<<i))continue;const nm=m|(1<<i);
   const c=accumulatedPressure(tasks[i],end[nm])+solve(nm);if(c<b){b=c;bi=i;}}
  choice[m]=bi; return memo[m]=b;};
 const cost=solve(0); const ord=[]; let m=0;
 while(m!==full){const i=choice[m];ord.push(i);m|=(1<<i);} return {cost,ord};}

// For bad cases: is the DP's optimal ORDER actually reachable by our layout?
let checked=0;
for(let k=0;k<200 && checked<3;k++){
  const tasks=Array.from({length:15},(_,i)=>rt(i));
  const axis=buildWorkAxis(SCH,21);
  const order=optimizeOrderWork(tasks,SCH,axis);
  const blocks=layoutOnAxis(order,tasks,SCH,axis);
  if(!blocks) continue;
  const {cost:opt,ord}=exactWithOrder(tasks);
  const got=totalCostFromBlocks(blocks,tasks);
  if(got>opt*1.03){
    checked++;
    // What does OUR layout cost when given the DP's optimal order?
    const dpBlocks=layoutOnAxis(ord,tasks,SCH,axis);
    const dpLaid=dpBlocks?totalCostFromBlocks(dpBlocks,tasks):NaN;
    // What does our SEARCH think each order costs (work-axis model)?
    const cache=new Map(); const dur=tasks.map(t=>schedulableMinutes(t));
    const mOur=sequenceCostWork(order,tasks,dur,0,axis,cache);
    const mDp =sequenceCostWork(ord,tasks,dur,0,axis,cache);
    console.log(`case ${checked}: DP optimal=${opt.toFixed(4)}  ours=${got.toFixed(4)}  gap=${((got-opt)/opt*100).toFixed(2)}%`);
    console.log(`   DP order laid out on our axis costs: ${dpLaid.toFixed(4)}  (${dpLaid<got?'BETTER - search missed it':'not reachable / not better'})`);
    console.log(`   model says: ours=${mOur.toFixed(4)}  dpOrder=${mDp.toFixed(4)}  -> model ${mOur<=mDp?'prefers ours (search consistent)':'prefers DP order (search failed)'}`);
    console.log(`   blocks: ${blocks.length} for 15 tasks (splits=${blocks.length-15})`);
  }
}
