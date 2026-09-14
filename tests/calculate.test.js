import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,monthStart,yearEnd,moscowDay} from '../extension/lib/calculate.js';
function sample() {
  return {day:'2026-09-14',portfolio:{totalCents:10000000,bonds:[{id:'A',name:'Облигация',quantity:10}]},events:{complete:true,entries:[{id:'SOLD',date:'2026-09-01',cents:20000,currency:'RUB'},{id:'A',date:'2026-09-14',cents:10000,currency:'RUB'},{id:'A',date:'2026-08-01',cents:999999,currency:'RUB'}]},calendars:{A:{complete:true,entries:[{date:'2026-09-14',cents:1000,currency:'RUB'},{date:'2026-09-20',cents:1000,currency:'RUB'},{date:'2026-10-20',cents:1200,currency:'RUB'},{date:'2026-11-20',cents:1300,currency:'RUB'},{date:'2027-09-13',cents:1400,currency:'RUB'},{date:'2027-09-14',cents:1500,currency:'RUB'}]}}};
}
test('tax changes only income and yield, leaving bond value intact',()=>{
  const before=calculate(sample()), after=calculate(sample(),true);
  assert.equal(before.valueCents,after.valueCents);
  assert.equal(after.annual.totals.RUB,Math.round(before.annual.totals.RUB*.87));
  assert.equal(after.paid.totals.RUB,26100);
  assert.ok(Math.abs(after.yieldPercent-before.yieldPercent*.87)<1e-10);
});
test('current month separates actual receipts, including sold bonds, from future payments',()=>{
  const m=calculate(sample());
  assert.equal(m.paid.totals.RUB,30000);assert.equal(m.paid.count,2);
  assert.equal(m.months[0].planned.totals.RUB,10000);
  assert.equal(m.months[1].planned.totals.RUB,12000);
  assert.equal(m.months[2].planned.totals.RUB,13000);
});
test('annual window excludes already credited today and the next anniversary',()=>{
  assert.equal(calculate(sample()).annual.totals.RUB,49000);
});
test('unknown coupons and failed calendars cannot appear complete',()=>{
  const s=sample();s.calendars.A.entries[2].cents=null;
  assert.equal(calculate(s).annual.complete,false);
  assert.equal(calculate(s).months[1].planned.unknown,1);
  delete s.calendars.A;
  const m=calculate(s);assert.equal(m.annual.complete,false);assert.equal(m.yieldPercent,null);assert.ok(m.warnings.length);
});
test('foreign currencies are never added to rubles or treated as ruble yield',()=>{
  const s=sample();s.calendars.A.entries[2].currency='USD';
  const m=calculate(s);assert.equal(m.annual.totals.USD,12000);assert.equal(m.yieldPercent,null);
});
test('calendar boundaries use Moscow and handle December and leap days',()=>{
  assert.equal(moscowDay(new Date('2026-08-31T21:05:00Z')),'2026-09-01');
  assert.equal(monthStart('2026-12-31',1),'2027-01-01');
  assert.equal(yearEnd('2028-02-29'),'2029-02-28');
  const s=sample();s.day='2026-12-14';const m=calculate(s);
  assert.match(m.months[1].label,/Январь 2027/);assert.match(m.months[2].label,/Февраль 2027/);
});
test('incomplete event history remains visibly incomplete',()=>{
  const s=sample();s.events.complete=false;
  assert.equal(calculate(s).paid.complete,false);
});
