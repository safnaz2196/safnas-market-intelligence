/* Safnas Finance v3.5 — descriptive price regime and public source coverage */
'use strict';
const ml=require('./ml-core.cjs');
const avg=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const rnd=(x,n=2)=>Number(x.toFixed(n));
function marketRisk(points,now=new Date()){
 const a=ml.cleanSeries(points);
 if(a.length<65)return {available:false,reason:'Need at least 65 dated closes',observations:a.length};
 const last=a.at(-1),age=(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-Date.parse(last.date+'T00:00:00Z'))/86400000;
 if(age>7||age< -1)return {available:false,reason:'Latest close is stale or future-dated',asOf:last.date,observations:a.length};
 const close=a.map(p=>p.close),r=[];
 for(let i=1;i<close.length;i++)r.push(Math.log(close[i]/close[i-1]));
 const recent=r.slice(-20),mu=avg(recent),vol=Math.sqrt(avg(recent.map(v=>(v-mu)**2)))*Math.sqrt(252)*100,windows=[];
 for(let i=60;i<r.length;i++){const w=r.slice(i-19,i+1),m=avg(w);windows.push(Math.sqrt(avg(w.map(v=>(v-m)**2)))*Math.sqrt(252)*100);}
 const pct=windows.length?windows.filter(x=>x<=vol).length/windows.length:null;
 const drawdown=(last.close/Math.max(...close.slice(-60))-1)*100;
 const m5=(last.close/close.at(-6)-1)*100,m20=(last.close/close.at(-21)-1)*100,m60=(last.close/close.at(-61)-1)*100;
 const regime=m20>2&&m60>4?'Uptrend':m20< -2&&m60< -4?'Downtrend':'Sideways / mixed';
 const risk=(pct!==null&&pct>=.85)||drawdown< -12?'Elevated':(pct!==null&&pct>=.6)||drawdown< -6?'Moderate':'Lower recent volatility';
 return {available:true,asOf:last.date,observations:a.length,annualizedVolatilityPct:rnd(vol),volatilityPercentile:pct===null?null:rnd(pct*100,1),drawdown60Pct:rnd(drawdown),momentum5Pct:rnd(m5),momentum20Pct:rnd(m20),momentum60Pct:rnd(m60),regime,risk,method:'20-session historical volatility and 60-session drawdown; descriptive, not a price forecast.'};
}
const codes={gdpGrowth:'NY.GDP.MKTP.KD.ZG',annualInflation:'FP.CPI.TOTL.ZG',remittancesGDP:'BX.TRF.PWKR.DT.GD.ZS',unemployment:'SL.UEM.TOTL.ZS',currentAccountGDP:'BN.CAB.XOKA.GD.ZS',exportsGDP:'NE.EXP.GNFS.ZS'};
function macroAudit(macro,year=new Date().getUTCFullYear()){
 const indicators={};
 for(const [name,code] of Object.entries(codes)){const data=macro?.[name],rows=Array.isArray(data?.points)?data.points.filter(x=>/^\d{4}$/.test(String(x.year))&&Number.isFinite(x.value)):[],latest=rows.at(-1);
 indicators[name]={available:!!latest,asOf:latest?.year||null,value:latest?rnd(latest.value,3):null,observationAgeYears:latest?year-Number(latest.year):null,code,source:data?.source||'https://api.worldbank.org/v2/'};}
 return {available:Object.values(indicators).filter(x=>x.available).length,total:Object.keys(indicators).length,indicators,notice:'Annual macro data may lag and be revised. Not a monthly forecast.'};
}
function sourceAudit({aspi,macro,forex,shares,sl20,marketSummary,headlines}){
 const s=(yes,label,asOf)=>({status:yes?'available':'unavailable',label,asOf:asOf||null});
 return {aspi:s(aspi?.available,'CSE dated ASPI closes',aspi?.asOf),economy:s((macro?.available||0)>0,'World Bank indicators ('+(macro?.available||0)+'/'+(macro?.total||6)+')'),forex:s(!!forex?.asOf,'USD/LKR exchange reference',forex?.asOf),shares:s(shares.length>0,'CSE share snapshots (not audited fundamentals)'),sl20:s(!!sl20?.value,'S&P SL20 snapshot'),turnover:s(!!marketSummary?.turnover,'CSE market turnover'),headlines:s(headlines.length>0,'Publisher headlines (not ML features)')};
}
function companyCoverage(shares){return {count:shares.length,fundamentalsAvailable:false,companyPredictionsAvailable:false,notice:shares.length?'Quotes and turnover do not justify company buy ratings. Audited fundamentals and corporate actions not available.':'Company snapshots unavailable; no stock ratings created.',requiredForFundamentals:['Audited earnings and cash flow','Debt and interest coverage','As-of dated valuations','Corporate actions and adjusted prices','Liquidity and free float']};}
module.exports={marketRisk,macroAudit,sourceAudit,companyCoverage};
