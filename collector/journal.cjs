'use strict';
/* Forward-only forecasting journal: store each dated prediction, resolve using later
   observed closes only AFTER the whole horizon actually occurred. Never backfill a
   forecast from a hindsight-only sample. Results are descriptive, NOT test accuracy. */
function updateJournal(old,series,models,runAt){const entries=Array.isArray(old)?old.filter(x=>x&&typeof x==='object'):[];
 const index=new Map(series.map((x,i)=>[x.date,i]));
 for(const item of entries){if(item.status==='resolved')continue;
  const idx=index.get(item.observationDate),end=typeof idx==='number'?idx+item.horizon:-1;
  if(end<0||end>=series.length)continue;
  const endClose=series[end].close,returnPct=(endClose/item.baseClose-1)*100;
  item.status='resolved';item.resolvedOn=series[end].date;item.realizedReturnPct=Number(returnPct.toFixed(3));item.actualDirection=returnPct>0?'Up':returnPct<0?'Down':'Flat';
  item.directionCorrect=item.signal==='Up'?returnPct>0:item.signal==='Down'?returnPct<0:null;
 }
 for(const h of [5,20]){const model=models[h];if(!model?.ok||!series.length)continue;
  const last=series.at(-1),id=`ASPI:${h}:${last.date}`;if(entries.some(x=>x.id===id))continue;
  entries.push({id,market:'ASPI',horizon:h,observationDate:last.date,createdAt:runAt.toISOString(),baseClose:last.close,
   signal:model.upScore>=.57?'Up':model.upScore<=.43?'Down':'Indecisive',
   diagnosticScore:model.upScore,backtestEdge:model.edgeDemonstrated===true,status:'pending',
   caution:'Not a calibrated rise probability or investment signal'});
 }
 const limited=entries.sort((a,b)=>a.observationDate.localeCompare(b.observationDate)||a.horizon-b.horizon).slice(-800);
 const resolved=limited.filter(x=>x.status==='resolved'&&typeof x.directionCorrect==='boolean');
 const correct=resolved.filter(x=>x.directionCorrect).length;
 return {entries:limited,summary:{total:limited.length,pending:limited.filter(x=>x.status==='pending').length,resolved:resolved.length,correct,wrong:resolved.length-correct,historicalHitRate:resolved.length?Number((correct/resolved.length*100).toFixed(1)):null},notice:'These post-publication outcomes only show what happened on previously logged dates; small samples and changing regimes make them unreliable for forecasting.'};
}
module.exports={updateJournal};
