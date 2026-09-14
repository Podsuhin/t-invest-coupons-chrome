import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import '../extension/extractor.js';
const {readPortfolio,readCoupons,readEvents,date,money}=globalThis.BondLens;
const doc=html=>parseHTML(`<html><body>${html}</body></html>`).document;
const m=s=>`<span data-qa-type="uikit/money">${s}</span>`;
const url='https://www.tbank.ru/invest/portfolio/123456/';
const bond='RU000A000001';

test('Russian money: nested decimals, thin spaces, negative sign and unknown',()=>{
  assert.deepEqual(money('1\u202f234 \n,56 ₽'),{cents:123456,currency:'RUB'});
  assert.deepEqual(money('− 4,50 ₽'),{cents:-450,currency:'RUB'});
  assert.equal(money('Сумма неизвестна'),null);
  assert.equal(money('12 %'),null);
});
test('Russian dates and invalid dates',()=>{
  assert.equal(date('01 сентября 2026 Ближайшая выплата'),'2026-09-01');
  assert.equal(date('16 июня, 2026'),'2026-06-16');
  assert.equal(date('9.09.26 17:09'),'2026-09-09');
  assert.equal(date('31 февраля 2026'),null);
});
test('desktop portfolio sums position value, not price, and excludes funds',()=>{
  const html=`<table><tr><td>Название</td><td>Цена</td><td>Стоимость</td><td>За все время</td></tr>
  <tr><td><a href="/invest/bonds/${bond}/"><div class="PortfolioTable__securityName_abc">Тестовый выпуск</div></a></td><td>${m('900 ₽')}</td><td>${m('9 200,50 ₽')}${m('10 шт.')}</td><td>${m('−20 ₽')}</td></tr>
  <tr><td><a href="/invest/etfs/FUND/">Фонд</a></td><td>${m('10 ₽')}</td><td>${m('500 000 ₽')}${m('50000 шт.')}</td></tr></table>`;
  const result=readPortfolio(doc(html),url);
  assert.equal(result.bonds.length,1);assert.equal(result.totalCents,920050);assert.equal(result.bonds[0].quantity,10);
});
test('mobile portfolio finds quantity in first column and ignores profit',()=>{
  const row=`<tr><td><a href="/invest/bonds/${bond}/"><div class="PortfolioTable__securityName_x">Выпуск</div><div>${m('25 шт.')} • ${m('998,5 ₽')}</div></a></td><td>${m('25 300,25 ₽')}<div>${m('−30,20 ₽')}</div></td></tr>`;
  const result=readPortfolio(doc(`<table>${row}${row}</table>`),url);
  assert.equal(result.totalCents,2530025);assert.equal(result.bonds.length,1);assert.equal(result.bonds[0].quantity,25);
});
test('unparseable bond fails instead of silently understating value',()=>{
  assert.throws(()=>readPortfolio(doc(`<table><tr><td><a href="/invest/bonds/${bond}/">Выпуск</a></td><td>${m('100 ₽')}</td></tr></table>`),url),/количество/);
});
test('desktop and mobile coupons read payout money, keep unknown, detect collapsed schedule',()=>{
  for(const header of ['<th>Дата</th><th>Купон</th><th>Ставка</th>','<th>Дата</th><th>Купон и ставка</th>']) {
    const data=readCoupons(doc(`<table><tr>${header}</tr><tr><td colspan="3">Еще 12 будущих выплат</td></tr><tr><td>22 сентября 2026</td><td>${m('36<span>,65 ₽</span>')}</td><td>14,7%</td></tr><tr><td>22 декабря 2026</td><td>—</td></tr></table>`));
    assert.equal(data.complete,false);assert.equal(data.entries[0].cents,3665);assert.equal(data.entries[1].cents,null);
  }
});
test('mobile events preserve genuine equal credits and reject cancelled',()=>{
  const row=(title='Выплата купонов Тестовый выпуск')=>`<div data-qa-tag="OperationItem"><div>9.09.26 17:09</div><div>${title}</div><div>${m('+125,60 ₽')}</div><div>${bond}, Брокерский счёт</div></div>`;
  const data=readEvents(doc(row()+row()+row('Выплата купонов отменена')),'2026-09-14');
  assert.equal(data.entries.length,2);assert.equal(data.entries[0].cents,12560);assert.equal(data.invalid,0);
});
test('desktop events inherit group dates, cross New Year, and ignore taxes',()=>{
  const heading=s=>`<tr data-qa-file="OperationsTable"><td>${s}</td></tr>`;
  const row=s=>`<tr data-qa-file="OperationsTableItem"><td><div>10:30</div><div>${s}</div><div>${bond}, Брокерский счёт</div></td><td>—</td><td>${m('+100 ₽')}</td></tr>`;
  const data=readEvents(doc(`<table>${heading('03 января, суббота')}${row('Выплата купонов Выпуск')}${row('Удержание налога')}${heading('30 декабря, вторник')}${row('Выплата купонов Выпуск')}</table>`),'2026-01-05');
  assert.equal(data.entries.length,2);assert.equal(data.entries[0].date,'2026-01-03');assert.equal(data.entries[1].date,'2025-12-30');assert.equal(data.oldest,'2025-12-30');assert.equal(data.invalid,0);
});
