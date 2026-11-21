'use strict';
/* Safnas Finance — FREE CSE company evidence, sourced from official public CSE endpoints.
   Quote is last traded price, NOT guaranteed live streaming. No trade recommendations.
   Runs only on GitHub Actions; never requires Firebase Blaze or a browser to remain open. */
const fs=require('node:fs');
const path=require('node:path');
const ROOT='https://www.cse.lk/api/';
const CODES=['DIAL.N0000','COMB.N0000','JKH.N0000','HNB.N0000','SAMP.N0000','HAYL.N0000',
 'LOLC.N0000','CTC.N0000','DIST.N0000','MELS.N0000','CARG.N0000','SLTL.N0000',
 'HHL.N0000','NDB.N0000','TKYO.N0000','LFIN.N0000'];
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const val=x=>{const n=Number(x);return Number.isFinite(n)&&n>0?n:null};
const pct=x=>{const n=Number(x);return Number.isFinite(n)&&Math.abs(n)<=200?n:null};
const safe=v=>String(v??'').replace(/\s+/g,' ').trim().slice(0,180);
function lankaDate(time){
 const n=Number(time);if(!Number.isFinite(n)||n<1483228800000||n>Date.now()+3600000)return null;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(n));
 const get=k=>parts.find(p=>p.type===k)?.value;
 return get('year')+'-'+get('month')+'-'+get('day');
}
function validDay(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function quoteFromTrade(row,stamp=new Date()){
 if(!row||!CODES.includes(row.symbol))return null;
 const price=val(row.price),asOf=lankaDate(row.lastTradedTime);
 if(!price||!asOf||asOf>stamp.toISOString().slice(0,10))return null;
 const previousClose=val(row.previousClose);
 const calculatedChange=previousClose?Number(((price/previousClose-1)*100).toFixed(3)):null;
 return {value:price,currency:'LKR',asOf,verifiedTradeDate:true,retrievedAt:stamp.toISOString(),
   sourceUrl:ROOT+'tradeSummary',source:'CSE trade summary',
   previousClose,changePct:calculatedChange,volume:val(row.sharevolume),trades:val(row.tradevolume),
   turnoverLKR:val(row.turnover),marketCapLKR:val(row.marketCap),
   high:val(row.high),low:val(row.low),marketStatus:'last traded (may be prior session)'};
}
function factsFromSummary(raw){
 if(!raw||typeof raw!=='object')return null;
 const s=raw.reqSymbolInfo||{};
 const hi=val(s.p12HiPrice),lo=val(s.p12LowPrice);
 const beta=Number(raw.reqSymbolBetaInfo?.triASIBetaValue);
 return {high52Week:hi,low52Week:lo,isin:typeof s.isin==='string'&&/^LK[A-Z0-9]{8,}$/.test(s.isin)?s.isin:null,
   sharesIssued:val(s.quantityIssued),marketCapLKR:val(s.marketCap),
   betaASPI:Number.isFinite(beta)&&Math.abs(beta)<20?beta:null,
   reportedLastTradedPrice:val(s.lastTradedPrice),sourceUrl:ROOT+'companyInfoSummery',
   retrievedAt:new Date().toISOString()};
}
function pdfUrl(text) {
 if(typeof text!=='string')return null;
 const clean=text.replace(/^\/+/,'');
 if(!/^cmt\/upload_report_file\/[a-zA-Z0-9_.-]+\.pdf(?:\?.*)?$/i.test(clean))return null;
 return 'https://cdn.cse.lk/'+clean.split('?')[0];
}
function filingDate(row){
 const str=String(row.uploadedDate||row.authorizedDate||'');
 const time=Date.parse(str);
 return Number.isFinite(time)&&time<Date.now()+86400000?new Date(time).toISOString().slice(0,10):null;
}
function filingsFromRows(rows,ticker){
 const code=ticker.split('.')[0],result=[],seen=new Set();
 for(const row of rows){
  const symbol=safe(row?.symbol).toUpperCase();
  if(symbol!==code&&symbol!==ticker)continue;
  const url=pdfUrl(row?.path),title=safe(row?.fileText);
  if(!url||!title||seen.has(url))continue;
  seen.add(url);
  result.push({title,url,published:filingDate(row),kind:/annual report/i.test(title)?'annual_report':'interim_or_other_report',
   source:'CSE official financial announcement',companyName:safe(row?.name)});
 }
 return result.sort((a,b)=>String(b.published||'').localeCompare(String(a.published||''))).slice(0,5);
}
async function request(endpoint,query='',timeoutMs=11000){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeoutMs);
 try{
  const r=await fetch(ROOT+endpoint+query,{method:'POST',body:new FormData(),signal:abort.signal,
   headers:{'Accept':'application/json','User-Agent':'Mozilla/5.0 (compatible; SafnasFinanceResearch/5.3)','Referer':'https://www.cse.lk/'}});
  if(!r.ok)throw Error('HTTP '+r.status);
  const body=await r.json();
  if(!body||typeof body!=='object')throw Error('Unexpected response');
  return body;
 }finally{clearTimeout(timer)}
}
async function run(now=new Date(),transport=request){
 const issues=[],sources={};
 const attempt=async(endpoint,query='')=>{
  try{const data=await transport(endpoint,query);sources[endpoint]='ok';return data}
  catch(e){sources[endpoint]='unavailable';issues.push(endpoint+': '+String(e.message).slice(0,90));return null}
 };
 const trades=await attempt('tradeSummary');
 const rows=Array.isArray(trades?.reqTradeSummery)?trades.reqTradeSummery:[];
 const tradeMap=new Map(rows.filter(x=>CODES.includes(x.symbol)).map(x=>[x.symbol,x]));
 const filings=await attempt('getFinancialAnnouncement');
 const filingsRows=Array.isArray(filings?.reqFinancialAnnouncemnets)?filings.reqFinancialAnnouncemnets:[];
 const companies={};
 for(const ticker of CODES){
  companies[ticker]={ticker,quote:quoteFromTrade(tradeMap.get(ticker),now),facts:null,
   filings:filingsFromRows(filingsRows,ticker),dataAsOf:now.toISOString()};
 }
 // The official summary offers 52-week range, market capitalization and share count.
 // Serial low-frequency calls avoid hammering CSE. This is still <25 calls/day.
 for(const ticker of CODES){
  const payload=await attempt('companyInfoSummery','?symbol='+encodeURIComponent(ticker));
  const info=payload?.reqSymbolInfo;
  if(!info||info.symbol!==ticker)continue;
  const facts=factsFromSummary(payload);
  companies[ticker].facts=facts;
  if(!companies[ticker].quote && val(info.lastTradedPrice)) {
   // CSE companyInfoSummery does not establish a confirmed trading date:
   // do not silently relabel this price as today's last traded quote.
   companies[ticker].indicativePrice={value:val(info.lastTradedPrice),currency:'LKR',
    asOf:null,verifiedTradeDate:false,source:'CSE company summary (undated)',
    sourceUrl:ROOT+'companyInfoSummery',retrievedAt:now.toISOString()};
  }
 }
 const quoteCount=Object.values(companies).filter(x=>x.quote).length;
 const factsCount=Object.values(companies).filter(x=>x.facts).length;
 const filingCompanies=Object.values(companies).filter(x=>x.filings.length).length;
 const status=quoteCount>=1?'observed':'limited';
 const report={schemaVersion:1,generatedAt:now.toISOString(),status,source:'Colombo Stock Exchange public market and document endpoints',
  sources,issues:[...new Set(issues)].slice(0,8),coverage:{universe:CODES.length,quotes:quoteCount,companyFacts:factsCount,filingCompanies},companies};
 const folder=path.join(__dirname,'..','market-intelligence');
 fs.writeFileSync(path.join(folder,'company-evidence-v5.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({CSECompanyEvidence:status,coverage:report.coverage,issues:report.issues}));
 return report;
}
if(require.main===module)run().catch(e=>{console.error('Company evidence collector failed:',e.message);process.exitCode=1});
module.exports={CODES,quoteFromTrade,factsFromSummary,filingsFromRows,pdfUrl,lankaDate,run};
