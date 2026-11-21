'use strict';
/* Safnas Finance v5 evidence-based research publisher.
 * Generates a source-attributed public report from the verified v4 collector snapshot.
 * Does not require Cloud Functions, payment, credentials, or generative AI access.
 * Trading dates, individual company fundamentals and investment returns are never invented.
 */
const fs = require('node:fs');
const path = require('node:path');

const UNIVERSE = [
 ['DIAL.N0000','Dialog Axiata PLC','Telecommunications'],
 ['COMB.N0000','Commercial Bank of Ceylon PLC','Banks'],
 ['JKH.N0000','John Keells Holdings PLC','Diversified'],
 ['HNB.N0000','Hatton National Bank PLC','Banks'],
 ['SAMP.N0000','Sampath Bank PLC','Banks'],
 ['HAYL.N0000','Hayleys PLC','Industrials'],
 ['LOLC.N0000','LOLC Holdings PLC','Diversified'],
 ['CTC.N0000','Ceylon Tobacco Company PLC','Consumer'],
 ['DIST.N0000','Distilleries Company of Sri Lanka PLC','Consumer'],
 ['MELS.N0000','Melstacorp PLC','Diversified'],
 ['CARG.N0000','Cargills (Ceylon) PLC','Consumer'],
 ['SLTL.N0000','Sri Lanka Telecom PLC','Telecommunications'],
 ['HHL.N0000','Hemas Holdings PLC','Diversified'],
 ['NDB.N0000','National Development Bank PLC','Banks'],
 ['TKYO.N0000','Tokyo Cement Company (Lanka) PLC','Industrials'],
 ['LFIN.N0000','LB Finance PLC','Banks']
];
const TOPICS = [
 ['Interest rates',/\b(interest rates?|policy rates?|central bank|monetary policy|rate cuts?|rate hikes?)\b/i,
  'Interest rates can affect bank margins, borrowing costs and demand; company effects are unverified.'],
 ['Inflation',/\b(inflation|consumer prices?|cpi)\b/i,
  'Inflation may affect spending and input costs; no specific price reaction is established.'],
 ['Currency',/\b(rupee|exchange rates?|currency|forex|usd|lkr)\b/i,
  'Currency changes can affect importers, exporters and foreign-currency debts.'],
 ['Earnings',/\b(quarterly|earnings|financial results|profit|revenue)\b/i,
  'Company results require original financial disclosures before drawing valuation conclusions.'],
 ['Regulation',/\b(regulation|tax(es)?|vat|levy|tariff|duties)\b/i,
  'Policy changes may affect costs and demand; direction and magnitude require verification.']
];
function isDate(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const t=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===value;
}
function secureUrl(value) {
 try {const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}
}
function daysOld(date,now) {
 return isDate(date)?Math.floor((Date.parse(now.toISOString().slice(0,10)+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000):null;
}
const round=(v,n=2)=>Number.isFinite(v)?Number(v.toFixed(n)):null;
function buildResearch(snapshot, now=new Date()) {
 if(!snapshot||snapshot.schemaVersion!==1||!Number.isFinite(Date.parse(snapshot.generatedAt))) {
  throw Error('A valid CSE collector latest.json (schemaVersion 1) is required');
 }
 const sourceAgeHours=(now-Date.parse(snapshot.generatedAt))/3600000;
 const collectorRecent=sourceAgeHours>=0&&sourceAgeHours<=48;
 const evidence=[],findings=[];
 const rawPoints=Array.isArray(snapshot.market?.aspi?.points)?snapshot.market.aspi.points:[];
 const byDate=new Map();
 for(const p of rawPoints){
  if(isDate(p?.date)&&p.date<=now.toISOString().slice(0,10)&&Number.isFinite(p.close)&&p.close>0)
   byDate.set(p.date,{date:p.date,close:p.close});
 }
 const points=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
 const last=points.at(-1),previous=points.at(-2);
 const asOf=last?.date||null,age=asOf?daysOld(asOf,now):null;
 const current=last&&age>=0&&age<=7&&collectorRecent;
 const change=last&&previous?round((last.close/previous.close-1)*100):null;
 const avg20=points.length>=20?round(points.slice(-20).reduce((a,p)=>a+p.close,0)/20):null;
 const volReturns=[];
 for(let i=Math.max(1,points.length-20);i<points.length;i++)volReturns.push(Math.log(points[i].close/points[i-1].close));
 const mean=volReturns.length?volReturns.reduce((a,b)=>a+b,0)/volReturns.length:0;
 const vol=volReturns.length>=15?round(Math.sqrt(volReturns.reduce((sum,v)=>sum+(v-mean)**2,0)/(volReturns.length-1))*Math.sqrt(252)*100):null;
 const model5=snapshot.market?.aspi?.model5,model20=snapshot.market?.aspi?.model20;
 const market={status:last?(current?'current':'stale'):'unavailable',asOf,ageDays:age,
  close:current?round(last.close):null,lastObservedClose:last?round(last.close):null,
  changePct:current?change:null,average20:current?avg20:null,annualizedHistoricalVolatilityPct:current?vol:null,
  observations:points.length,modelAudit:{edgeDemonstrated:!!(model5?.edgeDemonstrated||model20?.edgeDemonstrated),
    audit5:!!model5?.ok,audit20:!!model20?.ok,journalResolved:Number(snapshot.learning?.summary?.resolved)||0,
    notice:'Backtesting does not establish reliable future prediction.'}};
 if(last){
  evidence.push({id:'aspi',label:'ASPI dated observations · CSE',url:secureUrl(snapshot.market?.aspi?.sourceURL||'https://www.cse.lk/'),
    asOf,kind:'dated_market_observation'});
  findings.push(current?{id:'aspi',tone:'neutral',title:change===null?'Latest observed ASPI close':change>=0?'ASPI increased in the last recorded session':'ASPI decreased in the last recorded session',
   detail:'Verified close '+round(last.close)+' on '+asOf+(change!==null?' ('+(change>=0?'+':'')+change+'% versus previous close).':'.'),
   evidenceIds:['aspi']}:{id:'aspi-stale',tone:'warning',title:'Recent verified ASPI prices unavailable',
   detail:'Last dated ASPI observation '+asOf+'. New price changes are not asserted.',evidenceIds:['aspi']});
  if(current&&avg20!==null)findings.push({id:'avg20',tone:'info',title:'Historical 20-session checkpoint',
   detail:'The latest ASPI close is '+(last.close>=avg20?'above':'below')+' its 20-session average of '+avg20+'. This does not predict future returns.',evidenceIds:['aspi']});
 }else findings.push({id:'aspi-missing',tone:'warning',title:'No validated ASPI closes',detail:'Market direction cannot be evaluated.',evidenceIds:[]});
 if(!collectorRecent)findings.unshift({id:'feed-old',tone:'warning',title:'Research source has not refreshed recently',
  detail:'The previous collector snapshot is older than 48 hours; results below are historical.',evidenceIds:[]});
 const news=[];
 for(const item of Array.isArray(snapshot.headlines)?snapshot.headlines:[]){
  const title=String(item?.title||'').replace(/\s+/g,' ').trim().slice(0,180);
  const url=secureUrl(item?.url),date=String(item?.date||'').slice(0,10);
  const ageDays=daysOld(date,now);
  if(!title||!url||!isDate(date)||ageDays===null||ageDays<0||ageDays>7||news.some(x=>x.url===url))continue;
  const topic=TOPICS.find(t=>t[1].test(title));
  const id='news-'+(news.length+1);
  news.push({id,title,url,date,publisher:item.publisher||'EconomyNext',topics:topic?[topic[0]]:[],
    impactNote:topic?topic[2]:'Relevant headline recorded. Financial impact is not verified.'});
  evidence.push({id,label:'Publisher headline · '+title.slice(0,90),url,asOf:date,kind:'dated_headline'});
  if(news.length>=7)break;
 }
 const matched=news.filter(x=>x.topics.length);
 if(matched.length)findings.push({id:'news-topics',tone:'info',title:matched.length+' headlines matched economic research topics',
  detail:'Topic matching identifies subjects to investigate; it cannot confirm causation or returns.',evidenceIds:matched.slice(0,3).map(x=>x.id)});
 if(!news.length)findings.push({id:'no-news',tone:'warning',title:'No recent verified publisher headlines',
  detail:'No valid dated news articles were available within seven days.',evidenceIds:[]});
 const shareMap=new Map();
 for(const s of Array.isArray(snapshot.shares)?snapshot.shares:[]){
  if(typeof s?.ticker==='string'&&Number.isFinite(s.price)&&s.price>0)
   shareMap.set(s.ticker.toUpperCase(),s);
 }
 if(shareMap.size)evidence.push({id:'cse-shares',label:'Undated CSE share quote snapshots',url:'https://www.cse.lk/',asOf:null,kind:'undated_quote_snapshot'});
 const companies=UNIVERSE.map(([ticker,name,sector])=>{
  const entry=shareMap.get(ticker);
  const related=news.filter(x=>x.title.toLowerCase().includes(name.split(' ')[0].toLowerCase())||
    ticker==='DIAL.N0000'&&/\bdialog\b/i.test(x.title));
  return {ticker,name,sector,
   quote:entry?{value:round(entry.price),currency:'LKR',asOf:null,verifiedTradeDate:false,
     retrievedAt:snapshot.generatedAt,sourceId:'cse-shares'}:null,
   recentHeadlines:related.slice(0,2).map(x=>x.id),
   fundamentals:{status:'not_available',reason:'Original company financial statements have not been verified by the collector.'},
   researchStatus:related.length?'has_dated_headlines':entry?'indicative_quote_only':'company_directory_only'};
 });
 const macro=[];
 for(const [key,indicator] of Object.entries(snapshot.economy||{})){
  const p=(Array.isArray(indicator?.points)?indicator.points:[]).filter(x=>/^\d{4}$/.test(String(x.year))&&Number.isFinite(x.value)).sort((a,b)=>String(a.year).localeCompare(String(b.year))).at(-1);
  if(!p)continue;
  const id='macro-'+key.replace(/[^a-z0-9]/gi,'').toLowerCase();
  macro.push({key,year:String(p.year),value:round(p.value,3),period:'annual',sourceId:id});
  evidence.push({id,label:'World Bank indicator · '+key,url:secureUrl(indicator.sourceURL||indicator.source||'https://data.worldbank.org/country/sri-lanka'),
   asOf:null,kind:'annual_statistic'});
  if(macro.length>=12)break;
 }
 const status=current?'research_available':'limited';
 return {schemaVersion:5,engineVersion:'5.0.2',generatedAt:now.toISOString(),
  sourceSnapshotAt:snapshot.generatedAt,status,
  briefing:{title:'Sri Lanka · Autonomous Market Brief',
   summary:current?'Automatically compiled from dated historical observations and published news. Assess linked evidence for each finding.':
   'Partial or older market evidence. No up-to-date market prediction is asserted.',
   findings:findings.slice(0,8)},
  market,news,companies,macro,evidence,
  quality:{market:market.status,collector:collectorRecent?'recent':'outdated',indexedCompanies:companies.length,
   indicativeCompanyQuotes:companies.filter(x=>x.quote).length,sourceLinks:evidence.filter(x=>x.url).length,
   knownGaps:['CSE company share snapshots may not be available or dated','Current company financial statements have not been verified','No live brokerage integration'],
   sourceWarnings:(Array.isArray(snapshot.warnings)?snapshot.warnings:[]).slice(0,8).map(x=>String(x).slice(0,140))},
  ai:{status:'not_configured',explanations:[],
   notice:'Evidence-based research is automated and free. Generative English/Tamil synthesis requires a separately configured provider and may cost money.'},
  disclaimer:'Educational market research only. No orders, promises of return, individualized buy/sell advice or invented financial figures.'};
}
function publish() {
 const directory=path.join(__dirname,'..','market-intelligence');
 const latest=JSON.parse(fs.readFileSync(path.join(directory,'latest.json'),'utf8'));
 const report=buildResearch(latest,new Date());
 const destination=path.join(directory,'research-v5.json');
 const temp=destination+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(report,null,2)+'\n');
 fs.renameSync(temp,destination);
 console.log(JSON.stringify({researchVersion:report.engineVersion,status:report.status,generatedAt:report.generatedAt,
  aspiDate:report.market.asOf,companies:report.companies.length,companyQuotes:report.quality.indicativeCompanyQuotes,
  articles:report.news.length,sourceEvidence:report.evidence.length}));
 return report;
}
if(require.main===module){try{publish();}catch(err){console.error('Research v5 publication failed:',err.message);process.exitCode=1;}}
module.exports={buildResearch,publish,isDate,daysOld,secureUrl};
