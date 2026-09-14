/* Runs in Chrome's isolated world. Reads rendered tables, never cookies or app state. */
(() => {
  const norm = (value) => String(value ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  const text = (el) => norm(el?.innerText ?? el?.textContent);
  const moneySelector = '[data-qa-type="uikit/money"]';
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  function number(value) {
    const match = norm(value).replace(/−/g, '-').match(/[+-]?\s*\d[\d ]*(?:\s*[,.]\s*\d+)?/);
    if (!match) return null;
    const n = Number(match[0].replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function money(value) {
    const s = norm(value);
    const currency = /₽|\bRUB\b|руб\./i.test(s) ? 'RUB' : /\$|\bUSD\b/.test(s) ? 'USD' : /€|\bEUR\b/.test(s) ? 'EUR' : /¥|\bCNY\b/.test(s) ? 'CNY' : null;
    const n = number(s);
    return currency && n !== null ? {cents: Math.round(n * 100), currency} : null;
  }
  function date(value) {
    const s = norm(value).toLowerCase();
    let m = s.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/);
    let d, mo, y;
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3] + (m[3].length === 2 ? 2000 : 0); }
    else {
      m = s.match(/\b(\d{1,2})\s+([а-яё]+),?\s+(\d{4})/);
      if (!m) return null;
      d = +m[1]; mo = months.indexOf(m[2]) + 1; y = +m[3];
    }
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return mo && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
  }
  function readPortfolio(doc = document, url = location.href) {
    const account = new URL(url).pathname.match(/^\/invest\/portfolio\/(\d+)\/?$/)?.[1];
    if (!account) throw new Error('Откройте обзор конкретного счёта в разделе «Портфель».');
    const bonds = new Map();
    const errors = [];
    for (const table of doc.querySelectorAll('table')) {
      const rows = [...table.querySelectorAll('tr')];
      const headers = rows[0] ? [...rows[0].querySelectorAll('th,td')].map(text) : [];
      const namedCost = headers.findIndex(t => t === 'Стоимость');
      for (const row of rows) {
        const a = [...row.querySelectorAll('a[href]')].find(a => /^\/invest\/bonds\/[A-Za-z0-9]+\/$/.test(new URL(a.getAttribute('href'), url).pathname));
        if (!a) continue;
        const href = new URL(a.getAttribute('href'), url);
        if (href.origin !== 'https://www.tbank.ru') continue;
        const id = href.pathname.split('/')[3];
        const cells = [...row.querySelectorAll('td')];
        const qtyEl = [...row.querySelectorAll(moneySelector)].find(el => /шт\./.test(text(el)));
        const quantity = number(text(qtyEl));
        const costCell = cells[namedCost >= 0 ? namedCost : cells.length >= 4 ? 2 : 1];
        const cost = money(text(costCell?.querySelector(moneySelector)));
        const name = text(cells[0]?.querySelector('[class*="securityName"]')) || text(cells[0]).split(id)[0].trim();
        if (!cost || quantity === null || quantity < 0 || !Number.isSafeInteger(quantity)) {
          errors.push(`Не удалось прочитать стоимость или количество: ${id}.`); continue;
        }
        const item = {id, name, quantity, costCents: cost.cents, currency: cost.currency, url: href.href};
        const old = bonds.get(id);
        if (old && (old.quantity !== quantity || old.costCents !== item.costCents)) errors.push(`Строки ${id} расходятся. Обновите портфель.`);
        bonds.set(id, item);
      }
    }
    if (errors.length) throw new Error(errors.join(' '));
    const hasBondHeading = [...doc.querySelectorAll('h1,h2,h3,span,div')].some(el => el.children.length === 0 && text(el) === 'Облигации');
    if (!bonds.size && hasBondHeading) throw new Error('Разверните блок «Облигации» на странице портфеля.');
    if (!bonds.size && !doc.querySelector('table') && !/В портфеле пока ничего нет|У вас пока нет бумаг|Портфель пуст/i.test(text(doc.body))) return null;
    const values = [...bonds.values()].filter(b => b.quantity > 0);
    if (values.some(b => b.currency !== 'RUB')) throw new Error('Выберите на сайте стоимость портфеля в рублях и повторите сбор.');
    return {account, bonds: values, totalCents: values.reduce((s,b) => s+b.costCents,0), capturedAt: new Date().toISOString()};
  }
  function readCoupons(doc = document) {
    const table = [...doc.querySelectorAll('table')].find(t => {
      const header = text(t.querySelector('tr'));
      return /Дата/.test(header) && /Купон/.test(header) && /Ставка|ставка/.test(header);
    });
    if (!table) return null;
    const entries = new Map();
    let invalid = 0;
    for (const row of table.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('td')];
      if (cells.length < 2) continue;
      const day = date(text(cells[0]));
      if (!day) { if (!/Дата/.test(text(row))) invalid++; continue; }
      const amountEl = cells.slice(1).flatMap(c => [...c.querySelectorAll(moneySelector)])[0];
      const amount = money(text(amountEl));
      const key = day;
      const entry = {date: day, cents: amount?.cents ?? null, currency: amount?.currency ?? null};
      const old = entries.get(key);
      if (old && JSON.stringify(old) !== JSON.stringify(entry)) throw new Error('На одну дату найдены разные купоны. Нужна проверка календаря.');
      entries.set(key, entry);
    }
    const collapsed = /Ещ[её]\s+\d+\s+будущих выплат/i.test(text(table));
    if (invalid) throw new Error('Изменился формат дат в купонном календаре.');
    return {entries:[...entries.values()].sort((a,b)=>a.date.localeCompare(b.date)), complete:!collapsed, capturedAt:new Date().toISOString()};
  }
  function readEvents(doc = document, referenceDay = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())) {
    const mobile = [...doc.querySelectorAll('[data-qa-tag="OperationItem"]')];
    const nodes = mobile.length ? mobile : [...doc.querySelectorAll('tr[data-qa-file="OperationsTable"],tr[data-qa-file="OperationsTableItem"]')];
    const entries = [];
    const allDates = [];
    let invalid = 0;
    let groupDate = null, lastGroup = referenceDay, rowCount = 0;
    for (const row of nodes) {
      const value = text(row);
      if (!mobile.length && row.getAttribute('data-qa-file') === 'OperationsTable') {
        if (row.querySelector('button')) continue;
        const heading = text(row.querySelector('td'));
        const dayMonth = heading.match(/^(\d{1,2}\s+[а-яё]+)/i)?.[1];
        if (dayMonth) {
          let year = +lastGroup.slice(0,4);
          let candidate = date(`${dayMonth} ${year}`);
          if (candidate && candidate>lastGroup) candidate = date(`${dayMonth} ${year-1}`);
          groupDate = candidate;
          if (candidate) lastGroup = candidate;
        } else groupDate = date(heading);
        continue;
      }
      rowCount++;
      const day = mobile.length ? date(value) : groupDate;
      if (day) allDates.push(day);
      if (!/Выплата купонов/i.test(value) || /отменен|отменён|отклонен|отклонён/i.test(value)) continue;
      const amount = [...row.querySelectorAll(moneySelector)].map(el => money(text(el))).find(Boolean);
      const id = value.match(/\b[A-Z]{2}[A-Z0-9]{10}\b/)?.[0];
      const title = [...row.querySelectorAll('div,span')].find(el=>el.children.length===0 && /^Выплата купонов/.test(text(el)));
      const name = text(title).replace(/^Выплата купонов(?: на карту)?\s*/,'') || id || 'Купон';
      if (!day || !amount || !id || amount.cents <= 0) {invalid++;continue;}
      // Keep distinct equal payments: two identical rows can be real separate credits.
      entries.push({id, name, date:day, cents:amount.cents, currency:amount.currency});
    }
    return {entries, oldest:allDates.sort()[0] || null, rowCount, invalid};
  }
  globalThis.BondLens = Object.freeze({norm, number, money, date, readPortfolio, readCoupons, readEvents});
})();
