'use strict';
/* Safnas Finance 5.6: reproducible closing-price indicators + independent CFTC data.
   Facts and evidence only; all outputs describe observations, not certain trades. */
const CFTC_URL="https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$where=cftc_contract_market_code%3D%27088691%27&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=78";
const CFTC_REFERENCE='https://publicreporting.cftc.gov/Commitments-of-Traders/Disaggregated-Futures-Only/72hh-3qpy';
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const fix=(x,n=2)=>Number.isFinite(x)?Number(x.toFixed(n)):null;
const dated=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
const sd=a=>Math.sqrt(a.reduce((s,x)=>s+(x-avg(a))**2,0)/Math.max(1,a.length-1));
const ema=(values,n)=>{
 if(values.length<n)return null;
 let v=avg(values.slice(0,n)),alpha=2/(n+1);
 for(let i=n;i<values.length;i++)v=values[i]*alpha+v*(1-alpha);
 return v;
};
const rsi=(prices,period=14)=>{
 if(prices.length<period*2+1)return null;
 let gains=0,losses=0;
 for(let i=1;i<=period;i++){const d=prices[i]-prices[i-1];gains+=Math.max(0,d);losses+=Math.max(0,-d);}
 gains/=period;losses/=period;
 for(let i=period+1;i<prices.length;i++){
  const d=prices[i]-prices[i-1];
  gains=(gains*(period-1)+Math.max(0,d))/period;
  losses=(losses*(period-1)+Math.max(0,-d))/period;
 }
 return losses===0?(gains===0?50:100):100-100/(1+gains/losses);
};
function macd(prices){
 if(prices.length<60)return null;
 const raw=[],a12=2/13,a26=2/27;
 let e12=avg(prices.slice(0,12)),e26=avg(prices.slice(0,26));
 for(let i=12;i<26;i++)e12=a12*prices[i]+(1-a12)*e12;
 for(let i=26;i<prices.length;i++){
  e12=a12*prices[i]+(1-a12)*e12;
  e26=a26*prices[i]+(1-a26)*e26;
  raw.push(e12-e26);
 }
 if(raw.length<9)return null;
 const signal=ema(raw,9),last=raw.at(-1);
 return {macd:fix(last),signal:fix(signal),histogram:fix(last-signal)};
}
function technical(history, now=new Date()){
 const max=now.toISOString().slice(0,10),lastByDate=new Map();
 for(const row of Array.isArray(history)?history:[]){
  const d=String(row?.date||'').slice(0,10),v=num(row?.usdOz);
  if(dated(d)&&d<=max&&v>100&&v<15000)lastByDate.set(d,v);
 }
 const series=[...lastByDate].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,price:value}));
 const price=series.map(x=>x.price);
 if(price.length<75)return {available:false,reason:'Need at least 75 verified daily close observations',observations:price.length};
 const last=price.at(-1),a20=price.slice(-20),vol=[];
 for(let i=price.length-20;i<price.length;i++)vol.push(Math.log(price[i]/price[i-1]));
 const ma20=avg(a20),ma50=avg(price.slice(-50)),ma200=price.length>=200?avg(price.slice(-200)):null;
 const std20=sd(a20),bUpper=ma20+2*std20,bLower=ma20-2*std20;
 const rsi14=rsi(price),m=macd(price);
 const volAnn=sd(vol)*Math.sqrt(252)*100;
 const peak=Math.max(...price.slice(-90));
 const swingHigh=Math.max(...price.slice(-20)),swingLow=Math.min(...price.slice(-20));
 const trend=last>ma20&&ma20>ma50?'uptrend':last<ma20&&ma20<ma50?'downtrend':'range_or_transition';
 const regime=volAnn>=32?'high_volatility':trend;
 const signals=[
  {name:'RSI (14)',value:fix(rsi14),unit:'0–100',reading:rsi14>70?'Overbought reading':rsi14<30?'Oversold reading':'Middle of range',
   note:'RSI extremes can persist. They are not reliable reversal dates.'},
  {name:'MACD (12,26,9)',value:m?.histogram??null,unit:'USD/oz spread',reading:m?.histogram>0?'Positive MACD gap':m?.histogram<0?'Negative MACD gap':'Flat gap',
   note:'MACD is based on the same closing-price history as momentum.'},
  {name:'20-day band position',value:fix((last-bLower)/(bUpper-bLower)*100),unit:'% across bands',reading:last>=bUpper?'Above upper band':last<=bLower?'Below lower band':'Within statistical bands',
   note:'Bands describe past dispersion, not guaranteed support or resistance.'},
  {name:'90-day drawdown',value:fix((last/peak-1)*100),unit:'%',reading:'From 90-session peak',
   note:'Drawdown measures past decline, not the worst loss ahead.'}
 ];
 return {available:true,source:'https://xaus.com/api/v1/history',asOf:series.at(-1).date,observations:price.length,
  last:fix(last),rsi14:fix(rsi14),macd:m,ma20:fix(ma20),ma50:fix(ma50),ma200:fix(ma200),
  bands:{upper:fix(bUpper),middle:fix(ma20),lower:fix(bLower)},volatilityAnnualizedPct:fix(volAnn),
  drawdown90Pct:fix((last/peak-1)*100),recent20High:fix(swingHigh),recent20Low:fix(swingLow),
  regime,trend,signals,warning:'These indicators reuse overlapping gold prices and are correlated; do not count them as independent predictive evidence.'};
}
function parseCot(rows,now=new Date()){
 if(!Array.isArray(rows)||rows.length<2)return {available:false,reason:'No valid CFTC series',source:CFTC_REFERENCE};
 const valid=rows.map(row=>{
  const date=String(row?.report_date_as_yyyy_mm_dd||'').slice(0,10);
  const long=num(row?.m_money_positions_long_all),short=num(row?.m_money_positions_short_all);
  const oi=num(row?.open_interest_all);
  if(!dated(date)||date>now.toISOString().slice(0,10)||long===null||short===null||oi===null||
     long<0||short<0||oi<=0||long>oi*2||short>oi*2)return null;
  return {date,long,short,net:long-short,oi};
 }).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
 const dedup=[...new Map(valid.map(v=>[v.date,v])).values()];
 if(dedup.length<2)return {available:false,reason:'Insufficient validated CFTC gold reports',source:CFTC_REFERENCE};
 const latest=dedup.at(-1),prior=dedup.at(-2);
 const days=(now-Date.parse(latest.date+'T00:00:00Z'))/86400000;
 if(days<0||days>18)return {available:false,reason:'The latest CFTC report is stale',asOf:latest.date,source:CFTC_REFERENCE};
 const compare=dedup.slice(-52).map(x=>x.net).sort((a,b)=>a-b);
 const pct=compare.length>=10?compare.filter(x=>x<=latest.net).length/compare.length*100:null;
 return {available:true,asOf:latest.date,observations:dedup.length,
  managedMoneyNetContracts:latest.net,managedMoneyLong:latest.long,managedMoneyShort:latest.short,
  previousNetContracts:prior.net,weeklyChangeContracts:latest.net-prior.net,
  netPctOpenInterest:fix(latest.net/latest.oi*100),
  positionPercentile52:fix(pct),source:CFTC_REFERENCE,
  interpretation:'CFTC futures-only managed-money positioning; positions are weekly delayed (Tuesday observations, later published). Positioning alone has no reliable directional implication.'};
}
function catalysts(tech,cot,macro=[]){
 const out=[];
 if(tech?.available){
  if(tech.rsi14<30)out.push({level:'watch',title:'RSI below 30',message:'Historically oversold oscillator reading; a rebound is possible but not established.',asOf:tech.asOf,source:tech.source});
  if(tech.rsi14>70)out.push({level:'watch',title:'RSI above 70',message:'Historically overbought oscillator reading; not a reversal guarantee.',asOf:tech.asOf,source:tech.source});
  if(tech.regime==='high_volatility')out.push({level:'risk',title:'High-volatility gold regime',message:'Observed volatility is elevated; both upside and downside scenario error can widen.',asOf:tech.asOf,source:tech.source});
  if(tech.macd?.histogram<0&&tech.trend==='downtrend')
   out.push({level:'watch',title:'Downtrend confirmed by price-based measures',message:'MACD and moving averages are correlated measures of the same historical series.',asOf:tech.asOf,source:tech.source});
 }
 if(cot?.available&&cot.positionPercentile52>=90)
  out.push({level:'context',title:'Managed-money gold positioning near 52-week high',message:'Crowded positioning can increase sensitivity to unwinds; it does not establish the direction of the next move.',asOf:cot.asOf,source:cot.source});
 const yieldRow=macro.find(x=>x.name==='U.S. 10-year inflation-adjusted yield'&&x.available);
 if(yieldRow&&Math.abs(yieldRow.change5)>=.2)
  out.push({level:'context',title:'Meaningful move in real yields',message:'Potential gold macro driver; connection is historical and not guaranteed.',asOf:yieldRow.asOf,source:yieldRow.source});
 return out.slice(0,8);
}
module.exports={technical,rsi,macd,parseCot,catalysts,CFTC_URL,CFTC_REFERENCE};
