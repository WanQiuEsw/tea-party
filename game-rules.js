(function(root){
  const RETRY = {brand:'一口好运',name:'再来一次',note:'好运加送一次，点下方按钮马上再抽。',kind:'retry',pct:3};
  const TIERS = [
    {key:'king',label:'王者',range:'第 1 名 · 最稀有',factor:.15},
    {key:'diamond',label:'钻石',range:'第 2–4 名',factor:.5},
    {key:'gold',label:'黄金',range:'第 5–8 名',factor:1},
    {key:'bronze',label:'青铜',range:'第 9 名起',factor:1.5}
  ];
  function distribution(drinks){
    const ranked=drinks.map((drink,index)=>({drink,index})).sort((a,b)=>b.drink.price-a.drink.price||(a.drink.id??a.index)-(b.drink.id??b.index));
    ranked.forEach((entry,index)=>{
      entry.rank=index+1;
      entry.tier=TIERS[index===0?0:index<4?1:index<8?2:3];
      entry.weight=entry.tier.factor/entry.drink.price;
    });
    const total=ranked.reduce((sum,entry)=>sum+entry.weight,0);
    ranked.forEach(entry=>entry.prob=.97*entry.weight/total);
    return ranked.sort((a,b)=>a.index-b.index);
  }
  function pick(drinks, random=Math.random){
    if(!drinks.length)return undefined;
    const value=random();
    if(value<.03)return {...RETRY};
    let edge=value-.03;
    for(const entry of distribution(drinks)){edge-=entry.prob;if(edge<0)return entry.drink}
    return drinks[drinks.length-1];
  }
  function dayKey(now=new Date()) { return new Date(now.getTime()+8*3600000).toISOString().slice(0,10); }
  const api={RETRY,TIERS,distribution,pick,dayKey};
  if(typeof module!=='undefined')module.exports=api;else root.GameRules=api;
})(globalThis);
