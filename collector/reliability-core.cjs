'use strict';
/* Safnas Finance v3.6 — evidence quality for public market sources. */
const d=require('./data-core.cjs');
const WORLD_BANK_CODES={gdpGrowth:'NY.GDP.MKTP.KD.ZG',annualInflation:'FP.CPI.TOTL.ZG',remittancesGDP:'BX.TRF.PWKR.DT.GD.ZS',unemployment:'SL.UEM.TOTL.ZS',currentAccountGDP:'BN.CAB.XOKA.GD.ZS',exportsGDP:'NE.EXP.GNFS.ZS'};
const todayUTC=now=>new Date(now).toISOString().slice(0,10);
function validatePriceSample(rows,old=[],now=new Date()){
 if(!Array.isArray(rows))throw Error('Provider did not return a dated price array');
 const normalized=d.standardize(rows);
 if(normalized.length<25)throw Error('Fewer than 25 valid dated ASPI closes');
 if(normalized.some(p=>p.date>todayUTC(now)))throw Error('ASPI provider returned future-dated observations');
 for(let i=1;i<normalized.length;i++){
  if(Math.abs(normalized[i].close/normalized[i-1].close-1)>.40)throw Error('ASPI history contains an implausible >40% consecutive close jump; manual source review required');
 }
 const archive=new Map(d.standardize(old).map(p=>[p.date,p.close]));
 for(const p of normalized){const prev=archive.get(p.date);
  if(prev&&Math.abs(p.close/prev-1)>.10)throw Error('ASPI provider substantially revised an archived closing price; manual source review required');
 }
 return normalized;
}
function parseWorldBankBulk(json,requested=WORLD_BANK_CODES){
 if(!Array.isArray(json)||!Array.isArray(json[1]))throw Error('World Bank bulk response is not a valid indicator response');
 const reverse=Object.fromEntries(Object.entries(requested).map(([key,code])=>[code,key]));
 const groups=Object.fromEntries(Object.keys(requested).map(k=>[k,[]]));
 for(const record of json[1]){
  const key=reverse[record?.indicator?.id];
  if(!key||!/^([12]\d{3})$/.test(String(record.date)))continue;
  if(record.value===null||record.value===undefined||record.value===''||!Number.isFinite(Number(record.value)))continue;
  groups[key].push({year:String(record.date),value:Number(record.value)});
 }
 const out={};
 for(const [key,rows]of Object.entries(groups)){if(!rows.length)continue;
  const byYear=new Map(rows.map(r=>[r.year,r])),points=[...byYear.values()].sort((a,b)=>a.year.localeCompare(b.year)).slice(-12);
  out[key]={country:'LKA',indicator:requested[key],period:'annual',points,asOf:points.at(-1).year,source:'https://data.worldbank.org/indicator/'+encodeURIComponent(requested[key])+'?locations=LK'};
 }
 return out;
}
function sourceHealth(previous,code,{success,asOf=null,now=new Date(),reason='',freshWindowDays=7,observationYear=false,notes='',dateIsRetrieved=false}={}){
 const old=previous?.[code]||{},at=new Date(now).toISOString(),date=asOf||old.asOf||null,yr=String(date||'');
 const age=observationYear&&/^\d{4}$/.test(yr)?now.getUTCFullYear()-Number(yr):/^\d{4}-\d{2}-\d{2}$/.test(yr)?Math.round((Date.parse(todayUTC(now)+'T00:00:00Z')-Date.parse(yr+'T00:00:00Z'))/86400000):null;
 const recent=age!==null&&age>=0&&age<=freshWindowDays;
 const status=success?(dateIsRetrieved?'retrieved_only':recent?'current':'old_observation'):(old.lastSuccessAt?(recent?'cached':'stale'):'unavailable');
 return {status,asOf:date,ageDays:observationYear?null:age,ageYears:observationYear?age:null,lastAttemptAt:at,lastSuccessAt:success?at:(old.lastSuccessAt||null),failures:success?0:(Number(old.failures)||0)+1,note:success?(notes||'Provider response accepted'):(reason||'Provider unavailable; previous verified reading retained')};
}
function overallQuality(research){
 const h=research?.sourceHealth||{},codes=['aspi','macro','forex','shares','sl20','turnover','headlines'];
 const count=codes.filter(k=>h[k]?.status==='current').length;
 const stale=codes.filter(k=>['cached','stale','old_observation'].includes(h[k]?.status)).length;
 const retrievedOnly=codes.filter(k=>h[k]?.status==='retrieved_only').length;
 const missing=codes.length-count-stale-retrievedOnly;
 const aspi=research?.market?.aspi,models=[aspi?.model5,aspi?.model20];
 const audited=models.filter(m=>m?.ok).length,edge=models.filter(m=>m?.ok&&m.edgeDemonstrated===true).length;
 return {currentSources:count,staleSources:stale,retrievedOnlySources:retrievedOnly,unavailableSources:missing,totalSources:codes.length,
  marketAsOf:aspi?.asOf||null,marketSessionCount:aspi?.observations||0,auditedModels:audited,modelCount:2,edgeModels:edge,
  modelClaim:!aspi?.available?'No current verified ASPI reading':audited===0?'Forecast models not yet validated':edge===0?'No verified forecasting edge':'Limited historical statistical edge — not investment advice',
  dataLimit:'The public CSE chart endpoint supplies roughly one trailing year. Older dates require permitted, verified historical data; no synthetic backfill.',
  refreshedAt:research?.generatedAt||null,disclaimer:'Source health is not model accuracy or probability of market growth.'};
}
module.exports={WORLD_BANK_CODES,validatePriceSample,parseWorldBankBulk,sourceHealth,overallQuality};
