import {moscowDay,monthStart} from './lib/calculate.js';

const SITE = 'https://www.tbank.ru';
let running = false;
let stopped = false;
let workerTabId = null;
const pause = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const init = Promise.all([
  chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
  chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
]).then(async()=>{
  const {job} = await chrome.storage.session.get('job');
  if (job?.status==='running') {
    if (job.workerTabId) await chrome.tabs.remove(job.workerTabId).catch(()=>{});
    await chrome.storage.session.set({job:{status:'error',message:'Предыдущий сбор прервался. Нажмите «Обновить».',updatedAt:Date.now()}});
  }
});
function portfolioUrl(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/^\/invest\/portfolio\/(\d+)(?:\/|$)/);
    return u.origin===SITE && match ? `${SITE}/invest/portfolio/${match[1]}/` : null;
  } catch {return null;}
}
async function context() {
  const [active] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  const onSite = active?.url?.startsWith(SITE+'/invest/') ?? false;
  const tabs = await chrome.tabs.query({url:SITE+'/invest/portfolio/*'});
  const accounts = [...new Set(tabs.filter(t=>t.id!==workerTabId).map(t=>portfolioUrl(t.url)).filter(Boolean))];
  const {lastPortfolio} = await chrome.storage.local.get('lastPortfolio');
  const preferred = portfolioUrl(active?.url) || (accounts.length===1?accounts[0]:null) || portfolioUrl(lastPortfolio);
  if (preferred && !accounts.includes(preferred)) accounts.unshift(preferred);
  return {onSite,accounts,preferred};
}
async function updateJob(data) {
  const {job={}} = await chrome.storage.session.get('job');
  await chrome.storage.session.set({job:{...job,...data,updatedAt:Date.now(),workerTabId}});
}
async function checkSource(sourceId) {
  if (stopped) throw new Error('Сбор остановлен.');
  const source = await chrome.tabs.get(sourceId).catch(()=>null);
  if (!source?.url?.startsWith(SITE+'/invest/')) throw new Error('Исходная вкладка Т‑Инвестиций закрыта. Сбор остановлен.');
}
async function loadPage(url,kind,month,sourceId) {
  await checkSource(sourceId);
  await chrome.tabs.update(workerTabId,{url});
  const deadline = Date.now()+25000;
  let loaded = false;
  while (Date.now()<deadline) {
    await pause(300);
    await checkSource(sourceId);
    const tab = await chrome.tabs.get(workerTabId);
    if (tab.status==='complete' && tab.url===url) {loaded=true;break;}
    if (tab.status==='complete' && tab.url && !tab.url.startsWith(SITE+'/invest/')) throw new Error('Войдите в Т‑Инвестиции в этом профиле Chrome.');
  }
  if (!loaded) throw new Error('Сайт долго загружает страницу. Повторите сбор.');
  await chrome.scripting.executeScript({target:{tabId:workerTabId},files:['extractor.js','collector.js']});
  const [{result}] = await chrome.scripting.executeScript({target:{tabId:workerTabId},func:async args=>{
    try {return {data:await globalThis.collectBondPage(args)};} catch(e) {return {error:e.message};}
  },args:[{kind,month,expectedPath:new URL(url).pathname}]});
  if (result?.error) throw new Error(result.error);
  if (!result?.data) throw new Error('Не удалось прочитать страницу.');
  return result.data;
}
async function scan(url,sourceId) {
  const day = moscowDay(), month = monthStart(day);
  // A scan is user initiated and bounded; keep the worker alive if the popup closes
  // while an inactive site tab is waiting for its table to render.
  const heartbeat = setInterval(()=>chrome.storage.session.get('job').catch(()=>{}),20000);
  try {
    const worker = await chrome.tabs.create({url:'about:blank',active:false});
    workerTabId = worker.id;
    await updateJob({status:'running',message:'Читаю облигации в портфеле…',progress:3,portfolioUrl:url});
    const portfolio = await loadPage(url,'portfolio',month,sourceId);
    await updateJob({message:'Читаю выплаченные купоны в «Событиях»…',progress:12});
    const warnings = [];
    let events;
    try {events = await loadPage(url+'events/','events',month,sourceId);}
    catch(e) {await checkSource(sourceId);events={entries:[],complete:false};warnings.push(`События: ${e.message}`);}
    const calendars = {};
    for (const [index,bond] of portfolio.bonds.entries()) {
      await updateJob({message:`Купоны: ${index+1} из ${portfolio.bonds.length} · ${bond.name}`,progress:20+Math.round(index/portfolio.bonds.length*76)});
      try {calendars[bond.id] = await loadPage(bond.url+'coupons/','coupons',month,sourceId);}
      catch(e) {await checkSource(sourceId);warnings.push(`${bond.name}: ${e.message}`);}
    }
    await checkSource(sourceId);
    if (moscowDay()!==day) throw new Error('Во время сбора начался новый день. Обновите данные.');
    const snapshot = {day,portfolio,events,calendars,warnings,updatedAt:new Date().toISOString()};
    await chrome.storage.session.set({snapshot});
    await chrome.storage.local.set({lastPortfolio:url});
    await updateJob({status:'done',message:'Данные обновлены',progress:100});
  } catch(e) {
    await updateJob({status:'error',message:e.message || 'Не удалось прочитать сайт.'});
  } finally {
    clearInterval(heartbeat);
    if (workerTabId) await chrome.tabs.remove(workerTabId).catch(()=>{});
    workerTabId = null; running = false;
  }
}
async function handle(message,sender) {
  await init;
  if (sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('popup.html')) throw new Error('Запрос доступен только из окна расширения.');
  if (message.type==='state') {
    const [session,prefs,ctx] = await Promise.all([chrome.storage.session.get(['snapshot','job']),chrome.storage.local.get(['afterTax']),context()]);
    return {...session,afterTax:prefs.afterTax??false,...ctx};
  }
  if (message.type==='tax') {await chrome.storage.local.set({afterTax:!!message.value});return {};}
  if (message.type==='stop') {stopped=true; if(workerTabId)await chrome.tabs.remove(workerTabId).catch(()=>{});return {};}
  if (message.type==='start') {
    if (running) return {};
    running=true;
    try {
      const ctx = await context();
      if (!ctx.onSite) throw new Error('Откройте сайт Т‑Инвестиций и нажмите значок расширения.');
      const url = portfolioUrl(message.url);
      if (!url || !ctx.accounts.includes(url)) throw new Error('Сначала откройте нужный счёт в разделе «Портфель».');
      const [active] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
      stopped=false;
      await updateJob({status:'running',message:'Начинаю сбор с сайта…',progress:0,portfolioUrl:url});
      void scan(url,active.id);
      return {};
    } catch(e) {running=false;throw e;}
  }
  if (message.type==='clear') {
    if (running) throw new Error('Сначала остановите сбор.');
    await chrome.storage.session.remove(['snapshot','job']);
    await chrome.storage.local.remove('lastPortfolio');return {};
  }
  throw new Error('Неизвестная команда.');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  handle(message,sender).then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message}));
  return true;
});
