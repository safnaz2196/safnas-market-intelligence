'use strict';
// One-time, read-only public endpoint diagnostics; no credentials or personal data.
const BASE='https://www.cse.lk/api/';
async function probe(api,query=''){
 const url=BASE+api+query;
 const ac=new AbortController(),timeout=setTimeout(()=>ac.abort(),9500);
 try{
  const result=await fetch(url,{method:'POST',body:new FormData(),headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json','Referer':'https://www.cse.lk/'},signal:ac.signal});
  const body=await result.text();let parsed;try{parsed=JSON.parse(body)}catch{parsed=null}
  const obj=typeof parsed==='object'&&parsed!==null?parsed:{};
  const keys=Object.keys(obj);
  const array=Array.isArray(parsed)?parsed:Object.values(obj).find(Array.isArray);
  let sample=null;
  if(array?.length){const v=array[0];sample={fields:Object.keys(v||{}).slice(0,18),symbol:v?.symbol||v?.company||null,hasPDF:!!v?.path};}
  if(api==='companyInfoSummery'&&obj.reqSymbolInfo){sample={fields:Object.keys(obj.reqSymbolInfo).slice(0,24),symbol:obj.reqSymbolInfo.symbol,hasPrice:obj.reqSymbolInfo.lastTradedPrice!=null};}
  console.log(JSON.stringify({endpoint:api,status:result.status,keys:keys.slice(0,6),length:array?.length||0,sample,nonJson:!parsed,html:body.slice(0,20).includes('<')}));
 }catch(e){console.log(JSON.stringify({endpoint:api,error:e.message}));}finally{clearTimeout(timeout)}
}
(async()=>{
 await probe('tradeSummary');
 await probe('todaySharePrice');
 await probe('getFinancialAnnouncement');
 await probe('companyInfoSummery','?symbol=COMB.N0000');
})();
