import test from 'node:test';
import assert from 'node:assert/strict';
import {moscowDay} from '../extension/lib/calculate.js';

test('scan visits only portfolio, events and held bonds; closes its own tab and stores session-only results',async()=>{
  const session={},local={};
  const area=data=>({setAccessLevel:async()=>{},get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in data).map(k=>[k,structuredClone(data[k])])),set:async values=>Object.assign(data,structuredClone(values)),remove:async keys=>(typeof keys==='string'?[keys]:keys).forEach(k=>delete data[k])});
  const sourceUrl='https://www.tbank.ru/invest/portfolio/123456/';
  const tabs=new Map([[1,{id:1,url:sourceUrl,status:'complete',active:true}]]);
  const visited=[],removed=[];
  let listener;
  globalThis.chrome={
    storage:{session:area(session),local:area(local)},
    runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>{listener=fn;}}},
    tabs:{query:async query=>[...tabs.values()].filter(t=>query.active?t.active:t.url.startsWith(sourceUrl)),get:async id=>{if(!tabs.has(id))throw new Error('No tab');return tabs.get(id);},create:async options=>{const tab={id:2,...options,status:'complete'};tabs.set(2,tab);return tab;},update:async(id,opts)=>{visited.push(opts.url);Object.assign(tabs.get(id),opts);return tabs.get(id);},remove:async id=>{removed.push(id);tabs.delete(id);}},
    scripting:{executeScript:async options=>{
      if(options.files)return [{}];
      const kind=options.args[0].kind;
      const data=kind==='portfolio'?{account:'123456',totalCents:100000,bonds:[{id:'RU000A000001',name:'Тест',quantity:1,costCents:100000,currency:'RUB',url:'https://www.tbank.ru/invest/bonds/RU000A000001/'}]}:kind==='events'?{entries:[],complete:true}:{entries:[{date:moscowDay(),cents:1000,currency:'RUB'}],complete:true};
      return [{result:{data}}];
    }}
  };
  await import('../extension/background.js');
  const message=(type,extra={},sender={id:'test',url:'chrome-extension://test/popup.html'})=>new Promise(resolve=>listener({type,...extra},sender,resolve));
  const blocked=await message('start',{url:sourceUrl},{id:'test',url:'https://www.tbank.ru/invest/'});
  assert.equal(blocked.ok,false);
  const [a,b]=await Promise.all([message('start',{url:sourceUrl}),message('start',{url:sourceUrl})]);
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  const until=Date.now()+5000;
  while(Date.now()<until && (!session.snapshot || tabs.has(2)))await new Promise(r=>setTimeout(r,10));
  assert.equal(session.job.status,'done');assert.equal(session.snapshot.portfolio.bonds.length,1);
  assert.deepEqual(visited,[sourceUrl,sourceUrl+'events/','https://www.tbank.ru/invest/bonds/RU000A000001/coupons/']);
  assert.deepEqual(removed,[2]);assert.equal(tabs.get(1).url,sourceUrl);
  assert.equal(local.snapshot,undefined);assert.equal(local.lastPortfolio,sourceUrl);
  await message('tax',{value:true});assert.equal(local.afterTax,true);
  await message('clear');assert.equal(session.snapshot,undefined);assert.equal(local.lastPortfolio,undefined);
  delete globalThis.chrome;
});
