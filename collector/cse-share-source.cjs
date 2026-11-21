'use strict';
// Safnas Finance CSE quote resilience: use a previously VERIFIED official
// CSE last-trade observation if the upstream endpoint is blocked temporarily.
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
function recoverDatedShareQuotes(evidence,report,now=new Date()){
 if(evidence?.schemaVersion!==1||!evidence?.companies||typeof evidence.companies!=='object')return [];
 const sourceTime=Date.parse(evidence.generatedAt||'');
 if(!Number.isFinite(sourceTime)||sourceTime>now.getTime()+3600000||now.getTime()-sourceTime>21*86400000)return [];
 const names=new Map((Array.isArray(report?.companies)?report.companies:[]).map(x=>[x.ticker,x.name]));
 const maxDate=now.toISOString().slice(0,10);
 const rows=[];
 for(const [ticker,entry] of Object.entries(evidence.companies)){
  const q=entry?.quote,asOf=q?.asOf,price=q?.value;
  if(!/^[A-Z0-9.-]{3,18}$/.test(ticker)||q?.verifiedTradeDate!==true||!validDate(asOf)||
    asOf>maxDate||!(typeof price==='number'&&Number.isFinite(price)&&price>0))continue;
  const turnover=Number(q.turnoverLKR);
  rows.push({ticker,name:String(names.get(ticker)||ticker).slice(0,85),price,
    turnover:Number.isFinite(turnover)&&turnover>0?turnover:null,
    asOf,verifiedTradeDate:true,retrievedAt:evidence.generatedAt,
    sourceURL:'https://www.cse.lk/api/tradeSummary',
    verifiedVia:'CSE official dated last-trade archive',
    archivedObservation:true,
    note:'Previously verified CSE last-traded quote, not a new live observation'});
 }
 return rows.sort((a,b)=>(b.turnover||0)-(a.turnover||0)).slice(0,50);
}
module.exports={recoverDatedShareQuotes};
