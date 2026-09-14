export const TAX_FACTOR = 0.87;
export function moscowDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function monthStart(day, offset = 0) {
  const [y,m] = day.split('-').map(Number);
  return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,10);
}
export function yearEnd(day) {
  const [y,m,d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y+1,m,0)).getUTCDate();
  return new Date(Date.UTC(y+1,m-1,Math.min(d,last))).toISOString().slice(0,10);
}
export function monthName(day) {
  const s = new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')).replace(/\s*г\.$/,'');
  return s[0].toUpperCase()+s.slice(1);
}
export function calculate(snapshot, afterTax = false) {
  const today = snapshot.day;
  const start = monthStart(today), end = yearEnd(today);
  const factor = afterTax ? TAX_FACTOR : 1;
  const paid = snapshot.events.entries.filter(e=>e.date>=start && e.date<=today);
  const warnings = [...(snapshot.warnings || [])];
  const scheduled = [];
  let missingCalendars = 0;
  for (const bond of snapshot.portfolio.bonds) {
    const calendar = snapshot.calendars[bond.id];
    if (!calendar || !calendar.complete) {missingCalendars++;continue;}
    for (const e of calendar.entries) {
      if (e.date < today || e.date >= end) continue;
      // Today's transfer already recorded in Events is not another future payment.
      if (e.date === today && paid.some(p=>p.id===bond.id && p.date===today)) continue;
      scheduled.push({...e,id:bond.id,name:bond.name,quantity:bond.quantity,cents:e.cents===null?null:Math.round(e.cents*bond.quantity)});
    }
  }
  function aggregate(entries, complete = true) {
    const totals = {};
    let unknown = 0;
    for (const e of entries) {
      if (e.cents === null || !e.currency) {unknown++;continue;}
      totals[e.currency] = (totals[e.currency] || 0) + e.cents;
    }
    for (const currency of Object.keys(totals)) totals[currency] = Math.round(totals[currency]*factor);
    return {totals, count:entries.length, unknown, complete:complete && unknown===0};
  }
  const annual = aggregate(scheduled, !missingCalendars);
  const months = [0,1,2].map(i=> {
    const from = monthStart(today,i), to = monthStart(today,i+1);
    return {key:from,label:monthName(from),planned:aggregate(scheduled.filter(e=>e.date>=from&&e.date<to), !missingCalendars)};
  });
  const paidTotal = aggregate(paid,snapshot.events.complete);
  const foreign = Object.keys(annual.totals).some(c=>c!=='RUB');
  const yieldPercent = snapshot.portfolio.totalCents>0 && !foreign && (annual.complete || Object.keys(annual.totals).length) ? (annual.totals.RUB||0)/snapshot.portfolio.totalCents*100 : null;
  if (missingCalendars) warnings.push(`Не прочитан полный календарь: ${missingCalendars} из ${snapshot.portfolio.bonds.length} облигаций. Итоги неполные.`);
  if (annual.unknown) warnings.push(`Размер ${annual.unknown} будущих купонов не указан на сайте. Эти суммы пока неизвестны.`);
  if (!snapshot.events.complete) warnings.push('История событий за месяц прочитана не полностью.');
  if (foreign) warnings.push('Купоны в разных валютах показаны отдельно. Общая доходность в рублях не рассчитывается без курса.');
  return {valueCents:snapshot.portfolio.totalCents,bondCount:snapshot.portfolio.bonds.length,paid:paidTotal,months,annual,yieldPercent,afterTax,warnings:[...new Set(warnings)],scheduled,paidEntries:paid};
}
