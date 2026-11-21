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
 // Cross-feed consistency: market turnover must be supported by the latest
 // dated CSE observation, never inferred from an older warning or retrieval time.
 const turnoverRaw=snapshot.market?.marketSummary;
 const turnoverDate=turnoverRaw?.asOf;
 const turnoverAmount=Number(turnoverRaw?.turnover);
 const turnoverAge=daysOld(turnoverDate,now);
 const turnoverVerified=turnoverRaw?.verifiedTradeDate===true&&
  turnoverRaw?.currency==='LKR'&&Number.isFinite(turnoverAmount)&&
  turnoverAmount>0&&turnoverAge!==null&&turnoverAge>=0&&turnoverAge<=7&&collectorRecent;
 const marketTurnover=turnoverVerified?{
  valueLKR:turnoverAmount,asOf:turnoverDate,status:'dated_observation',
  sourceURL:secureUrl(turnoverRaw?.sourceURL||'https://www.cse.lk/'),
  sharesTraded:Number.isFinite(turnoverRaw?.sharesTraded)?turnoverRaw.sharesTraded:null,
  tradeCount:Number.isFinite(turnoverRaw?.trades)?turnoverRaw.trades:null,
  notice:'CSE daily market equity turnover, recorded at the stated trade date. Not live streaming.'
 }:{status:'unavailable',asOf:isDate(turnoverDate)?turnoverDate:null,
  notice:'No currently verified dated CSE turnover figure in the research source.'};
 market.turnover=marketTurnover;
 if(turnoverVerified) {
  evidence.push({id:'cse-turnover',label:'Official daily CSE market turnover · LKR',
   url:marketTurnover.sourceURL,asOf:turnoverDate,kind:'dated_market_turnover'});
  findings.push({id:'cse-turnover',tone:'info',title:'Verified CSE daily market turnover',
   detail:'LKR '+new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(turnoverAmount)+
    ' traded in the recorded session on '+turnoverDate+'. This measures market activity, not market direction.',
   evidenceIds:['cse-turnover']});
 }
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
function mergeCompanyEvidence(report, marketEvidence, now=new Date()) {
 if(!marketEvidence||marketEvidence.schemaVersion!==1||
    !Array.isArray(report?.companies)||!marketEvidence.companies)return report;
 const generated=Date.parse(marketEvidence.generatedAt),ageHours=(now.getTime()-generated)/3600000;
 if(!Number.isFinite(ageHours)||ageHours<0||ageHours>96){
  report.quality.sourceWarnings.push('Company evidence is older than four days; outdated quotations withheld.');
  return report;
 }
 const ids=new Set(report.evidence.map(x=>x.id));
 let quotes=0,facts=0,filings=0;
 for(const company of report.companies) {
  const source=marketEvidence.companies[company.ticker];if(!source)continue;
  const q=source.quote;
  if(q&&q.verifiedTradeDate===true&&isDate(q.asOf)&&Number.isFinite(q.value)&&q.value>0) {
   company.quote={...q};quotes++;
   const id='trade-'+company.ticker;
   if(!ids.has(id)) {
    report.evidence.push({id,label:company.name+' · CSE last recorded trade',url:'https://www.cse.lk/',
     asOf:q.asOf,kind:'dated_company_price'});
    ids.add(id);
   }
  }else if(source.indicativePrice?.value>0){company.indicativePrice={...source.indicativePrice};}
  const st=source.facts;
  if(st&&typeof st==='object') {
   company.marketStats={high52Week:st.high52Week,low52Week:st.low52Week,isin:st.isin,
    sharesIssued:st.sharesIssued,marketCapLKR:st.marketCapLKR,betaASPI:st.betaASPI,
    retrievedAt:st.retrievedAt,sourceUrl:st.sourceUrl};
   facts++;
  }
  company.filings=[];
  for(const [index,item] of (Array.isArray(source.filings)?source.filings:[]).entries()) {
   const url=secureUrl(item.url),published=isDate(item.published)?item.published:null;
   if(!url||new URL(url).hostname!=='cdn.cse.lk'||!/^cmt\/upload_report_file\/.+\.pdf$/i.test(new URL(url).pathname.slice(1)))continue;
   const id='filing-'+company.ticker+'-'+index;
   company.filings.push({title:String(item.title).slice(0,160),url,published,sourceId:id,kind:item.kind});
   if(!ids.has(id)) {
    report.evidence.push({id,label:company.name+' · '+String(item.title).slice(0,100),url,
     asOf:published,kind:'cse_company_filing'});
    ids.add(id);
   }
  }
  if(company.filings.length)filings++;
  if(company.quote||company.filings.length||company.marketStats)company.researchStatus='verified_public_market_metadata';
 }
 report.engineVersion='5.3.0';
 report.quality.indicativeCompanyQuotes=quotes;
 report.quality.verifiedCompanyQuotes=quotes;
 report.quality.companyFacts=facts;
 report.quality.companyFilings=filings;
 report.quality.sourceLinks=report.evidence.filter(x=>secureUrl(x.url)).length;
 report.quality.companyEvidenceAt=marketEvidence.generatedAt;
 report.quality.sourceWarnings=[...new Set([...(report.quality.sourceWarnings||[]).filter(w=>!(quotes>0&&/^shares:\s*HTTP 400/i.test(String(w)))),
    ...(marketEvidence.issues||[]).filter(x=>!String(x).startsWith('companyInfoSummery'))])].slice(0,9);
 if(quotes)report.quality.knownGaps=report.quality.knownGaps.filter(x=>!x.includes('share snapshots'));
 report.briefing.findings.push({id:'company-coverage',tone:quotes?'info':'warning',
  title:quotes+' of '+report.companies.length+' tracked companies have dated exchange quotations',
  detail:'CSE last-traded prices, 52-week ranges and filings are observed where the exchange provides them; they are not streaming prices or trading advice.',
  evidenceIds:report.evidence.filter(x=>x.kind==='dated_company_price').slice(0,3).map(x=>x.id)});
 return report;
}
function publish() {
 const directory=path.join(__dirname,'..','market-intelligence');
 const latest=JSON.parse(fs.readFileSync(path.join(directory,'latest.json'),'utf8'));
 const report=buildResearch(latest,new Date());
 try {
  const companyFile=path.join(directory,'company-evidence-v5.json');
  if(fs.existsSync(companyFile))mergeCompanyEvidence(report,JSON.parse(fs.readFileSync(companyFile,'utf8')));
 } catch(e) {report.quality.sourceWarnings.push('Company evidence could not be verified: '+String(e.message).slice(0,90));}
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
module.exports={buildResearch,mergeCompanyEvidence,publish,isDate,daysOld,secureUrl};
