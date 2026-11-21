'use strict';
/* Safnas Finance v5.4 — free evidence-checked gold outlook.
   Outputs distributional scenarios, not guaranteed prices, exact dates or investment advice.
   Uses public daily XAUUSD history, spot/FX, and optional FRED macro observations.
   All dated evidence and validation are shown; no false AI certainty. */
const fs=require('node:fs');
const path=require('node:path');
const OZ=31.1034768;
const HISTORY_URL='https://xaus.com/api/v1/history';
const BACKUP_HISTORY='https://standardbullion.com/api/v1/market/history?metal=XAU&range=1y';
const SPOT_URL='https://api.gold-api.com/price/XAU';
const BACKUP_SPOT='https://xaus.com/api/v1/spot?compact=1';
const FX_URL='https://open.er-api.com/v6/latest/USD';
const YIELD_URL='https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10&cosd=2026-05-01';
const DOLLAR_URL='https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS&cosd=2026-05-01';
const POS=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const nice=x=>Number.isFinite(x)?Number(x.toFixed(3)):null;
const isDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
async function fetchJSON(url) {
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),16000);
 try {
  const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'SafnasFinanceResearch/5.4'},signal:ac.signal});
  if(!r.ok)throw Error('HTTP '+r.status);
  return await r.json();
 }finally{clearTimeout(timer)}
}
async function fetchCSV(url) {
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),12000);
 try {
  const r=await fetch(url,{headers:{'User-Agent':'SafnasFinanceResearch/5.4','Accept':'text/csv'},signal:ac.signal});
  if(!r.ok)throw Error('HTTP '+r.status);
  const lines=(await r.text()).trim().split(/\r?\n/);
  return lines.slice(1).map(line=>line.split(',')).filter(row=>isDate(row[0])&&Number.isFinite(Number(row[1]))&&row[1]!=='.')
   .map(row=>({date:row[0],value:Number(row[1])})).sort((a,b)=>a.date.localeCompare(b.date));
 }finally{clearTimeout(timer)}
}
function cleanHistory(data, now=new Date()){
 const rows=Array.isArray(data?.points)?data.points:[];
 const maxDay=now.toISOString().slice(0,10);
 const records=new Map();
 for(const raw of rows){
  const date=String(raw?.d||raw?.t||raw?.date||'').slice(0,10);
  const value=Number(raw?.c??raw?.price??raw?.close);
  if(isDate(date)&&date<=maxDay&&value>300&&value<15000)records.set(date,{date,usdOz:value});
 }
 return [...records.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-900);
}
function percent(newer,older){return POS(newer)&&POS(older)?(newer/older-1)*100:null}
function avg(v){return v.reduce((a,b)=>a+b,0)/v.length}
function std(v){if(v.length<2)return 0;const m=avg(v);return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/(v.length-1))}
function percentile(sorted,p){if(!sorted.length)return null;const at=(sorted.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at);return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo)}
function feature(rows,i){
 if(i<52)return null;
 const v=rows;
 const last=v[i].usdOz,g5=(last/v[i-5].usdOz-1)*100,g20=(last/v[i-20].usdOz-1)*100;
 const logs=[];for(let j=i-19;j<=i;j++)logs.push(Math.log(v[j].usdOz/v[j-1].usdOz));
 return {g5,g20,vol:Math.max(.2,std(logs)*Math.sqrt(252)*100)};
}
function similarity(a,b){
 return ((a.g5-b.g5)/4)**2 + ((a.g20-b.g20)/10)**2 + ((a.vol-b.vol)/12)**2;
}
function analog(rows,asOf,h,limit=72){
 const point=feature(rows,asOf);
 if(!point)return null;
 const choices=[];
 for(let i=52;i+h<asOf;i++){
  const old=feature(rows,i);
  if(!old)continue;
  const result=Math.log(rows[i+h].usdOz/rows[i].usdOz);
  choices.push({distance:similarity(point,old),value:result});
 }
 choices.sort((a,b)=>a.distance-b.distance);
 const selection=choices.slice(0,limit);
 if(selection.length<35)return null;
 const vals=selection.map(s=>s.value).sort((a,b)=>a-b);
 return {n:vals.length,pUp:vals.filter(x=>x>0).length/vals.length,
  p10:percentile(vals,.10),p50:percentile(vals,.50),p90:percentile(vals,.90)};
}
function backtest(rows,h){
 const from=Math.max(105,rows.length-130),end=rows.length-h-1;
 const checks=[];
 for(let t=from;t<=end;t+=2){
  const a=analog(rows,t,h,72);
  if(!a)continue;
  const actual=rows[t+h].usdOz>rows[t].usdOz?1:0;
  checks.push({p:a.pUp,actual});
 }
 if(checks.length<20)return {count:checks.length,hitRate:null,baseRate:null,brier:null,baseBrier:null,edgeDemonstrated:false};
 const hitRate=checks.filter(x=>(x.p>=.5)===(x.actual===1)).length/checks.length;
 const baseRate=checks.filter(x=>x.actual===1).length/checks.length;
 const brier=avg(checks.map(x=>(x.p-x.actual)**2));
 const baseBrier=avg(checks.map(x=>(baseRate-x.actual)**2));
 return {count:checks.length,hitRate:nice(hitRate*100),baseRate:nice(baseRate*100),
  brier:nice(brier),baseBrier:nice(baseBrier),edgeDemonstrated:brier<baseBrier-.008};
}
function model(rows,now=new Date()){
 if(rows.length<160)throw Error('Need at least 160 dated trading observations for a historical outlook');
 const asOf=rows.at(-1).date;
 const lag=(Date.parse(now.toISOString().slice(0,10)+'T00:00:00Z')-Date.parse(asOf+'T00:00:00Z'))/86400000;
 if(lag<0||lag>7)throw Error('Daily gold historical series is too old to make a current outlook');
 const f=feature(rows,rows.length-1),last=rows.at(-1).usdOz;
 const horizons=[{days:3,sessions:2},{days:7,sessions:5},{days:14,sessions:10},{days:30,sessions:21}].map(h=>{
  const a=analog(rows,rows.length-1,h.sessions),v=backtest(rows,h.sessions);
  if(!a)return {...h,direction:'unavailable',lean:'Insufficient comparable observations',reason:'Not enough validated history',probUp:null,
   scenarios:null,validation:v};
  const p=a.pUp;
  const direction=p>=.57?'rise':p<=.43?'fall':'range';
  const lean=direction==='rise'?'Rising bias':direction==='fall'?'Falling bias':'Mixed / sideways';
  return {...h,direction,lean,probUp:nice(p*100),similarCases:a.n,
   scenarios:{lowPct:nice((Math.exp(a.p10)-1)*100),midPct:nice((Math.exp(a.p50)-1)*100),
    highPct:nice((Math.exp(a.p90)-1)*100)},
   validation:v,confidence:v.edgeDemonstrated?'historically_evaluated':'not_proven',
   warning:'Approximate calendar window, NOT the exact day an event will occur.'};
 });
 return {asOf,historyCount:rows.length,historyLastUsdOz:nice(last),observations:rows.slice(-150),
  indicators:{momentum5Pct:nice(f.g5),momentum20Pct:nice(f.g20),volatility20AnnualizedPct:nice(f.vol)},
  horizons,ageDays:lag,method:'Historical analogue similarity: 5/20-session momentum + 20-session volatility; last 130-session walk-forward Brier evaluation.'};
}
function macroTrend(rows,code,name,url){
 if(!Array.isArray(rows)||rows.length<7)return {name,available:false,source:url};
 const latest=rows.at(-1),back=rows.at(-6);
 const days=(Date.now()-Date.parse(latest.date+'T00:00:00Z'))/86400000;
 if(days>16)return {name,available:false,source:url,staleAsOf:latest.date};
 return {name,available:true,asOf:latest.date,last:nice(latest.value),change5:nice(latest.value-back.value),
  unit:code==='DFII10'?'percentage points':'index points',source:url};
}
function renderEvidence(m,macro){
 const x=m.indicators,items=[
  {title:'Gold price momentum · 5 sessions',measurement:(x.momentum5Pct>0?'+':'')+x.momentum5Pct+'%',
   interpretation:x.momentum5Pct>0?'Recently rising; upward momentum may persist or reverse.':'Recently falling; downward momentum may persist or reverse.',
   source:'https://xaus.com/api/v1/history',asOf:m.asOf},
  {title:'Gold price momentum · 20 sessions',measurement:(x.momentum20Pct>0?'+':'')+x.momentum20Pct+'%',
   interpretation:'Measured from past daily closes; historical direction alone cannot guarantee future movement.',
   source:'https://xaus.com/api/v1/history',asOf:m.asOf},
  {title:'20-session price volatility',measurement:x.volatility20AnnualizedPct+'% annualized',
   interpretation:'Historical fluctuation indicates how wide forecast scenarios may be. It is not a probability of loss.',
   source:'https://xaus.com/api/v1/history',asOf:m.asOf}
 ];
 for(const fact of macro){
  if(!fact.available)continue;
  let interpretation;
  if(fact.name==='U.S. 10-year inflation-adjusted yield')
   interpretation=fact.change5>0?'Real yields increased; often a headwind for non-yielding gold, not a certain effect.':
    fact.change5<0?'Real yields declined; often supportive of gold, but not a forecast by itself.':'Little change in real yields.';
  else interpretation=fact.change5>0?'A stronger trade-weighted dollar may constrain USD gold, other factors can dominate.':
   fact.change5<0?'A weaker trade-weighted dollar may support USD gold, other factors can dominate.':'Little change in broad dollar index.';
  items.push({title:fact.name,measurement:(fact.change5>0?'+':'')+fact.change5+' '+fact.unit+' (5 observations)',
   interpretation,source:fact.source,asOf:fact.asOf});
 }
 return items;
}
async function main(){
 const failures=[];
 let raw=null,historySource=HISTORY_URL;
 try{raw=await fetchJSON(HISTORY_URL);}catch(e){failures.push('Primary gold history: '+e.message)}
 let rows=cleanHistory(raw);
 if(rows.length<160){
  try{raw=await fetchJSON(BACKUP_HISTORY);rows=cleanHistory(raw);historySource=BACKUP_HISTORY;}
  catch(e){failures.push('Backup gold history: '+e.message)}
 }
 if(rows.length<160)throw Error('No credible daily gold history; do not publish a forecast');
 const now=new Date(),out=model(rows,now);
 let spot=null,fx=null;
 try{
  const p=await fetchJSON(SPOT_URL),amount=Number(p.price),asOf=p.updatedAt||p.updated_at;
  if(POS(amount)&&Number.isFinite(Date.parse(asOf)))spot={usdOz:amount,asOf,source:SPOT_URL};
 }catch(e){failures.push('Primary spot: '+e.message)}
 if(!spot)try{
  const p=await fetchJSON(BACKUP_SPOT),amount=Number(p.spot_usd_oz??p.xau?.price),asOf=p.data_state?.as_of||p.updated_at;
  if(POS(amount)&&Number.isFinite(Date.parse(asOf)))spot={usdOz:amount,asOf,source:BACKUP_SPOT};
 }catch(e){failures.push('Backup spot: '+e.message)}
 try{
  const p=await fetchJSON(FX_URL),date=new Date(Number(p.time_last_update_unix)*1000).toISOString();
  if(p.result==='success'&&p.base_code==='USD'&&POS(p.rates?.SAR)&&POS(p.rates?.LKR))
   fx={SAR:p.rates.SAR,LKR:p.rates.LKR,asOf:date,source:FX_URL};
 }catch(e){failures.push('FX: '+e.message)}
 const macro=[];
 for(const [name,url,code] of [
  ['U.S. 10-year inflation-adjusted yield',YIELD_URL,'DFII10'],
  ['Broad U.S. dollar index',DOLLAR_URL,'DTWEXBGS']]) {
  try {macro.push(macroTrend(await fetchCSV(url),code,name,url));}
  catch(e){failures.push(name+': '+e.message);macro.push({name,available:false,source:url})}
 }
 const recentSpot=spot&&Date.now()-Date.parse(spot.asOf)<36*3600000&&Date.now()>Date.parse(spot.asOf)-180000;
 const recentFx=fx&&Date.now()-Date.parse(fx.asOf)<3*86400000;
 const quote=recentSpot?spot:{usdOz:out.historyLastUsdOz,asOf:out.asOf+'T00:00:00Z',source:historySource,historical:true};
 const priceCoherence=quote.usdOz/out.historyLastUsdOz;
 const validPrices=priceCoherence>.85&&priceCoherence<1.15;
 const priceGrams={};
 if(validPrices&&recentFx)for(const c of ['SAR','LKR'])
  priceGrams[c]={pure24: nice(quote.usdOz/OZ*fx[c]),jewellery22:nice(quote.usdOz/OZ*fx[c]*22/24),currency:c};
 else failures.push('No current local-currency scenario: quote or FX verification incomplete');
 const report={schemaVersion:1,version:'5.4',generatedAt:now.toISOString(),
  status:validPrices&&out.ageDays<=4?'observed':'limited',dateSemantics:'Approximate calendar windows, never a guaranteed date',
  current:{usdOz:quote.usdOz,asOf:quote.asOf,source:quote.source,historical:!!quote.historical,
   fx:recentFx?fx:null,localPerGram:priceGrams},
  history:{source:historySource,asOf:out.asOf,observations:out.historyCount,
   points:out.observations.map(x=>({date:x.date,usdOz:nice(x.usdOz)}))},
  indicators:out.indicators,horizons:out.horizons,method:out.method,
  evidence:renderEvidence(out,macro),macro,
  overallCaution:'Forecasts are statistical scenarios based on past observations, not predictions of an exact price or date. If model calibration does not outperform a historical baseline, no predictive edge is claimed. FX changes can alter SAR and LKR outcomes.',
  sources:[{name:'XAUS daily history',url:historySource},{name:'Gold spot',url:quote.source},
    ...(recentFx?[{name:'USD FX rates',url:FX_URL}]:[]),...macro.map(x=>({name:x.name,url:x.source}))],
  alertsNotice:'Directional outlook is not a trading instruction. Jewellery charges and retail margins excluded.',
  warnings:failures.slice(0,8)};
 const folder=path.join(__dirname,'..','market-intelligence'),dest=path.join(folder,'gold-outlook-v54.json');
 fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n','utf8');
 console.log(JSON.stringify({outlook:'gold-v5.4',status:report.status,history:out.historyCount,lastDate:out.asOf,
  direction7:out.horizons.find(x=>x.days===7)?.direction,validation7:out.horizons.find(x=>x.days===7)?.validation,
  current:report.current.usdOz,macro:macro.filter(x=>x.available).length,warnings:failures.length}));
}
if(require.main===module)main().catch(e=>{console.error('Gold outlook research unavailable:',e.message);process.exitCode=1});
module.exports={cleanHistory,model,analog,backtest,macroTrend,renderEvidence,isDate,percent};
