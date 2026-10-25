(function(root){
  const RETRY = {brand:'一口好运',name:'再来一次',note:'好运加送一次，点下方按钮马上再抽。',kind:'retry',pct:3};
  function pick(drinks, random=Math.random){
    const value=random();
    if(value<.03)return {...RETRY};
    const total=drinks.reduce((sum,d)=>sum+1/d.price,0);
    let edge=(value-.03)/.97*total;
    for(const drink of drinks){edge-=1/drink.price;if(edge<0)return drink}
    return drinks[drinks.length-1];
  }
  function dayKey(now=new Date()) { return new Date(now.getTime()+8*3600000).toISOString().slice(0,10); }
  const api={RETRY,pick,dayKey};
  if(typeof module!=='undefined')module.exports=api;else root.GameRules=api;
})(globalThis);
