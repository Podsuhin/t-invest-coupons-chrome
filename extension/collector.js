/* Only invoked in the temporary tab created for this scan. */
globalThis.collectBondPage = async ({kind, month, expectedPath}) => {
  if (location.origin !== 'https://www.tbank.ru' || location.pathname !== expectedPath) throw new Error('Сайт перенаправил страницу. Проверьте вход в Т‑Инвестиции.');
  const {norm, readPortfolio, readCoupons, readEvents} = globalThis.BondLens;
  const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const txt = el => norm(el?.textContent);
  const visible = el => !!(el && el.getClientRects().length);
  async function until(fn, timeout=20000) {
    const end = Date.now()+timeout;
    while (Date.now()<end) {
      if (location.pathname !== expectedPath) throw new Error('Сессия сайта изменилась. Войдите в Т‑Инвестиции и повторите сбор.');
      const result = fn();
      if (result) return result;
      await pause(350);
    }
    throw new Error('Страница не загрузила нужные данные за 20 секунд. Повторите сбор.');
  }
  const buttons = () => [...document.querySelectorAll('button,[role="button"]')].filter(visible);
  const operationSelector = '[data-qa-tag="OperationItem"],tr[data-qa-file="OperationsTableItem"]';
  if (kind === 'portfolio') {
    await until(()=>document.querySelector('table') || /В портфеле пока ничего нет|У вас пока нет бумаг|Портфель пуст/i.test(txt(document.body)));
    // A collapsed section is expanded only in our own temporary tab.
    const heading = [...document.querySelectorAll('span,div,h2,h3')].find(el=>el.children.length===0 && txt(el)==='Облигации');
    if (heading && !document.querySelector('table a[href*="/invest/bonds/"]')) {
      const parent = heading.parentElement;
      if (/Развернуть/.test(txt(parent))) parent.click();
    }
    await until(()=>readPortfolio());
    // Bring lazily rendered lower sections into view, then verify a stable row set.
    window.scrollTo(0,document.body.scrollHeight);
    await pause(700);
    let current = readPortfolio();
    for (let i=0;i<8;i++) {
      const more = buttons().find(b=>/^(Показать|Загрузить) (ещ[её]|все)/i.test(txt(b)));
      if (!more) break;
      more.click(); await pause(650);
      current = readPortfolio();
    }
    if (buttons().some(b=>/^(Показать|Загрузить) (ещ[её]|все)/i.test(txt(b)))) throw new Error('Не удалось раскрыть все строки портфеля.');
    return current;
  }
  if (kind === 'coupons') {
    await until(()=>readCoupons());
    for (let i=0;i<30;i++) {
      const toggle = [...document.querySelectorAll('td,span,button')].find(el=>visible(el) && /^Ещ[её]\s+\d+\s+будущих выплат$/i.test(txt(el)));
      if (!toggle) break;
      toggle.click(); await pause(250);
    }
    const result = readCoupons();
    if (!result?.complete) throw new Error('Не удалось раскрыть все будущие купоны.');
    return result;
  }
  if (kind === 'events') {
    await until(()=>buttons().find(b=>/^(Все события|Тип события|Купоны)/.test(txt(b))));
    const desktopFilter = buttons().find(b=>txt(b)==='Купоны');
    if (desktopFilter) desktopFilter.click();
    else {
      const filter = buttons().find(b=>/^(Все события|Тип события)/.test(txt(b)));
      filter.click();
      const option = await until(()=>[...document.querySelectorAll('[role="option"]')].find(el=>visible(el)&&txt(el)==='Купоны'));
      if (option.getAttribute('aria-selected') !== 'true') option.click();
      await pause(350);
      if ([...document.querySelectorAll('[role="listbox"]')].some(visible)) buttons().find(b=>/^(Все события|Тип события)/.test(txt(b)))?.click();
    }
    await pause(650);
    const hideCanceled = [...document.querySelectorAll('input[type="checkbox"]')].find(el=>/Скрыть отмененные/.test(txt(el.closest('label')||el.parentElement)));
    if (hideCanceled && !hideCanceled.checked) {hideCanceled.click();await pause(350);}
    const dateButton = buttons().find(b=>/\d{4}\s*-\s*\d/.test(txt(b)));
    const rangeStart = dateButton ? globalThis.BondLens.date(txt(dateButton).split(' - ')[0]) : null;
    const rangeEnd = dateButton ? globalThis.BondLens.date(txt(dateButton).split(' - ')[1]) : null;
    const nowDay = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if (!rangeStart || !rangeEnd || rangeStart>month || rangeEnd<nowDay) throw new Error('Период в «Событиях» не охватывает текущий месяц. На сайте выберите период от начала месяца до сегодня.');
    await until(()=> {
      const rows = [...document.querySelectorAll(operationSelector)];
      return rows.length ? rows.every(row=>/Выплата купонов/.test(txt(row))) : /Нет событий|Ничего не найдено|Событий не найдено|За выбранный период.*нет/i.test(txt(document.body));
    });
    let result = readEvents();
    let unchanged = 0;
    for (let i=0;i<50 && (!result.oldest || result.oldest>=month);i++) {
      if (!result.rowCount && /Нет событий|Ничего не найдено|Событий не найдено|За выбранный период.*нет/i.test(txt(document.body))) return {...result,complete:true};
      const count = result.rowCount;
      const more = buttons().find(b=>/^(Показать|Загрузить) ещ[её]/i.test(txt(b)));
      if (more) more.click();
      else {
        const last = [...document.querySelectorAll(operationSelector)].at(-1);
        last?.scrollIntoView({block:'end'});
        window.scrollTo(0,document.body.scrollHeight);
      }
      await pause(650);
      result = readEvents();
      unchanged = result.rowCount===count ? unchanged+1 : 0;
      if (unchanged>=8) break;
    }
    const complete = !!result.oldest && result.oldest<month && result.invalid===0;
    return {...result,entries:result.entries.filter(e=>e.date>=month),complete};
  }
  throw new Error('Неизвестный тип страницы.');
};
