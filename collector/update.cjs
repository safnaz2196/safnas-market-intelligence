/* Daily Sri Lanka public-market collector. Run by free GitHub Actions in PUBLIC repo.
  Price sources: CSE chartData (undocumented public endpoint), World Bank API,
  Frankfurter USD/LKR reference rates. All can fail; reports never invent readings. */
'use strict';
const d=require('./data-core.cjs');
const ml=require('./ml-core.cjs');const journal=require('./journal.cjs');const intelligence=require('./intelligence-core.cjs');const reliable=require('./reliability-core.cjs');
const SOURCES={
 aspi:'https://www.cse.lk/api/chartData',
 worldbank:'https://api.worldbank.org/v2/',
 fx:'https://api.frankfurter.dev/v2/rates?base=USD&quotes=LKR',
 stocks:'https://www.cse.lk/api/allStock',
 sl20:'https://www.cse.lk/api/snpData',
 marketSummary:'https://www.cse.lk/api/marketSummery',
 news:'https://economynext.com/feed/'
};
async function json(url,options={}){
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),22000);
 try{const response=await fetch(url,{...options,signal:ac.signal,headers:{'Accept':'application/json','User-Agent':'SafnasFinanceMarketResearch/3.4.6 (public educational snapshot)',...options.headers}});
 if(!response.ok)throw Error(`HTTP ${response.status}`);
 return await response.json();}finally{clearTimeout(timer)}
}
async function retryJson(url,attempts=2){let error;for(let i=0;i<attempts;i++){try{return await json(url)}catch(e){error=e;if(i+1<attempts)await new Promise(r=>setTimeout(r,450*(i+1)))}}throw error;}
async function fetchNews(){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),16000);try{const r=await fetch(SOURCES.news,{signal:ac.signal,headers:{'User-Agent':'SafnasFinanceResearch/3.4.6','Accept':'application/rss+xml,application/xml,text/xml'}});if(!r.ok)throw Error('Publisher HTTP '+r.status);return d.parseNewsRSS(await r.text())}finally{clearTimeout(timer)}}
async function fetchCSE(){const form=new FormData();form.append('chartId','1');form.append('period','5');return d.parseCSE(await json(SOURCES.aspi,{method:'POST',body:form}));}
async function fetchAllStock(){const form=new FormData();return d.parseStockSnapshot(await json(SOURCES.stocks,{method:'POST',body:form}));}
async function fetchSL20(){const raw=await json(SOURCES.sl20,{method:'POST',body:new FormData()});const v=Number(raw?.value??raw?.data?.value);if(!Number.isFinite(v)||v<=0)throw Error('S&P SL20 quote response unavailable');return {value:v,changePercent:Number.isFinite(Number(raw?.percentage))?Number(raw.percentage):null,retrievedAt:new Date().toISOString(),sourceURL:SOURCES.sl20,note:'Retrieved snapshot; source may not include a reliable trade date.'};}
async function fetchSummary(){const raw=await json(SOURCES.marketSummary,{method:'POST',body:new FormData()});const obj=Array.isArray(raw)?raw[0]:raw;const turnover=Number(obj?.equityTurnover??obj?.marketTurnover??obj?.turnover);if(!Number.isFinite(turnover)||turnover<=0)throw Error('Daily turnover not reported');return {turnover,retrievedAt:new Date().toISOString(),sourceURL:SOURCES.marketSummary,note:'Retrieved market summary; check official CSE for publication date.'};}
async function fetchWBBulk(){
 const codes=Object.values(reliable.WORLD_BANK_CODES).join(';');
 const url='https://api.worldbank.org/v2/country/LKA/indicator/'+codes+'?source=2&format=json&per_page=900';
 return reliable.parseWorldBankBulk(await retryJson(url,2));
}
async function fetchWB(code){return d.parseWorldBank('LKA',code,await retryJson(`https://api.worldbank.org/v2/country/LKA/indicator/${code}?format=json&per_page=35`,2));}
function marketReport(points,now=new Date()){
 const latest=d.newestDate(points);
 if(!points.length)return {available:false,asOf:null,reason:'No verified index observations available',points:[]};
 const model5=ml.trainAndValidate(points,5,now),model20=ml.trainAndValidate(points,20,now);
 return {available:!d.stale(latest,now),asOf:latest,close:points.at(-1).close,observations:points.length,points:points.slice(-65),model5,model20,quality5:d.reportQuality(model5),quality20:d.reportQuality(model20),source:'CSE public website API (undocumented; availability and reuse terms may change)',sourceURL:SOURCES.aspi,notice:d.stale(latest,now)?'Closing price older than 7 calendar days; do not treat as current.':null};
}
async function collect(now=new Date(),injected={}){
 const getPrice=injected.fetchCSE||fetchCSE,getWB=injected.fetchWB||fetchWB,getBulk=injected.fetchWBBulk||fetchWBBulk,
       getFx=injected.fetchFx||(()=>json(SOURCES.fx)),getStocks=injected.fetchStocks||fetchAllStock;
 const read=injected.readJSON||d.readJSON,write=injected.writeJSON||d.writeJSON;
 const old=read('latest.json',{}),oldHealth=read('source-health.json',{}),errors=[],health={};
 const nowISO=now.toISOString();
 const record=(code,success,asOf,reason='',extra={})=>{
  health[code]=reliable.sourceHealth(oldHealth,code,{success,asOf,now,reason,...extra});
  if(!success&&reason)errors.push(code+': '+String(reason).slice(0,130));
 };
 let series=d.standardize(read('aspi-history.json',{points:[]}).points||[]),gotCSE=false;
 try{
  const newRows=reliable.validatePriceSample(await getPrice(),series,now);
  series=d.mergeSeries(series,newRows);gotCSE=true;
  write('aspi-history.json',{source:SOURCES.aspi,lastCaptured:nowISO,historyLimit:'CSE free endpoint offers about one trailing year; archive expands only with verified dated observations.',points:series});
  record('aspi',true,d.newestDate(series),'',{notes:'CSE daily closes validated and appended to dated archive'});
 }catch(e){record('aspi',false,d.newestDate(series),e.message)}
 const aspi=marketReport(series,now);
 if(!gotCSE)aspi.notice='CSE did not supply a verified sample this run. Historical archive retained; do not confuse cached data with a new observation.';
 const macro={...old.economy},bulkKeys=new Set();let macroFromProvider=0,bulkError=null;
 try{
  const fetched=await getBulk();
  for(const [key,row] of Object.entries(fetched)){macro[key]=row;bulkKeys.add(key);macroFromProvider++;}
 }catch(e){bulkError=e.message;}
 for(const [name,code] of Object.entries(reliable.WORLD_BANK_CODES)){
  if(bulkKeys.has(name))continue;
  try{macro[name]=await getWB(code);macroFromProvider++;}
  catch(e){if(!macro[name])macro[name]=null;errors.push('World Bank '+name+': '+String(e.message).slice(0,75));}
 }
 const availableMacro=Object.values(macro).filter(x=>x&&Array.isArray(x.points)&&x.points.length);
 const macroDate=availableMacro.map(x=>x.asOf).filter(x=>/^\d{4}$/.test(String(x))).sort().at(-1)||null;
 record('macro',macroFromProvider>0,macroDate,macroFromProvider?'':(bulkError||'World Bank indicators unavailable'),{observationYear:true,freshWindowDays:3,notes:macroFromProvider+' of 6 annual indicators refreshed'});
 let forex=old.forex||null;
 try{
  const dates=d.parseFx(await getFx()).filter(x=>x.date<=nowISO.slice(0,10));
  if(!dates.length)throw Error('No dated exchange observations');
  const item=dates.at(-1);forex={asOf:item.date,rate:item.rate,source:'Frankfurter daily FX reference',sourceURL:SOURCES.fx};
  record('forex',true,item.date);
 }catch(e){record('forex',false,forex?.asOf||null,e.message)}
 let shares=[];
 try{
  shares=await getStocks();if(!shares.length)throw Error('No valid listed share quotes');
  record('shares',true,nowISO.slice(0,10),'',{dateIsRetrieved:true,notes:'Quotes retrieved; official trading date not verified'});
 }catch(e){record('shares',false,null,e.message)}
 let sl20=null;
 try{
  sl20=await (injected.fetchSL20||fetchSL20)();
  record('sl20',true,nowISO.slice(0,10),'',{dateIsRetrieved:true,notes:'Index snapshot retrieved; official trade date not verified'});
 }catch(e){record('sl20',false,null,e.message)}
 let marketSummary=null;
 try{
  marketSummary=await (injected.fetchSummary||fetchSummary)();
  record('turnover',true,nowISO.slice(0,10),'',{dateIsRetrieved:true,notes:'Turnover snapshot retrieved; official trade date not verified'});
 }catch(e){record('turnover',false,null,e.message)}
 let headlines=old.headlines||[];
 try{
  const latest=await (injected.fetchNews||fetchNews)();if(!latest.length)throw Error('No dated publisher headlines');
  headlines=latest;record('headlines',true,headlines.map(x=>x.date).sort().at(-1));
 }catch(e){record('headlines',false,headlines.map(x=>x.date).sort().at(-1)||null,e.message)}
 const prior=read('prediction-journal.json',{entries:[]});
 const journalResult=journal.updateJournal(prior.entries,series,{5:aspi.model5,20:aspi.model20},now);
 write('prediction-journal.json',journalResult);
 const macroEvidence=intelligence.macroAudit(macro,now.getUTCFullYear());
 const snapshot={
  schemaVersion:1,engineVersion:'4.0',advancedModels:['logit','patterns','blend','forest','boost'],generatedAt:nowISO,
  status:gotCSE&&aspi.available?'updated':aspi.available?'partial':'limited',
  market:{aspi,sl20,marketSummary,regime:intelligence.marketRisk(series,now)},economy:macro,forex,shares,headlines,
  evidence:{macro:macroEvidence,companies:intelligence.companyCoverage(shares),
   sources:intelligence.sourceAudit({aspi,macro:macroEvidence,forex,shares,sl20,marketSummary,headlines})},
  sourceHealth:health,learning:{summary:journalResult.summary,recent:journalResult.entries.slice(-12)},
  sources:{cse:'https://www.cse.lk/',cbsl:'https://www.cbsl.gov.lk/en/statistics/economic-indicators/daily-indicators',
   worldbank:'https://api.worldbank.org/v2/country/LKA',fx:SOURCES.fx,sec:'https://www.sec.gov.lk/'},
  warnings:errors,disclaimer:'Educational research only. Reliable data collection does not establish predictive skill or guarantee returns. No specific security is recommended.'
 };
 snapshot.reliability=reliable.overallQuality(snapshot,now);
 write('source-health.json',health);
 write('latest.json',snapshot);
 console.log(JSON.stringify({engine:'4.0',status:snapshot.status,aspiAsOf:aspi.asOf,aspiCloses:aspi.observations,
  model5:aspi.quality5?.status,model20:aspi.quality20?.status,annualIndicators:macroEvidence.available,
  datedSources:snapshot.reliability.currentSources,retrievedOnly:snapshot.reliability.retrievedOnlySources,
  forecastOutcomes:journalResult.summary.resolved,warnings:errors.length}));
 return snapshot;
}
if(require.main===module){collect().catch(e=>{console.error('Collector crashed:',e.message);process.exitCode=1})}
module.exports={collect,marketReport,fetchCSE,fetchWB,fetchWBBulk};
