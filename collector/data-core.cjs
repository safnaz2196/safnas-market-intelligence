/* Safnas Finance — Sri Lankan public market observations.
   No fabricated data, no personal financial records, no API keys. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../market-intelligence');
const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x||''));
function toDate(value){
 if(typeof value==='number'){const time=value<1e11?value*1000:value;const d=new Date(time);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;}
 if(typeof value==='string'){
  if(validDate(value.slice(0,10)))return value.slice(0,10);
  const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString().slice(0,10):null;
 }
 return null;
}
function standardize(raw){
 const unique=new Map();for(const o of raw||[]){if(!o||typeof o!=='object')continue;
  const date=toDate(o.date??o.d??o.timestamp??o.tradeDate);
  const close=Number(o.close??o.c??o.v??o.value??o.price);
  if(date&&Number.isFinite(close)&&close>0&&close<1e9){unique.set(date,{date,close:Math.round(close*10000)/10000});}
 }
 return [...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function parseCSE(body){
 const tryArrays=[body,body?.data,body?.results,body?.chartData,body?.reqChartData,body?.reqData,body?.values];
 for(const arr of tryArrays){if(!Array.isArray(arr))continue;const points=standardize(arr);if(points.length>=25)return points;}
 throw Error('CSE index history is not in an expected dated-price format');
}
function mergeSeries(existing,latest,max=1500){return standardize([...(Array.isArray(existing)?existing:[]),...(Array.isArray(latest)?latest:[])]).slice(-max)}
function newestDate(rows){return rows?.at(-1)?.date||null}
function stale(date,now=new Date(),limit=7){if(!validDate(date))return true;return (Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-Date.parse(date+'T00:00:00Z'))/86400000>limit}
function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function parseWorldBank(country,indicator,response){if(!Array.isArray(response)||!Array.isArray(response[1]))throw Error('World Bank returned unexpected result');
 const points=response[1].map(x=>({year:String(x.date||''),value:num(x.value)})).filter(x=>/^\d{4}$/.test(x.year)&&x.value!==null).sort((a,b)=>a.year.localeCompare(b.year));
 return {country,indicator,period:'annual',points:points.slice(-12),asOf:points.at(-1)?.year||null,source:`https://data.worldbank.org/indicator/${encodeURIComponent(indicator)}?locations=LK`};
}
function parseFx(rows){const arr=Array.isArray(rows)?rows:[rows];return arr.map(row=>({date:toDate(row.date),rate:num(row.rate)})).filter(x=>x.date&&x.rate>0&&x.rate<10000).sort((a,b)=>a.date.localeCompare(b.date));}
function reportQuality(model){if(!model?.ok)return {status:'unavailable',reason:model?.reason||'Insufficient verified daily closes'};
 if(!model.edgeDemonstrated)return {status:'no_proven_edge',reason:'Independent backtest did not beat the simple baseline convincingly'};
 return {status:'limited_statistical_edge',reason:'Some historical edge observed; no guarantee of future performance'};
}
function parseStockSnapshot(body){const potential=[body,body?.data,body?.reqAllStock,body?.allStock,body?.reqStock,body?.stocks];let a=potential.find(v=>Array.isArray(v));if(!a)return [];
 const rows=[];for(const x of a){if(!x||typeof x!=='object')continue;const ticker=String(x.symbol??x.code??x.stockCode??'').trim();const price=num(x.price??x.lastTradedPrice??x.lastTradePrice??x.lastPrice);
 const turnover=num(x.turnover??x.valueTraded??x.tradeValue??x.tradedValue);
 if(!/^[A-Z0-9.\-]{3,18}$/.test(ticker)||price===null||price<=0)continue;
 rows.push({ticker,name:String(x.name??x.securityName??ticker).slice(0,85),price,turnover:turnover&&turnover>0?turnover:null});}
 return rows.sort((a,b)=>(b.turnover||0)-(a.turnover||0)).slice(0,12);
}
function decodeXML(x){return String(x||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(all,n)=>{const v=Number(n);return v>0&&v<=0x10ffff?String.fromCodePoint(v):''}).trim();}
function parseNewsRSS(xml){if(typeof xml!=='string'||!/<rss\b|<feed\b/i.test(xml))throw Error('Publisher did not return an RSS feed');
 const entries=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,35),out=[];
 for(const [,block]of entries){const get=t=>{const m=block.match(new RegExp('<'+t+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+t+'>','i'));return decodeXML(m?.[1]);};
  const title=get('title').slice(0,170),url=get('link'),date=toDate(get('pubDate'));
  try{const dest=new URL(url);if(!['https:','http:'].includes(dest.protocol)||!/(^|\.)economynext\.com$/i.test(dest.hostname))continue;if(!title||!date)continue;out.push({title,url:dest.href,date,publisher:'EconomyNext'});}catch{}
 }
 return out.slice(0,15);
}
function writeJSON(filename,data){fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,filename),JSON.stringify(data,null,2)+'\n');}
function readJSON(filename,fallback){try{return JSON.parse(fs.readFileSync(path.join(root,filename),'utf8'))}catch{return fallback}}
module.exports={toDate,standardize,parseCSE,mergeSeries,newestDate,stale,parseWorldBank,parseFx,reportQuality,parseStockSnapshot,parseNewsRSS,writeJSON,readJSON};
