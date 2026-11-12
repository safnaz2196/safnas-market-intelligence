/* Safnas Finance v3.4.5 — supervised statistical learning; no paid APIs.
   Tests are chronological (purged by the label horizon). No trading or guaranteed forecasts. */
(function(root,factory){const mod=factory();if(typeof module==='object'&&module.exports)module.exports=mod;root.__sfMarketML=mod;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const EPS=1e-8, MIN_TRAIN=75;
const advanced=typeof require==='function'?require('./advanced-models.cjs'):null;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mean=v=>v.reduce((s,x)=>s+x,0)/Math.max(1,v.length);
const sigmoid=z=>z>35?1:z< -35?0:1/(1+Math.exp(-z));
const logRatio=(a,b)=>a>0&&b>0?Math.log(a/b):0;
const round=(n,k=1)=>Number(n.toFixed(k));
const names=['1-session momentum','5-session momentum','20-session momentum','5–20 average spread','RSI (14)','20-session volatility','20-session drawdown','Short-term acceleration','2-session reversal'];
function cleanSeries(raw){
 const unique=new Map();
 for(const o of raw||[]){const date=String(o?.date||o?.d||'').slice(0,10);const price=Number(o?.close??o?.c);if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(price)&&price>0)unique.set(date,{date,close:price});}
 return [...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function features(prices,i){
 if(i<30||i>=prices.length)return null;
 const v=prices.map(x=>x.close),last=v[i],period=v.slice(i-19,i+1);
 const changes=[];for(let t=i-19;t<=i;t++)changes.push(logRatio(v[t],v[t-1]));
 const av=mean(changes),vol=Math.sqrt(mean(changes.map(x=>(x-av)**2)));
 const ma5=mean(v.slice(i-4,i+1)),ma20=mean(period);
 let gains=0,losses=0;for(let t=i-13;t<=i;t++){const diff=v[t]-v[t-1];gains+=Math.max(0,diff);losses+=Math.max(0,-diff);}
 const rsi=losses===0?(gains===0?50:100):100-100/(1+gains/losses);
 const r5=logRatio(last,v[i-5]),r20=logRatio(last,v[i-20]);
 const f=[logRatio(last,v[i-1]),r5,r20,logRatio(ma5,ma20),(rsi-50)/50,vol,logRatio(last,Math.max(...period)),r5-r20/4,-logRatio(last,v[i-2])];
 return f.every(Number.isFinite)?f:null;
}
function examples(rows,horizon=5){
 if(!Number.isInteger(horizon)||horizon<1||horizon>30)throw Error('Invalid prediction horizon');
 const series=cleanSeries(rows),result=[];
 for(let i=30;i+horizon<series.length;i++){
  const f=features(series,i);if(!f)continue;
  const ret=logRatio(series[i+horizon].close,series[i].close);
  result.push({date:series[i].date,labelDate:series[i+horizon].date,index:i,x:f,y:ret>0?1:0,forwardReturn:ret});
 }
 return {series,examples:result,featureNames:names.slice()};
}
function scaler(records){const n=records[0]?.x.length||0;const mu=Array.from({length:n},(_,j)=>mean(records.map(x=>x.x[j])));
 const sd=mu.map((m,j)=>{const v=Math.sqrt(mean(records.map(r=>(r.x[j]-m)**2)));return Math.max(v,1e-5);});return {mu,sd};}
function normalized(x,s){return x.map((v,i)=>clamp((v-s.mu[i])/s.sd[i],-4.5,4.5));}
function fitLogit(records){if(records.length<12)throw Error('Not enough labeled training examples');
 const sc=scaler(records),arr=records.map(r=>({x:normalized(r.x,sc),y:r.y})),n=arr.length,p=arr[0].x.length,prior=clamp(mean(arr.map(r=>r.y)),.025,.975),w=Array(p).fill(0);
 let bias=Math.log(prior/(1-prior)),rate=.17;
 for(let step=0;step<220;step++){
  const dw=Array(p).fill(0);let db=0;
  for(const row of arr){let z=bias;for(let j=0;j<p;j++)z+=w[j]*row.x[j];const e=sigmoid(z)-row.y;db+=e;for(let j=0;j<p;j++)dw[j]+=e*row.x[j];}
  for(let j=0;j<p;j++)w[j]-=rate*(dw[j]/n+.04*w[j]);bias-=rate*db/n;rate*=.997;
 }
 return {kind:'Logistic learning',sc,w,bias,trainSize:n,prior};
}
function logitPredict(model,x){const z=normalized(x,model.sc);let s=model.bias;for(let j=0;j<z.length;j++)s+=model.w[j]*z[j];return clamp(sigmoid(s),.02,.98);}
// A separate nonparametric learner compares today's pattern to historically labeled patterns.
function fitPatterns(records){const sc=scaler(records);return {kind:'Pattern matching',sc,rows:records.map(r=>({x:normalized(r.x,sc),y:r.y}))};}
function patternPredict(model,x){const point=normalized(x,model.sc),dist=model.rows.map(r=>({d:point.reduce((a,v,j)=>a+(v-r.x[j])**2,0),y:r.y}));dist.sort((a,b)=>a.d-b.d);
 const k=Math.min(31,Math.max(9,Math.round(Math.sqrt(dist.length))));let pos=1,total=2;
 for(let i=0;i<Math.min(k,dist.length);i++){const d=dist[i],weight=1/(.7+Math.sqrt(d.d));pos+=weight*d.y;total+=weight;}
 return clamp(pos/total,.02,.98);
}
const brier=(p,y)=>(p-y)**2;
function classify(p){return p>=.5?1:0;}
function learner(mode,records){
 if(mode==='forest'&&advanced){const m=advanced.forestFit(records);return x=>advanced.forestPredict(m,x)}
 if(mode==='boost'&&advanced){const m=advanced.boostFit(records);return x=>advanced.boostPredict(m,x)}
 const logit=mode!=='patterns'?fitLogit(records):null,patterns=mode!=='logit'?fitPatterns(records):null;
 return x=>mode==='logit'?logitPredict(logit,x):mode==='patterns'?patternPredict(patterns,x):.5*logitPredict(logit,x)+.5*patternPredict(patterns,x);
}
function evaluateSet(train,test,mode){
 const predict=learner(mode,train);
 const prior=mean(train.map(v=>v.y));return test.map(row=>({date:row.date,actual:row.y,p:predict(row.x),baseP:prior,baseClass:prior>=.5?1:0}));
}
// Explicit purging: a training target must finish BEFORE the first validation feature date.
function makeFolds(items,horizon){const n=items.length;
 const cuts=[[Math.floor(n*.56),Math.floor(n*.68)],[Math.floor(n*.70),Math.floor(n*.82)]];
 return cuts.map(([start,end])=>({start,end,train:items.slice(0,Math.max(0,start-horizon)),test:items.slice(start,end)})).filter(f=>f.train.length>=MIN_TRAIN&&f.test.length>=22);
}
function score(records){const n=records.length;if(!n)return null;
 let correct=0,balancedUp=0,balancedDown=0,positives=0,negatives=0,baseCorrect=0;
 for(const r of records){const prediction=classify(r.p);if(prediction===r.actual)correct++;if(r.actual){positives++;if(prediction===1)balancedUp++;}else{negatives++;if(prediction===0)balancedDown++;}if(r.baseClass===r.actual)baseCorrect++;}
 const acc=correct/n,baseline=baseCorrect/n,brierScore=mean(records.map(v=>brier(v.p,v.actual))),baseBrier=mean(records.map(v=>brier(v.baseP,v.actual)));
 return {n,accuracy:acc,baselineAccuracy:baseline,brier:brierScore,baselineBrier:baseBrier,balancedAccuracy:positives&&negatives?.5*(balancedUp/positives+balancedDown/negatives):null,positives,negatives};
}
function trainAndValidate(raw,horizon=5,now=new Date()){
 const {series,examples:items,featureNames}=examples(raw,horizon);
 const output={ok:false,observations:series.length,labeled:items.length,horizon};
 if(series.length<210||items.length<170)return {...output,reason:`At least 210 dated market sessions are needed for training (received ${series.length}).`};
 const last=series.at(-1),ageDays=Math.floor((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-Date.parse(last.date+'T00:00:00Z'))/86400000);
 if(ageDays>7||ageDays< -1)return {...output,asOf:last.date,reason:`Latest close is ${ageDays} days old. Refresh verified market data before training.`};
 const folds=makeFolds(items,horizon);if(folds.length<2)return {...output,reason:'Two purged validation periods require more dated closes.'};
 const candidates=['logit','patterns','blend',...(advanced?['forest','boost']:[])].map(mode=>{
  const observed=[];for(const fold of folds)observed.push(...evaluateSet(fold.train,fold.test,mode));
  return {mode,...score(observed)};
 });
 // Compare out-of-sample Brier score first; tie-break by balanced accuracy.
 candidates.sort((a,b)=>a.brier-b.brier||((b.balancedAccuracy||0)-(a.balancedAccuracy||0)));
 const best=candidates[0],winner=best.mode;
 // Final untouched 16% are audited only AFTER model choice, and never used to select a learner.
 const auditStart=Math.floor(items.length*.84),auditTraining=items.slice(0,Math.max(0,auditStart-horizon)),auditItems=items.slice(auditStart);
 if(auditTraining.length<MIN_TRAIN||auditItems.length<22)return {...output,reason:'Not enough untouched dates for an independent forecast audit.'};
 const audit=score(evaluateSet(auditTraining,auditItems,winner));
 const current=features(series,series.length-1);
 if(!current)return {...output,reason:'Latest indicators are incomplete.'};
 const upScore=learner(winner,items)(current);
 const direction=upScore>=.57?'Upward lean':upScore<=.43?'Downward lean':'Indecisive / sideways';
 const edge=(audit.brier<audit.baselineBrier-.002)&&(audit.accuracy>=audit.baselineAccuracy+.006)&&(audit.balancedAccuracy===null||audit.balancedAccuracy>=.5);
 const coefficients=fitLogit(items);const featureRanks=featureNames.map((name,j)=>({name,weight:coefficients.w[j],magnitude:Math.abs(coefficients.w[j]),current:round(current[j],4)})).sort((a,b)=>b.magnitude-a.magnitude);
 const count=folds.reduce((n,f)=>n+f.test.length,0);
 return {...output,ok:true,asOf:last.date,latest:last.close,ageDays,horizon,direction,upScore:round(upScore,4),edgeDemonstrated:edge,quality:!edge?'Limited evidence':audit.accuracy>=.58?'Better historical fit':'Modest historical fit',model:({logit:'Regularized logistic model',patterns:'Nearest-pattern learner',blend:'Fixed 50/50 model blend',forest:'Random forest · shallow trees',boost:'Gradient boosted stumps'})[winner],trainingSamples:items.length,validationSamples:audit.n,validation:{accuracy:round(audit.accuracy*100,1),baselineAccuracy:round(audit.baselineAccuracy*100,1),balancedAccuracy:audit.balancedAccuracy===null?null:round(audit.balancedAccuracy*100,1),brier:round(audit.brier,4),baselineBrier:round(audit.baselineBrier,4)},candidates:candidates.map(c=>({model:c.mode,accuracy:round(c.accuracy*100,1),brier:round(c.brier,4)})),features:featureRanks.slice(0,5),lastLabelDate:items.at(-1).labelDate,description:'Three learner candidates are compared on two chronological periods; a later, untouched audit period reports historical accuracy. Each split has a label-horizon gap. Scores are NOT calibrated odds or investment advice.'};
}
return {cleanSeries,features,examples,fitLogit,logitPredict,fitPatterns,patternPredict,makeFolds,trainAndValidate,score};
});
