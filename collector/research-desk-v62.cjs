'use strict';
/* Safnas Finance v6.2: public evidence-first research memory.
 * No API key, private balances, inference service, or made-up stock forecasts.
 * Only publishes dated observed market/company/gold findings and audit changes. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const directory=path.join(__dirname,'..','market-intelligence');
const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'))}catch{return null}};
const isDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'));
const num=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
const idFor=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,16);
function assemble({cse,latest,gold,ledger,previous},now=new Date()){
 const iso=now.toISOString(),companyList=Array.isArray(cse?.companies)?cse.companies:[],
  aspi=cse?.market||{},goldNow=gold?.latestReference||{},gStatus=gold?.overview||{};
 const companies=companyList.map(v=>{
  const q=v.quote||{},valid=q.verifiedTradeDate===true&&num(q.value)>0&&isDay(q.asOf);
  const filings=(Array.isArray(v.filings)?v.filings:[]).filter(x=>/^https:\/\/cdn\.cse\.lk\//.test(x.url||''));
  return {ticker:v.ticker,name:v.name,asOf:valid?q.asOf:null,priceLKR:valid?q.value:null,
   changePct:valid?num(q.changePct):null,filings:filings.length,
   latestFiling:filings[0]?{title:String(filings[0].title).slice(0,110),date:filings[0].published,url:filings[0].url}:null};
 });
 const cseValid=companies.filter(x=>x.priceLKR!==null).length;
 const market={asOf:isDay(aspi.asOf)?aspi.asOf:null,close:num(aspi.close),
  changePct:num(aspi.changePct),turnoverLKR:num(aspi.turnover?.valueLKR),
  turnoverAsOf:isDay(aspi.turnover?.asOf)?aspi.turnover.asOf:null};
 const quoteDate=typeof goldNow.asOf==='string'?goldNow.asOf:null;
 const goldInfo={referenceUsdOz:num(goldNow.usdOz),quoteAsOf:quoteDate,
  goldModelWindows:6,historicalWindowsValidated:num(gStatus.validHistoricalWindows)||0,
  forwardPending:num(gStatus.forwardPending)||0,forwardResolved:num(gStatus.forwardVerified)||0,
  sources:'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-ultra-v60.json'};
 const stories=(Array.isArray(cse?.news)?cse.news:[]).filter(x=>/^https:\/\//.test(x.url||'')&&isDay(x.date))
  .slice(0,8).map(x=>({title:String(x.title||'').slice(0,160),date:x.date,
   url:x.url,publisher:String(x.publisher||'Publisher').slice(0,60)}));
 const checks={
  cseQuotes:cseValid+' / '+companies.length,
  cseDataDate:market.asOf,goldDataDate:quoteDate,
  collectorAt:latest?.generatedAt||null,
  researchAt:cse?.generatedAt||null,
  predictionResults:goldInfo.forwardResolved,
  warning:'Source dates are observations, not live exchange-streaming commitments.'
 };
 const prior=previous?.snapshot||{},changes=[];
 const push=(kind,label,detail,asOf,url)=>{
  const eventId=idFor(kind+'|'+asOf+'|'+detail);
  if(changes.some(v=>v.id===eventId))return;
  changes.push({id:eventId,kind,label,detail,asOf,url});
 };
 if(market.asOf&&market.asOf!==prior.aspiDate&&num(market.close)!==null)
  push('market','New dated ASPI close','ASPI '+market.close+' on '+market.asOf,market.asOf,'https://www.cse.lk/');
 if(quoteDate&&quoteDate!==prior.goldQuoteDate&&num(goldNow.usdOz)!==null)
  push('gold','New gold spot observation','USD '+goldNow.usdOz+'/oz as of '+quoteDate,quoteDate,goldInfo.sources);
 if(goldInfo.forwardResolved>(prior.predictionResolved||0))
  push('audit','Gold forecast outcomes added',
   (goldInfo.forwardResolved-(prior.predictionResolved||0))+' newly completed forward result(s)',
   iso,'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-prediction-history-v57.json');
 const prevCompanies=prior.companies||{};
 for(const c of companies){
  if(c.asOf&&c.priceLKR!==null&&
    (c.asOf!==prevCompanies[c.ticker]?.asOf||
     !previousEvents.some(v=>v.kind==='company'&&v.asOf===c.asOf&&v.label?.includes(c.ticker))))
   push('company','Dated CSE quote recorded · '+c.ticker,
     c.name+' last traded at LKR '+c.priceLKR+' on '+c.asOf,c.asOf,'https://www.cse.lk/');
 }
 const previousEvents=Array.isArray(previous?.history)?previous.history:[];
 const seen=new Set();const history=[...changes,...previousEvents].filter(x=>{
  if(!x?.id||seen.has(x.id))return false;seen.add(x.id);return true;
 }).slice(0,45);
 return {schemaVersion:1,version:'6.2',generatedAt:iso,status:cse&&gold?'observed_public_research':'partial',
  snapshot:{aspiDate:market.asOf,goldQuoteDate:quoteDate,predictionResolved:goldInfo.forwardResolved,
    companies:Object.fromEntries(companies.map(c=>[c.ticker,{asOf:c.asOf,priceLKR:c.priceLKR}]))},
  coverage:checks,market,gold:goldInfo,companies:companies.length,
  verifiedCompanies:cseValid,companyFilings:companies.filter(x=>x.filings).length,
  publishers:stories.length,changes:changes.slice(0,12),history,
  disclaimer:'Public market research facts only. No LLM inference, private brokerage data, verified trading signals or investment recommendations.',
  sourceLinks:[
   'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/research-v5.json',
   goldInfo.sources]};
}
function publish(now=new Date()){
 const result=assemble({cse:read('research-v5.json'),latest:read('latest.json'),
  gold:read('gold-ultra-v60.json'),ledger:read('gold-prediction-history-v57.json'),
  previous:read('research-desk-v62.json')},now);
 if(result.status==='partial')throw Error('Primary market or gold research missing; preserving previously published report');
 const out=path.join(directory,'research-desk-v62.json');
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n','utf8');
 console.log(JSON.stringify({researchDesk:'v6.2',coverage:result.coverage.cseQuotes,
   changeCount:result.changes.length,history:result.history.length}));
 return result;
}
if(require.main===module)try{publish()}catch(e){console.error(e.message);process.exitCode=1}
module.exports={assemble,publish};