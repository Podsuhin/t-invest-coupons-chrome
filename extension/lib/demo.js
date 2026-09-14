import {moscowDay,monthStart} from './calculate.js';
export function demoSnapshot() {
  const day=moscowDay(), base=monthStart(day);
  const at=(month,d)=>monthStart(day,month).slice(0,8)+String(d).padStart(2,'0');
  const bonds=[{id:'DEMO01',name:'Пример · облигация А',quantity:420,costCents:42528000,currency:'RUB'},{id:'DEMO02',name:'Пример · облигация Б',quantity:300,costCents:30420000,currency:'RUB'},{id:'DEMO03',name:'Пример · облигация В',quantity:500,costCents:50850000,currency:'RUB'}];
  const calendars=Object.fromEntries(bonds.map((b,i)=>[b.id,{complete:true,entries:Array.from({length:13},(_,m)=>({date:at(m,20+i*3),cents:[1235,1390,1475][i],currency:'RUB'}))}]));
  return {day,updatedAt:new Date().toISOString(),portfolio:{account:'ПРИМЕР',bonds,totalCents:123798000},events:{complete:true,entries:[{id:'DEMO01',name:'Пример · облигация А',date:base,cents:518700,currency:'RUB'},{id:'DEMO02',name:'Пример · облигация Б',date:base,cents:417000,currency:'RUB'}]},calendars,warnings:[]};
}
