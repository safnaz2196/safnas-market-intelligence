'use strict';
(async()=>{
for(const endpoint of ['marketSummery','dailyMarketSummery']) {
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),12500);
 try{
   const response=await fetch('https://www.cse.lk/api/'+endpoint,{method:'POST',body:new FormData(),signal:ac.signal,
    headers:{'Accept':'application/json','User-Agent':'Mozilla/5.0','Referer':'https://www.cse.lk/'}});
   const raw=await response.text();
   let json;try{json=JSON.parse(raw)}catch{}
   const candidates=Array.isArray(json)?json.flat(2):[json];
   console.log(JSON.stringify({endpoint,status:response.status,
    topLevelArray:Array.isArray(json),topLevelKeys:Object.keys(json||{}).slice(0,12),
    firstRecord:candidates.find(x=>x&&typeof x==='object')||null,
    nonJSONExcerpt:json?null:raw.slice(0,100)}).slice(0,3200));
 }catch(e){console.log(JSON.stringify({endpoint,error:e.message}))}
 finally{clearTimeout(timer)}
}
})();