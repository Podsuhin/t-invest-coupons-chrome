import {calculate,moscowDay} from './lib/calculate.js';
import {demoSnapshot} from './lib/demo.js';

const $ = id=>document.getElementById(id);
const live = !!globalThis.chrome?.runtime?.id;
let demo = !live;
let demoData = null;
let state = {};
let selected = '';
let afterTax = false;
let lastSnapshot = null;
let autoStarted = false;
let polling = false;
const show=(id,value)=>{$(id).hidden=!value;};
const set=(id,value)=>{$(id).textContent=value;};
const rub = cents=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2}).format(cents/100);
function total(value) {
  const items=Object.entries(value.totals);
  if(!items.length&&!value.complete)return '—';
  const amounts=(items.length ? items : [['RUB',0]]).map(([currency,cents])=>new Intl.NumberFormat('ru-RU',{style:'currency',currency,maximumFractionDigits:2,minimumFractionDigits:0}).format(cents/100));
  return (!value.complete?'≥ ':'')+amounts.join(' + ');
}
function plural(n,forms) {return forms[n%100>=11&&n%100<=14?2:n%10===1?0:n%10>=2&&n%10<=4?1:2];}
function count(value) {return `${value.count} ${plural(value.count,['выплата','выплаты','выплат'])}${value.unknown?` · ${value.unknown} без суммы`:''}${value.complete?'':' · неполные данные'}`;}
async function send(type,extra={}) {
  const result=await chrome.runtime.sendMessage({type,...extra});
  if(!result?.ok)throw new Error(result?.error||'Расширение не ответило. Откройте окно ещё раз.');
  return result.data;
}
function notify(text='') {set('notice',text);show('notice',!!text);}
function render(snapshot) {
  lastSnapshot=snapshot;
  show('dashboard',!!snapshot);show('welcome',!snapshot && state.job?.status!=='running');
  $('gross').setAttribute('aria-pressed',String(!afterTax));$('net').setAttribute('aria-pressed',String(afterTax));
  show('demo-banner',demo);
  if(!snapshot)return;
  const m=calculate(snapshot,afterTax);
  set('bond-count',`${m.bondCount} ${plural(m.bondCount,['выпуск','выпуска','выпусков'])}`);set('value',rub(m.valueCents));
  set('annual',total(m.annual));set('annual-caption',m.annual.complete?'По графику выплат':'Только известная часть');
  set('yield',m.yieldPercent===null?'—':`${m.annual.complete?'':'≥ '}${m.yieldPercent.toLocaleString('ru-RU',{maximumFractionDigits:2})}%`);
  $('annual').classList.toggle('partial',!m.annual.complete);
  set('current-month',m.months[0].label);set('paid',total(m.paid));set('paid-count',count(m.paid));
  set('remaining',total(m.months[0].planned));set('remaining-count',count(m.months[0].planned));
  set('next-month',m.months[1].label);set('next',total(m.months[1].planned));set('next-count',count(m.months[1].planned));
  set('third-month',m.months[2].label);set('third',total(m.months[2].planned));set('third-count',count(m.months[2].planned));
  const paid=m.paid.totals.RUB||0, remaining=m.months[0].planned.totals.RUB||0;
  $('paid-progress').style.width=`${paid+remaining?paid/(paid+remaining)*100:0}%`;
  $('warnings').replaceChildren(...m.warnings.map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
  show('warnings',m.warnings.length>0);
  $('breakdown').replaceChildren(...snapshot.portfolio.bonds.map(b=>{
    const row=document.createElement('div');row.className='breakdown-row';
    const name=document.createElement('span');name.textContent=b.name;
    const amount=document.createElement('span');amount.textContent=`${b.quantity.toLocaleString('ru-RU')} шт. · ${rub(b.costCents)}`;
    row.append(name,amount);return row;
  }));
  const updated=new Date(snapshot.updatedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  set('updated',`${demo?'Пример':'Обновлено'} ${updated} · МСК`);
}
function renderState() {
  const job=state.job;
  const busy=job?.status==='running';
  show('loading',busy && !demo);
  $('refresh').disabled=busy || (!state.onSite&&!demo);
  $('start').disabled=!state.onSite;
  $('account').disabled=busy || demo;
  if(busy){set('progress-text',job.message);$('progress').value=job.progress;}
  if(demo){render(demoData ||= demoSnapshot());return;}
  const selectedAccount=selected.match(/portfolio\/(\d+)/)?.[1];
  const snapshot=state.snapshot?.portfolio.account===selectedAccount?state.snapshot:null;
  render(state.onSite?snapshot:null);
  if(!state.onSite)notify('Откройте сайт Т‑Инвестиций. Сбор и просмотр доступны, пока открыта его вкладка.');
  else if(job?.status==='error')notify(job.message+(snapshot?' Показаны данные прошлого сбора.':''));
  else if(!selected)notify('Откройте нужный счёт в разделе «Портфель», затем нажмите значок расширения.');
  else if(snapshot&&snapshot.day!==moscowDay())notify('Данные за прошлый день. Обновите, чтобы увидеть актуальные месяцы и выплаты.');
  else notify();
}
async function refreshState() {
  if(!live||polling)return;
  polling=true;
  try {
    state=await send('state');
    const options=state.accounts||[];
    if(!options.includes(selected))selected=state.preferred||options[0]||'';
    $('account').replaceChildren(...options.map(url=>{const o=document.createElement('option');o.value=url;o.textContent=`•• ${url.match(/portfolio\/(\d+)/)[1].slice(-4)}`;return o;}));
    $('account').value=selected;
    renderState();
  } catch(e){notify(e.message);}finally{polling=false;}
}
async function start() {
  try {
    if(demo){demo=false;demoData=null;await refreshState();}
    if(!selected)throw new Error('Сначала откройте нужный счёт на странице «Портфель».');
    await send('start',{url:selected});await refreshState();
  }catch(e){notify(e.message);}
}
$('refresh').addEventListener('click',()=>{if(demo){demoData=demoSnapshot();render(demoData);}else start();});
$('start').addEventListener('click',start);
$('stop').addEventListener('click',async()=>{try{await send('stop');await refreshState();}catch(e){notify(e.message);}});
$('account').addEventListener('change',()=>{selected=$('account').value;renderState();});
for(const [id,value] of [['gross',false],['net',true]])$(id).addEventListener('click',async()=>{
  afterTax=value;render(lastSnapshot);
  if(live&&!demo)try{await send('tax',{value});}catch(e){notify(e.message);}
});
$('demo').addEventListener('click',()=>{demo=true;notify();renderState();});
$('clear').addEventListener('click',async()=>{if(demo){demoData=demoSnapshot();render(demoData);return;}try{await send('clear');await refreshState();}catch(e){notify(e.message);}});
if(live){
  const exit=document.createElement('button');exit.textContent='Выйти';exit.className='text-button';
  exit.addEventListener('click',async()=>{demo=false;await refreshState();});$('demo-banner').append(exit);
  await refreshState();afterTax=state.afterTax??false;renderState();
  const stale=!state.snapshot || Date.now()-new Date(state.snapshot.updatedAt).getTime()>15*60*1000;
  if(state.onSite&&selected&&stale&&state.job?.status!=='running'&&!autoStarted){autoStarted=true;await start();}
  const interval=setInterval(refreshState,1000);window.addEventListener('pagehide',()=>clearInterval(interval),{once:true});
}else{
  $('account').append(new Option('Демо-портфель','demo'));$('start').disabled=true;renderState();
}
