(function(root){
  function distribution(drinks){
    return drinks.map((drink,index)=>({drink,index,prob:1/drinks.length}));
  }
  function pick(drinks, random=Math.random){
    if(!drinks.length)return undefined;
    return drinks[Math.floor(random()*drinks.length)];
  }
  function dayKey(now=new Date()) { return new Date(now.getTime()+8*3600000).toISOString().slice(0,10); }
  const api={distribution,pick,dayKey};
  if(typeof module!=='undefined')module.exports=api;else root.GameRules=api;
})(globalThis);
