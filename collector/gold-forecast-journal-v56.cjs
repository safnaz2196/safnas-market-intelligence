'use strict';
/* Daily locked forecast journal. Future outcomes are evaluated only when later
 * dated market closes exist; no backfilled predictions or fabricated accuracy.
 * One entry per origin session/horizon, with a maximum of 800 entries. */
const allowed=new Set([1,3,7,14,30,90]);
const positive=n=>Number.isFinite(n)&&n>0;
const key=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x));
function normalizeHistory(rows){
 const map=new Map();
 for(const r of Array.isArray(rows)?rows:[]){
  const date=r?.date;
  const usdOz=Number(r?.usdOz);
  if(key(date)&&usdOz>100&&usdOz<15000)map.set(date,{date,usdOz});
 }
 return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function updateJournal(previous,history,horizons,now=new Date()){
 const rows=normalizeHistory(history);
 const map=new Map(rows.map((r,i)=>[r.date,i]));
 const previousRows=Array.isArray(previous?.entries)?previous.entries:[];
 const entries=previousRows.filter(e=>e&&key(e.originDate)&&allowed.has(e.days)&&
  positive(e.referenceUsdOz)&&Number.isInteger(e.sessions)&&e.sessions>0&&e.sessions<100&&
  ['rise','fall','range'].includes(e.lean)&&['pending','resolved'].includes(e.status)).slice(-800)
  .map(e=>({...e}));
 let newCount=0,resolvedCount=0;
 const current=rows.at(-1),existing=new Set(entries.map(e=>e.originDate+'|'+e.days));
 if(current&&rows.length>=160){
  for(const h of Array.isArray(horizons)?horizons:[]){
   if(!allowed.has(h.days)||!Number.isInteger(h.sessions)||h.sessions<1||h.sessions>90)continue;
   const id=current.date+'|'+h.days;
   if(existing.has(id))continue;
   entries.push({originDate:current.date,days:h.days,sessions:h.sessions,referenceUsdOz:current.usdOz,
    lean:['rise','fall','range'].includes(h.direction)?h.direction:'range',
    historicalSampleRisePct:Number.isFinite(h.probUp)?h.probUp:null,
    modelEdgeDemonstrated:!!h.validation?.edgeDemonstrated,
    status:'pending'});
   newCount++;
  }
 }
 for(const e of entries){
  if(e.status==='resolved')continue;
  const index=map.get(e.originDate);
  // The originating daily close needs to be present in this authenticated historical series.
  if(index===undefined||index+e.sessions>=rows.length)continue;
  if(rows[index].usdOz!==e.referenceUsdOz)continue;
  const future=rows[index+e.sessions];
  const ret=(future.usdOz/e.referenceUsdOz-1)*100;
  e.status='resolved';e.actualDate=future.date;e.actualUsdOz=future.usdOz;
  e.actualReturnPct=Number(ret.toFixed(3));
  e.actualDirection=ret>.00001?'rise':ret<-.00001?'fall':'range';
  e.directionMatch=e.lean===e.actualDirection;
  resolvedCount++;
 }
 const safe=entries.slice(-800);
 const resolved=safe.filter(x=>x.status==='resolved'),pending=safe.filter(x=>x.status==='pending');
 const audit={recorded:safe.length,pending:pending.length,resolved:resolved.length,
  modelOrigin:'Forward-only daily journal. No historic outcomes are treated as predictions.',
  overallDirectionHitRate:resolved.length?Number((100*resolved.filter(e=>e.directionMatch).length/resolved.length).toFixed(1)):null,
  byHorizon:[...allowed].map(days=>{
   const a=resolved.filter(e=>e.days===days),p=pending.filter(e=>e.days===days);
   return {days,resolved:a.length,pending:p.length,hitRate:a.length?Number((100*a.filter(e=>e.directionMatch).length/a.length).toFixed(1)):null};
  }),
  warning:'Observed after-the-fact performance may be too sparse to establish predictive skill. Historical analogue backtests are separate.'};
 return {schemaVersion:1,generatedAt:now.toISOString(),entries:safe,summary:audit,newCount,resolvedCount};
}
module.exports={normalizeHistory,updateJournal};
