import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import '../extension/extractor.js';
import '../extension/collector.js';
import {moscowDay,monthStart} from '../extension/lib/calculate.js';
const m=s=>`<span data-qa-type="uikit/money">${s}</span>`;
function setup(html,path) {
  const dom=parseHTML(`<html><body>${html}</body></html>`);
  dom.window.Element.prototype.getClientRects=()=>[{}];
  dom.window.Element.prototype.scrollIntoView=()=>{};
  dom.window.scrollTo=()=>{};
  globalThis.document=dom.document;globalThis.window=dom.window;
  globalThis.location={origin:'https://www.tbank.ru',pathname:path,href:'https://www.tbank.ru'+path};
  return dom.document;
}
test('collector expands the actual future-payment control before reading a full calendar',async()=>{
  const path='/invest/bonds/RU000A000001/coupons/';
  const doc=setup(`<table><tr><th>Дата</th><th>Купон</th><th>Ставка</th></tr><tr id="expand"><td colspan="3">Еще 12 будущих выплат</td></tr><tr><td>22 сентября 2026</td><td>${m('10 ₽')}</td><td>12%</td></tr></table>`,path);
  doc.getElementById('expand').addEventListener('click',()=>doc.getElementById('expand').remove());
  const result=await globalThis.collectBondPage({kind:'coupons',expectedPath:path});
  assert.equal(result.complete,true);assert.equal(result.entries[0].cents,1000);
});
test('desktop collector selects coupon-only filter and verifies month coverage',async()=>{
  const path='/invest/portfolio/123456/events/';
  const day=moscowDay(),month=monthStart(day),previous=monthStart(day,-1);
  const ru=d=>new Date(d+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).replace(' г.','');
  const header=ru(previous).replace(/ \d{4}$/,'')+', понедельник';
  const doc=setup(`<button data-qa-file="FilterButton">Купоны</button><button>${ru(previous)} - ${ru(day)}</button><table id="events"></table>`,path);
  doc.querySelector('button').addEventListener('click',()=>{
    doc.getElementById('events').innerHTML=`<tr data-qa-file="OperationsTable"><td>${header}</td></tr><tr data-qa-file="OperationsTableItem"><td><div>12:30</div><div>Выплата купонов Тест</div><div>RU000A000001, Счёт</div></td><td>${m('+100 ₽')}</td></tr>`;
  });
  const result=await globalThis.collectBondPage({kind:'events',expectedPath:path,month});
  assert.equal(result.complete,true);assert.deepEqual(result.entries,[]);
});
test('collector refuses any unexpected page or origin',async()=>{
  setup('','/auth/');
  await assert.rejects(globalThis.collectBondPage({kind:'events',expectedPath:'/invest/portfolio/123456/events/'}),/перенаправил/);
});
