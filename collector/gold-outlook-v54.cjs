'use strict';
/* Safnas Finance v5.4 — free evidence-checked gold outlook.
   Outputs distributional scenarios, not guaranteed prices, exact dates or investment advice.
   Uses public daily XAUUSD history, spot/FX, and optional FRED macro observations.
   All dated evidence and validation are shown; no false AI certainty. */
const fs=require('node:fs');
const path=require('node:path');
const advanced=require('./gold-advanced-v56.cjs');
const journal=require('./gold-forecast-journal-v56.cjs'); // legacy journal migration
const ledger=require('./gold-prediction-ledger-v57.cjs');
const ensemble=require('./gold-ensemble-v58.cjs');
const professional=require('./gold-professional-v59.cjs');
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
/** Evidence audit is descriptive, not a calibrated probability or advice. */
function deepResearch(modelOutput, macro, quote=null, now=new Date()) {
 const x=modelOutput.indicators, history=modelOutput.observations||[], last=history.at(-1);
 const values=history.map(p=>p.usdOz).filter(POS);
 const avgN=n=>values.length>=n?nice(values.slice(-n).reduce((a,b)=>a+b,0)/n):null;
 const mom5=Number(x.momentum5Pct),mom20=Number(x.momentum20Pct),vol=Number(x.volatility20AnnualizedPct);
 const signals=[];
 const push=(key,measurement,points,why,sourceDate,source,weight=1)=>{
  signals.push({key,measurement,pressure:points>0?'up':points<0?'down':'neutral',weight,
   explanation:why,asOf:sourceDate,source,rawSign:points});
 };
 const up5=mom5>.75?1:mom5<-.75?-1:0;
 push('Five-session momentum',(mom5>=0?'+':'')+mom5.toFixed(2)+'%',up5,
  'Recent gold momentum can persist or reverse; this is not a future return estimate.',modelOutput.asOf,HISTORY_URL,1);
 const up20=mom20>1.5?1:mom20< -1.5?-1:0;
 push('20-session trend',(mom20>=0?'+':'')+mom20.toFixed(2)+'%',up20,
  'A longer recent trend is context, not a buy/sell instruction.',modelOutput.asOf,HISTORY_URL,.8);
 const yieldRow=macro.find(v=>v.name==='U.S. 10-year inflation-adjusted yield');
 const usdRow=macro.find(v=>v.name==='Broad U.S. dollar index');
 if(yieldRow?.available&&Number.isFinite(yieldRow.change5)){
  const n=yieldRow.change5;
  push('U.S. real yields',(n>0?'+':'')+nice(n)+' percentage points in 5 observations',n>.03?-1:n<-.03?1:0,
   'Higher real yields can increase the opportunity cost of holding non-yielding gold; not a mechanical price rule.',yieldRow.asOf,yieldRow.source,1);
 }
 if(usdRow?.available&&Number.isFinite(usdRow.change5)){
  const n=usdRow.change5;
  push('Broad U.S. dollar',(n>0?'+':'')+nice(n)+' index points in 5 observations',n>.40?-1:n<-.40?1:0,
   'A firmer dollar often pressures USD gold; gold and dollar strength may also coexist.',usdRow.asOf,usdRow.source,.8);
 }
 const spotPct=quote&&!quote.historical&&POS(quote.usdOz)&&POS(last?.usdOz)?percent(quote.usdOz,last.usdOz):null;
 if(Number.isFinite(spotPct)) {
  push('Latest spot vs last historical close',(spotPct>=0?'+':'')+nice(spotPct)+'%',spotPct>.5?1:spotPct<-.5?-1:0,
   'Intraday spot versus the most recent dated close, which may reflect different quote conventions.',quote.asOf,quote.source,.55);
 }
 const bull=signals.filter(v=>v.rawSign>0),bear=signals.filter(v=>v.rawSign<0);
 const upScore=nice(bull.reduce((sum,v)=>sum+v.weight,0));
 const downScore=nice(bear.reduce((sum,v)=>sum+v.weight,0));
 const tilt=upScore-downScore>=1.4?'upward_pressure':downScore-upScore>=1.4?'downward_pressure':'mixed';
 const modelEdgeDemonstrated=modelOutput.horizons.some(h=>h.validation?.edgeDemonstrated===true);
 const researchConfidence=modelEdgeDemonstrated?'some_historical_validation':'unproven_predictive_edge';
 const reasons=[
  ...signals.filter(v=>v.rawSign!==0).sort((a,b)=>b.weight-a.weight).slice(0,4).map(s=>({
   direction:s.pressure,title:s.key,evidence:s.measurement,explanation:s.explanation,
   asOf:s.asOf,source:s.source})),
  ...(vol>=28?[{direction:'risk',title:'High historical volatility',
   evidence:nice(vol)+'% annualized (20 sessions)',
   explanation:'Outcomes may swing widely in either direction. Do not interpret scenario percentiles as guaranteed limits.',
   asOf:modelOutput.asOf,source:HISTORY_URL}]:[])
 ];
 const ma20=avgN(20),ma50=avgN(50);
 const levels={
  lastHistoryClose:nice(last?.usdOz),
  movingAverage20:ma20,movingAverage50:ma50,
  prior20High:nice(values.length>=20?Math.max(...values.slice(-20)):null),
  prior20Low:nice(values.length>=20?Math.min(...values.slice(-20)):null),
  spotVsLastHistoryClosePct:nice(spotPct)
 };
 const reliability=[
  modelEdgeDemonstrated?'At least one forecast horizon beat its simple benchmark in the available walk-forward test.':'None of the tested horizons demonstrated a reliable advantage over its simple historical benchmark.',
  'Directional pressure scores are heuristic explanations, NOT calibrated probabilities.',
  'A 3/7/14/30-day window is a rough calendar period, not a precise event date.',
  'SAR/LKR outcomes also depend on currency rates; spot and local jewellery prices can differ.'
 ];
 return {
  kind:'evidence_based_research_not_live_prediction',
  classification:tilt,bullishDrivers:bull.length,bearishDrivers:bear.length,
  sourceSignals:signals,driverReasons:reasons,levels,
  volatilityRisk:vol>=28?'high':vol>=18?'elevated':'ordinary',
  modelAudit:{reliableForecastProven:modelEdgeDemonstrated,confidence:researchConfidence,
   byHorizon:modelOutput.horizons.map(h=>({days:h.days,checks:h.validation?.count||0,
    modelBrier:h.validation?.brier??null,baselineBrier:h.validation?.baseBrier??null,
    observedHitRatePct:h.validation?.hitRate??null,edgeDemonstrated:!!h.validation?.edgeDemonstrated}))},
  watchFor:[
   {event:'Five-session momentum changes sign',detail:'May alter short-term pressure, but is not itself a price forecast.',source:HISTORY_URL},
   {event:'Real yields shift',detail:'Rising yields often challenge gold, while falling yields can be supportive.',source:yieldRow?.source||YIELD_URL},
   {event:'Broad dollar trend changes',detail:'Currency moves can counter or reinforce changes in USD gold prices.',source:usdRow?.source||DOLLAR_URL},
   {event:'Volatility remains elevated',detail:'Historical scenario ranges can widen when realized volatility increases.',source:HISTORY_URL}
  ],
  reliabilityNotes:reliability,
  evaluatedAt:now.toISOString()
 };
}
function extraHorizon(rows,hDays,sessions){
 const a=analog(rows,rows.length-1,sessions),v=backtest(rows,sessions);
 if(!a)return {days:hDays,sessions,direction:'unavailable',lean:'Insufficient verified historical examples',
  probUp:null,similarCases:0,scenarios:null,validation:v,confidence:'not_proven',
  warning:'Approximate calendar window, not an exact event date'};
 const p=a.pUp;
 return {days:hDays,sessions,direction:p>=.57?'rise':p<=.43?'fall':'range',
  lean:p>=.57?'Rising historical bias':p<=.43?'Falling historical bias':'Mixed historical cases',
  probUp:nice(p*100),similarCases:a.n,
  scenarios:{lowPct:nice((Math.exp(a.p10)-1)*100),midPct:nice((Math.exp(a.p50)-1)*100),
    highPct:nice((Math.exp(a.p90)-1)*100)},
  validation:v,confidence:v.edgeDemonstrated?'historically_evaluated':'not_proven',
  warning:'Historical sample frequency is not a calibrated future probability or exact price/date.'};
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
 let adaptive=null;
 try{adaptive=ensemble.evaluate(rows,now);}catch(e){failures.push('Adaptive multi-model evaluation unavailable: '+String(e.message).slice(0,140));}
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
 // Add independent technical + regulatory positioning context.
 const technical=advanced.technical(rows,now);
 let cot={available:false,reason:'Not yet checked',source:advanced.CFTC_REFERENCE};
 try{
  const cotData=await fetchJSON(advanced.CFTC_URL);
  cot=advanced.parseCot(cotData,now);
  if(!cot.available)failures.push('CFTC positioning unavailable: '+cot.reason);
 }catch(e){cot={available:false,reason:'CFTC endpoint could not be verified',source:advanced.CFTC_REFERENCE};
   failures.push('CFTC weekly positioning: '+String(e.message).slice(0,90));}
 const extended=[extraHorizon(rows,1,1),extraHorizon(rows,90,63)];
 const advancedResearch={version:'5.6',technical,managedMoney:cot,
  extraHorizons:extended,catalysts:advanced.catalysts(technical,cot,macro),
  validationNote:'CFTC reports are weekly and lagged. All indicators and historical analogues are observations, not an independently proven prediction.'};
 const report={schemaVersion:1,version:'5.4',generatedAt:now.toISOString(),
  status:validPrices&&out.ageDays<=4?'observed':'limited',dateSemantics:'Approximate calendar windows, never a guaranteed date',
  current:{usdOz:quote.usdOz,asOf:quote.asOf,source:quote.source,historical:!!quote.historical,
   fx:recentFx?fx:null,localPerGram:priceGrams},
  history:{source:historySource,asOf:out.asOf,observations:out.historyCount,
   points:out.observations.map(x=>({date:x.date,usdOz:nice(x.usdOz)}))},
  indicators:out.indicators,horizons:out.horizons,method:out.method,
  evidence:renderEvidence(out,macro),macro,
  advanced:advancedResearch,
  deepResearch:deepResearch(out,macro,quote,now),
  overallCaution:'Forecasts are statistical scenarios based on past observations, not predictions of an exact price or date. If model calibration does not outperform a historical baseline, no predictive edge is claimed. FX changes can alter SAR and LKR outcomes.',
  sources:[{name:'CFTC weekly futures positioning',url:advanced.CFTC_REFERENCE},{name:'XAUS daily history',url:historySource},{name:'Gold spot',url:quote.source},
    ...(recentFx?[{name:'USD FX rates',url:FX_URL}]:[]),...macro.map(x=>({name:x.name,url:x.source}))],
  alertsNotice:'Directional outlook is not a trading instruction. Jewellery charges and retail margins excluded.',
  warnings:failures.slice(0,8)};
 const reportDirectory=path.join(__dirname,'..','market-intelligence');
 const ledgerPath=path.join(reportDirectory,'gold-prediction-history-v57.json');
 const legacyPath=path.join(reportDirectory,'gold-forecast-journal-v56.json');
 let previousLedger=null,legacyForecasts=null;
 if(fs.existsSync(ledgerPath)){
  try{previousLedger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));}
  catch(e){throw new Error('Stored prediction ledger cannot be parsed; refusing to overwrite locked history.');}
 }
 if(!previousLedger&&fs.existsSync(legacyPath)){
  try{legacyForecasts=JSON.parse(fs.readFileSync(legacyPath,'utf8'));}
  catch(e){throw new Error('Previous prediction journal cannot be parsed; refusing to erase historical forecasts.');}
 }
 const ledgerReport=ledger.updateLedger({previous:previousLedger,legacy:legacyForecasts,history:rows,
  horizons:[...out.horizons,...extended].map(h=>({...h,multiModel:adaptive?.horizons?.find(m=>m.days===h.days)||null})),now,modelVersion:'5.8-ensemble-research-analogue-locked',
  sourceUrl:historySource});
 // Display the locked forecast decision, without reinterpreting the historical analogues
 // as calibrated probabilities. Adaptation is applied only after a held-out skill check.
 for(const h of [...report.horizons,...report.advanced.extraHorizons]){
  const locked=ledgerReport.entries.find(e=>e.originDate===out.asOf&&e.days===h.days);
  if(locked)h.lockedForecast={direction:locked.predictedDirection,
   originallySuggestedDirection:locked.rawDirection||locked.predictedDirection,
   adaptedPositivePct:locked.adaptedPositivePct??null,
   learningApplied:!!locked.learningApplied,createdAt:locked.createdAt};
 }
 let professionalReport=null;
 try {
  professionalReport=professional.build({history:rows,adaptive,ledger:ledgerReport,
   fx:recentFx?fx:null,macro,cot,goldSpot:spot},now);
 }catch(e){
  failures.push('Professional v5.9 audit unavailable: '+String(e.message).slice(0,130));
  professionalReport={schemaVersion:1,version:'5.9',status:'unavailable',generatedAt:now.toISOString(),
   horizons:[],reason:'Verified research dependencies were unavailable; no invented model forecasts.'};
 }
 report.advanced.version='5.9';
 report.advanced.adaptive=adaptive;
 report.advanced.professional={
  version:'5.9',generatedAt:professionalReport.generatedAt,status:professionalReport.status,
  summary:professionalReport.summary||null,
  url:'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-professional-v59.json'
 };
 report.advanced.forecastJournal=ledgerReport.summary;
 report.advanced.predictionLearning=ledgerReport.learning;
 report.advanced.predictionHistory={version:'5.7',generatedAt:ledgerReport.generatedAt,
  url:'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-prediction-history-v57.json',
  recent:ledgerReport.entries.slice(-12).reverse()};
 // To protect the full historical record, write the ledger before its summary.
 // If the subsequent GitHub commit fails, the workflow retries by rereading main.
 const ledgerTemp=ledgerPath+'.tmp';
 fs.writeFileSync(ledgerTemp,JSON.stringify(ledgerReport,null,2)+'\n','utf8');
 fs.renameSync(ledgerTemp,ledgerPath);
 const folder=path.join(__dirname,'..','market-intelligence'),dest=path.join(folder,'gold-outlook-v54.json');
 fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n','utf8');
 const adaptivePath=path.join(folder,'gold-ensemble-v58.json');
 fs.writeFileSync(adaptivePath,JSON.stringify(adaptive||{
   schemaVersion:1,version:'5.8',generatedAt:now.toISOString(),status:'unavailable',
   reason:failures.find(x=>x.startsWith('Adaptive multi-model'))||'Historical evidence was not sufficient',
   horizons:[],disclaimers:['No data-driven forecast is available. Do not invent a price target.']
 },null,2)+'\n','utf8');
 const proPath=path.join(folder,'gold-professional-v59.json');
 fs.writeFileSync(proPath,JSON.stringify(professionalReport,null,2)+'\n','utf8');
 console.log(JSON.stringify({outlook:'gold-v5.4',status:report.status,history:out.historyCount,lastDate:out.asOf,
  advancedVersion:'5.9',professionalStatus:professionalReport.status,ensembleModels:adaptive?.horizons?.[0]?.models?.length||0,cotAvailable:cot.available,technicalRegime:technical.regime,
  predictionRecords:ledgerReport.summary.recorded,predictionSettled:ledgerReport.summary.resolved,
  direction7:out.horizons.find(x=>x.days===7)?.direction,validation7:out.horizons.find(x=>x.days===7)?.validation,
  current:report.current.usdOz,macro:macro.filter(x=>x.available).length,warnings:failures.length}));
}
if(require.main===module)main().catch(e=>{console.error('Gold outlook research unavailable:',e.message);process.exitCode=1});
module.exports={cleanHistory,model,analog,backtest,macroTrend,renderEvidence,deepResearch,isDate,percent};
