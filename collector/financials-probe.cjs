'use strict';
(async()=>{
 for(const ticker of ['COMB.N0000','DIAL.N0000']){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),14000);
  try{
   const body=new URLSearchParams({symbol:ticker});
   const r=await fetch('https://www.cse.lk/api/financials',{method:'POST',body,signal:ac.signal,
    headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json','Origin':'https://www.cse.lk',
      'Referer':'https://www.cse.lk/company-profile?symbol='+ticker,'Content-Type':'application/x-www-form-urlencoded'}});
   const text=await r.text();let j;try{j=JSON.parse(text)}catch{j=null}
   const keys=j?Object.keys(j):[];
   const shape=Object.fromEntries(keys.slice(0,12).map(k=>[k,Array.isArray(j[k])?
     {length:j[k].length,first:j[k].slice(0,1).map(x=>Object.fromEntries(Object.entries(x).slice(0,12)))}:typeof j[k]]));
   console.log(JSON.stringify({ticker,status:r.status,shape,error:!j?text.slice(0,130):null}));
  }catch(e){console.log(JSON.stringify({ticker,error:e.message}))}finally{clearTimeout(timer)}
 }
})();
