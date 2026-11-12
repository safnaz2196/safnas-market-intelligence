'use strict';
// Safnas ULTRA v4: deterministic nonlinear research models, fixed hyperparameters.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),avg=x=>x.reduce((s,v)=>s+v,0)/Math.max(1,x.length);
function rng(seed){return ()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};}
function thresholds(data,j){const v=[...new Set(data.map(r=>r.x[j]))].sort((a,b)=>a-b);if(v.length<3)return [];return [0.2,0.4,0.6,0.8].map(q=>v[Math.floor(q*(v.length-1))]).filter((x,i,a)=>i===0||x!==a[i-1]);}
function fitTree(data,depth=2,allowed=null){
 if(!data.length)return {leaf:true,p:.5};const prior=(data.reduce((s,r)=>s+r.y,0)+2)/(data.length+4);
 if(depth===0||data.length<18)return {leaf:true,p:prior};
 const fs=allowed||Array.from({length:data[0].x.length},(_,i)=>i);let best=null,score=Infinity;
 for(const j of fs)for(const cut of thresholds(data,j)){
  const l=data.filter(r=>r.x[j]<=cut),r=data.filter(r=>r.x[j]>cut);if(l.length<8||r.length<8)continue;
  const imp=g=>{const p=avg(g.map(z=>z.y));return g.length*p*(1-p)};
  const loss=imp(l)+imp(r)+.25;if(loss<score){score=loss;best={j,cut,l,r};}
 }
 if(!best)return {leaf:true,p:prior};
 return {leaf:false,j:best.j,cut:best.cut,l:fitTree(best.l,depth-1,allowed),r:fitTree(best.r,depth-1,allowed)};
}
function treePredict(tree,x){let node=tree;while(!node.leaf)node=x[node.j]<=node.cut?node.l:node.r;return node.p;}
function forestFit(records,trees=32){
 if(records.length<60)throw Error('Too few samples for forest');
 const rand=rng(4781),dim=records[0].x.length,result=[];
 for(let t=0;t<trees;t++){const boot=Array.from({length:records.length},()=>records[Math.floor(rand()*records.length)]);const shuffled=Array.from({length:dim},(_,i)=>i);
  for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]}
  result.push(fitTree(boot,2,shuffled.slice(0,Math.max(3,Math.round(Math.sqrt(dim))))));
 }
 return {kind:'Random forest · 32 shallow trees',trees:result};
}
function forestPredict(m,x){return clamp(avg(m.trees.map(t=>treePredict(t,x))),.02,.98);}
function bestResidualStump(records,residual){let best=null,bestError=Infinity;
 for(let j=0;j<records[0].x.length;j++)for(const cut of thresholds(records,j)){
  let lsum=0,rsum=0,ln=0,rn=0;for(let i=0;i<records.length;i++){if(records[i].x[j]<=cut){lsum+=residual[i];ln++}else{rsum+=residual[i];rn++}}
  if(ln<8||rn<8)continue;const lv=clamp(lsum/ln,-1,1),rv=clamp(rsum/rn,-1,1);
  let loss=0;for(let i=0;i<records.length;i++){const e=residual[i]-(records[i].x[j]<=cut?lv:rv);loss+=e*e}
  if(loss<bestError){bestError=loss;best={j,cut,lv,rv}}
 }return best;
}
const sigmoid=v=>v>=35?1:v<=-35?0:1/(1+Math.exp(-v));
function boostFit(records,rounds=36){if(records.length<60)throw Error('Too few samples for boosting');
 const p=clamp(avg(records.map(r=>r.y)),.08,.92),bias=Math.log(p/(1-p)),scores=records.map(()=>bias),stumps=[],lr=.22;
 for(let n=0;n<rounds;n++){const residual=records.map((r,i)=>r.y-sigmoid(scores[i])),best=bestResidualStump(records,residual);
  if(!best)break;stumps.push(best);records.forEach((r,i)=>{scores[i]+=lr*(r.x[best.j]<=best.cut?best.lv:best.rv)})}
 return {kind:'Gradient boosted stumps',bias,lr,stumps};
}
function boostPredict(m,x){let score=m.bias;for(const s of m.stumps)score+=m.lr*(x[s.j]<=s.cut?s.lv:s.rv);return clamp(sigmoid(score),.02,.98);}
module.exports={forestFit,forestPredict,boostFit,boostPredict,fitTree,treePredict};
