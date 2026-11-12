/* Daily Sri Lanka public-market collector. Run by free GitHub Actions in PUBLIC repo.
  Price sources: CSE chartData (undocumented public endpoint), World Bank API,
  Frankfurter USD/LKR reference rates. All can fail; reports never invent readings. */
'use strict';
const d=require('./data-core.cjs');
const ml=require('./ml-core.cjs');const journal=require('./journal.cjs');
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
async function fetchNews(){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),16000);try{const r=await fetch(SOURCES.news,{signal:ac.signal,headers:{'User-Agent':'SafnasFinanceResearch/3.4.6','Accept':'application/rss+xml,application/xml,text/xml'}});if(!r.ok)throw Error('Publisher HTTP '+r.status);return d.parseNewsRSS(await r.text())}finally{clearTimeout(timer)}}
async function fetchCSE(){const form=new FormData();form.append('chartId','1');form.append('period','5');return d.parseCSE(await json(SOURCES.aspi,{method:'POST',body:form}));}
async function fetchAllStock(){const form=new FormData();return d.parseStockSnapshot(await json(SOURCES.stocks,{method:'POST',body:form}));}
async function fetchSL20(){const raw=await json(SOURCES.sl20,{method:'POST',body:new FormData()});const v=Number(raw?.value??raw?.data?.value);if(!Number.isFinite(v)||v<=0)throw Error('S&P SL20 quote response unavailable');return {value:v,changePercent:Number.isFinite(Number(raw?.percentage))?Number(raw.percentage):null,retrievedAt:new Date().toISOString(),sourceURL:SOURCES.sl20,note:'Retrieved snapshot; source may not include a reliable trade date.'};}
async function fetchSummary(){const raw=await json(SOURCES.marketSummary,{method:'POST',body:new FormData()});const obj=Array.isArray(raw)?raw[0]:raw;const turnover=Number(obj?.equityTurnover??obj?.marketTurnover??obj?.turnover);if(!Number.isFinite(turnover)||turnover<=0)throw Error('Daily turnover not reported');return {turnover,retrievedAt:new Date().toISOString(),sourceURL:SOURCES.marketSummary,note:'Retrieved market summary; check official CSE for publication date.'};}
async function fetchWB(code){return d.parseWorldBank('LKA',code,await json(`https://api.worldbank.org/v2/country/LKA/indicator/${code}?format=json&per_page=35`));}
function marketReport(points,now=new Date()){
 const latest=d.newestDate(points);
 if(!points.length)return {available:false,asOf:null,reason:'No verified index observations available',points:[]};
 const model5=ml.trainAndValidate(points,5,now),model20=ml.trainAndValidate(points,20,now);
 return {available:!d.stale(latest,now),asOf:latest,close:points.at(-1).close,observations:points.length,points:points.slice(-65),model5,model20,quality5:d.reportQuality(model5),quality20:d.reportQuality(model20),source:'CSE public website API (undocumented; availability and reuse terms may change)',sourceURL:SOURCES.aspi,notice:d.stale(latest,now)?'Closing price older than 7 calendar days; do not treat as current.':null};
}
async function collect(now=new Date(),injected={}){
 const fetchPrice=injected.fetchCSE||fetchCSE,fetchMacro=injected.fetchWB||fetchWB,fetchForex=injected.fetchFx||(()=>json(SOURCES.fx)),fetchStocks=injected.fetchStocks||fetchAllStock;
 const previous=d.readJSON('latest.json',{}),errors=[];let series=d.readJSON('aspi-history.json',{points:[]}).points||[];
 let current=false;
 try{const recent=await fetchPrice();series=d.mergeSeries(series,recent);if(series.length<25)throw Error('Too few verified CSE dates');d.writeJSON('aspi-history.json',{source:SOURCES.aspi,lastCaptured:now.toISOString(),points:series});current=true;}catch(e){errors.push('ASPI provider unavailable: '+e.message)}
 const aspi=marketReport(series,now);
 if(!current){aspi.notice='No new exchange data this run. '+(aspi.notice||'Historical archive retained.');}
 const macro={};const indicators=[['gdpGrowth','NY.GDP.MKTP.KD.ZG'],['annualInflation','FP.CPI.TOTL.ZG'],['remittancesGDP','BX.TRF.PWKR.DT.GD.ZS'],['unemployment','SL.UEM.TOTL.ZS'],['currentAccountGDP','BN.CAB.XOKA.GD.ZS'],['exportsGDP','NE.EXP.GNFS.ZS']];
 await Promise.all(indicators.map(async ([name,code])=>{try{macro[name]=await fetchMacro(code)}catch(e){macro[name]=previous?.economy?.[name]||null;errors.push(name+' unavailable: '+e.message)}}));
 let forex=previous.forex||null;try{const readings=d.parseFx(await fetchForex());if(!readings.length)throw Error('No daily USD/LKR reference');forex={asOf:readings.at(-1).date,rate:readings.at(-1).rate,source:'Frankfurter blended published daily reference rates',sourceURL:SOURCES.fx};}catch(e){errors.push('FX unavailable: '+e.message)}
 let shares=[];try{shares=await fetchStocks()}catch(e){errors.push('Stock snapshots unavailable: '+e.message)}
 let sl20=null;try{sl20=await (injected.fetchSL20||fetchSL20)()}catch(e){errors.push('S&P SL20 snapshot unavailable: '+e.message)}
 let marketSummary=null;try{marketSummary=await (injected.fetchSummary||fetchSummary)()}catch(e){errors.push('Market turnover unavailable: '+e.message)}
 let headlines=previous.headlines||[];try{const found=await (injected.fetchNews||fetchNews)();if(!found.length)throw Error('Publisher RSS had no dated financial headlines');headlines=found}catch(e){errors.push('Publisher context unavailable: '+e.message)}
 const priorJournal=d.readJSON('prediction-journal.json',{entries:[]});const newJournal=journal.updateJournal(priorJournal.entries,series,{5:aspi.model5,20:aspi.model20},now);
 d.writeJSON('prediction-journal.json',newJournal);
 const snapshot={
  schemaVersion:1,generatedAt:now.toISOString(),status:aspi.available?'updated':'limited',
  market:{aspi,sl20,marketSummary},economy:macro,forex,shares,headlines,learning:{summary:newJournal.summary,recent:newJournal.entries.slice(-12)},
  sources:{cse:'https://www.cse.lk/',cbsl:'https://www.cbsl.gov.lk/en/statistics/economic-indicators/daily-indicators',worldbank:'https://api.worldbank.org/v2/country/LKA',fx:SOURCES.fx,sec:'https://www.sec.gov.lk/'},
  warnings:errors,disclaimer:'Educational market research only. Historical ML performance is not a reliable investment forecast. No specific security is recommended.'
 };
 d.writeJSON('latest.json',snapshot);
 console.log(JSON.stringify({status:snapshot.status,aspiDate:aspi.asOf,aspiRecords:aspi.observations,aspiModel:aspi.quality5?.status,macroLoaded:Object.keys(macro).filter(k=>macro[k]),stocks:shares.length,headlines:headlines.length,forecastOutcomes:newJournal.summary.resolved,warnings:errors.length}));
 return snapshot;
}
if(require.main===module){collect().catch(e=>{console.error('Collector crashed:',e.message);process.exitCode=1})}
module.exports={collect,marketReport,fetchCSE,fetchWB};
