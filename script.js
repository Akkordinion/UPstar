'use strict';

/* ===== Утилиты ===== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Порядок в списках и поиск дубликатов: русская локаль, регистр не важен («е» и «ё» различаются)
const collator = new Intl.Collator('ru', { sensitivity: 'accent' });
const sameName = (a, b) => collator.compare(a, b) === 0;
const byName = (a, b) => collator.compare(a.name, b.name);

const norm = (s) => s.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');
const ucFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// «Дрон» → «дрон», но аббревиатуры («ИИ-ассистент», «3D-принтер», «VR-платформа») не трогаем
const lcFirst = (s) => (/^[A-ZА-ЯЁ][a-zа-яё]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const unique = (array) => [...new Set(array)];

const SVG_NS = 'http://www.w3.org/2000/svg';
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(id, className = 'ic') {
  const svg = svgEl('svg', { class: className, viewBox: id.startsWith('i-') ? '0 0 64 64' : '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgEl('use', { href: `#${id}` }));
  return svg;
}

const nf = new Intl.NumberFormat('ru-RU');
const fmtInt = (n) => nf.format(Math.round(n)).replace(/[  ]/g, ' ');
const fmtRub = (n) => `${n < 0 ? '−' : ''}${fmtInt(Math.abs(n))} ₽`;
const fmtPct = (n) => `${(Math.round(n * 10) / 10).toString().replace('.', ',')}%`;
// Короткая запись для осей графика: 1,2 млн / 340 тыс
function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')} млн`;
  if (a >= 1e3) return `${Math.round(n / 1e3)} тыс`;
  return String(Math.round(n));
}

/* ===== Режим анимаций: системная настройка, выбор пользователя, переключатель ===== */
const MOTION_KEY = 'upstar.motion';
const motionAllowed = () => document.documentElement.getAttribute('data-motion') !== 'off';

const FLIP_MS = 250;
const TOAST_MS = 8000;
const MAX_TOASTS = 3;
const KEYS = ['what', 'who'];
const TITLES = { what: 'Что/Кто?', who: 'Для кого?' };
const STORAGE_KEY = 'startup-generator.v1';

/* ===== Состояние ===== */
let nextId = 0;
let storageOk = true;

const makeState = (names) => ({
  items: names.map((name) => ({ id: ++nextId, name })).sort(byName),
  selected: null, // id выбранного варианта
  editing: null,  // id варианта, который сейчас правится в форме окна
});
const state = { what: null, who: null, result: null };

const findItem = (key, id) => state[key].items.find((item) => item.id === id) || null;
const selectedItem = (key) => findItem(key, state[key].selected);
const defaultNames = (key) => DATA[key].map((entry) => entry.name);

/* ===== Сохранение (localStorage может быть недоступен) ===== */
function readStored() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    storageOk = false;
    return null;
  }
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw);
    const out = {};
    for (const key of KEYS) {
      if (!Array.isArray(data[key])) return null;
      out[key] = [];
      for (const value of data[key]) {
        const name = typeof value === 'string' ? value.trim() : '';
        if (name && !out[key].some((existing) => sameName(existing, name))) out[key].push(name);
      }
    }
    return out;
  } catch (e) {
    return null; // повреждённые данные — начинаем с исходных
  }
}

function saveLists() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      what: state.what.items.map((item) => item.name),
      who: state.who.items.map((item) => item.name),
    }));
  } catch (e) {
    storageOk = false;
  }
  ui.storageNote.hidden = storageOk;
}

/* ===== Элементы страницы ===== */
const ui = {
  generate: $('#generate'),
  hint: $('#generate-hint'),
  reset: $('#reset'),
  storageNote: $('#storage-note'),
  toasts: $('#toasts'),
  live: $('#live'),
  motionToggle: $('#motion-toggle'),
  motionLabel: $('#motion-label'),
  navResult: $('#nav-result'),
  resultSection: $('#result'),
  resultPair: $('#result-pair'),
  resultTitle: $('#result-title'),
  resultSlogan: $('#result-slogan'),
  resultPitch: $('#result-pitch'),
  resultGrandma: $('#result-grandma'),
  posterIcon: $('#poster-icon'),
  ideaCards: $('#idea-cards'),
  proofList: $('#proof-list'),
  targetsList: $('#targets-list'),
  planBody: $('#plan-body'),
  regen: $('#regen'),
  copy: $('#copy'),
};
for (const key of KEYS) {
  const panel = $(`[data-panel="${key}"]`);
  ui[key] = {
    list: $('.items', panel),
    empty: $('.empty', panel),
    form: $('.add-form', panel),
    label: $('.form-label', panel),
    input: $('input', panel),
    submit: $('.submit', panel),
    cancel: $('.cancel', panel),
    error: $('.error', panel),
    current: null, // кнопка, на которой стоит единственный Tab-стоп списка
  };
}

let announceTimer = 0;
function announce(text) {
  // Сначала очищаем, чтобы одинаковое сообщение прочиталось повторно
  clearTimeout(announceTimer);
  ui.live.textContent = '';
  announceTimer = setTimeout(() => { ui.live.textContent = text; }, 50);
}

/* ===== Отрисовка списка: узлы живут по id, перестановка + FLIP ===== */
const rowTemplate = $('#row-template');
const rows = { what: new Map(), who: new Map() }; // id → <li>

function paintRow(li, item, key) {
  const st = state[key];
  const pick = $('.pick', li);
  if (pick.textContent !== item.name) pick.textContent = item.name; // не трогаем DOM зря: скринридер не перечитает кнопку
  pick.setAttribute('aria-pressed', String(st.selected === item.id));
  for (const [cls, verb] of [['edit', 'Изменить'], ['del', 'Удалить']]) {
    const button = $(`.${cls}`, li);
    const label = `${verb} «${item.name}»`;
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  li.classList.toggle('editing', st.editing === item.id);
}

function renderList(key, animate = true) {
  const st = state[key];
  const { list, empty } = ui[key];
  const map = rows[key];
  // Позиция строки внутри прокручиваемого списка — не зависит от scrollTop
  const origin = () => list.getBoundingClientRect().top - list.scrollTop;

  // FIRST: где строки стоят сейчас (с учётом незавершённой анимации), затем сбрасываем её
  const before = new Map();
  if (animate) {
    const o = origin();
    for (const li of list.children) {
      before.set(li, li.getBoundingClientRect().top - o);
      li.getAnimations().forEach((a) => a.cancel());
    }
  }

  // Меняем DOM: убираем удалённые строки, создаём новые, выстраиваем порядок
  const alive = new Set(st.items.map((item) => item.id));
  for (const [id, li] of map) {
    if (!alive.has(id)) { li.remove(); map.delete(id); }
  }
  const created = [];
  let ref = list.firstElementChild; // первая ещё не расставленная строка
  for (const item of st.items) {
    let li = map.get(item.id);
    if (!li) {
      li = rowTemplate.content.firstElementChild.cloneNode(true);
      li.dataset.id = item.id;
      map.set(item.id, li);
      created.push(li);
    }
    paintRow(li, item, key);
    if (li === ref) ref = ref.nextElementSibling;
    else list.insertBefore(li, ref); // не трогает строки, которые уже на месте
  }
  empty.hidden = st.items.length > 0;
  syncTabStops(key);

  if (!animate || !motionAllowed()) return;

  // LAST → INVERT → PLAY: каждая сдвинувшаяся строка «возвращается» со старого места
  const o = origin();
  for (const li of list.children) {
    const was = before.get(li);
    if (was === undefined) continue;
    const dy = was - (li.getBoundingClientRect().top - o);
    if (Math.abs(dy) > 0.5) {
      li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: 'ease-in-out' });
    }
  }
  for (const li of created) {
    li.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: FLIP_MS, easing: 'ease-out' });
  }
}

// Показать строку внутри списка, не прокручивая саму страницу
function reveal(key, id) {
  const li = rows[key].get(id);
  if (!li) return;
  const list = ui[key].list;
  const top = li.offsetTop;
  const bottom = top + li.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

function focusRow(key, id, selector) {
  const li = rows[key].get(id);
  const button = li && $(selector, li);
  if (button) button.focus({ preventScroll: true });
}

function focusList(key) {
  const { list, current, input } = ui[key];
  (current && list.contains(current) ? current : $('.pick', list) || input).focus({ preventScroll: true });
}

/* ===== Клавиатура в списке: один Tab-стоп, внутри — стрелки ===== */
function syncTabStops(key) {
  const { list } = ui[key];
  let current = ui[key].current;
  if (!current || !list.contains(current)) {
    current = $('.pick[aria-pressed="true"]', list) || $('.pick', list);
  }
  ui[key].current = current;
  for (const button of list.querySelectorAll('button')) button.tabIndex = button === current ? 0 : -1;
}

function bindList(key) {
  const { list } = ui[key];

  list.addEventListener('focusin', (e) => {
    const button = e.target.closest('button');
    if (button) { ui[key].current = button; syncTabStops(key); }
  });

  list.addEventListener('keydown', (e) => {
    const button = e.target.closest('button');
    if (!button || e.altKey || e.ctrlKey || e.metaKey) return;
    const all = [...list.children];
    const row = button.parentElement;
    let r = all.indexOf(row);
    let c = [...row.children].indexOf(button);
    if (e.key === 'ArrowDown') r += 1;
    else if (e.key === 'ArrowUp') r -= 1;
    else if (e.key === 'ArrowRight') c += 1;
    else if (e.key === 'ArrowLeft') c -= 1;
    else if (e.key === 'Home') r = 0;
    else if (e.key === 'End') r = all.length - 1;
    else return;
    e.preventDefault();
    const target = all[Math.max(0, Math.min(r, all.length - 1))];
    target.children[Math.max(0, Math.min(c, target.children.length - 1))].focus();
  });

  list.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const id = Number(button.closest('li').dataset.id);
    if (button.classList.contains('pick')) selectItem(key, id);
    else if (button.classList.contains('edit')) startEdit(key, id);
    else if (button.classList.contains('del')) deleteItem(key, id);
  });
}

/* ===== Выбор и кнопка «Создать стартап» ===== */
function selectItem(key, id) {
  if (state[key].selected === id) return; // как радио: повторный клик ничего не снимает
  state[key].selected = id;
  renderList(key);
  refreshPair();
}

function refreshPair() {
  updateGenerate();
  syncResult();
}

function updateGenerate() {
  const what = selectedItem('what');
  const who = selectedItem('who');
  ui.generate.disabled = !(what && who);
  if (what && who) ui.hint.textContent = `Выбрано: ${what.name} × ${who.name}`;
  else if (!what && !who) ui.hint.textContent = 'Выберите по одному варианту в каждом окне.';
  else ui.hint.textContent = `Осталось выбрать вариант в окне «${TITLES[what ? 'who' : 'what']}».`;
}

// Результат относится к паре, для которой он создан: сменилась пара — убираем, чтобы текст не расходился с выбором
function syncResult() {
  const r = state.result;
  if (!r) return;
  const what = selectedItem('what');
  const who = selectedItem('who');
  if (!what || !who || what.name !== r.whatName || who.name !== r.whoName) {
    state.result = null;
    renderResult();
  }
}

/* ===== Форма окна: добавление и правка ===== */
function setError(key, message) {
  const { error, input } = ui[key];
  error.textContent = message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function updateFormMode(key) {
  const editing = state[key].editing !== null;
  const { label, submit, cancel } = ui[key];
  label.textContent = editing ? 'Изменить вариант' : 'Новый вариант';
  submit.textContent = editing ? 'Сохранить' : 'Добавить';
  cancel.hidden = !editing;
}

// Пустое название и дубликаты (сам правимый вариант не считается) отклоняются
function validate(key, name, exceptId) {
  if (!name) return 'Введите название: оно не может быть пустым.';
  const duplicate = state[key].items.find((item) => item.id !== exceptId && sameName(item.name, name));
  return duplicate ? `Вариант «${duplicate.name}» уже есть в этом списке.` : '';
}

function bindForm(key) {
  const { form, input, cancel } = ui[key];

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const st = state[key];
    const name = input.value.trim();
    const message = validate(key, name, st.editing);
    setError(key, message);
    if (message) { input.focus(); return; }
    if (st.editing !== null) commitEdit(key, name);
    else addItem(key, name);
  });

  input.addEventListener('input', () => setError(key, ''));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state[key].editing !== null) { e.preventDefault(); stopEdit(key); }
  });
  cancel.addEventListener('click', () => stopEdit(key));
}

function addItem(key, name) {
  const item = { id: ++nextId, name };
  state[key].items.push(item);
  state[key].items.sort(byName);
  ui[key].input.value = '';
  saveLists();
  renderList(key);
  reveal(key, item.id);
  ui[key].input.focus({ preventScroll: true });
  announce(`Добавлено: «${name}»`);
}

function startEdit(key, id) {
  const item = findItem(key, id);
  if (!item) return;
  state[key].editing = id;
  setError(key, '');
  ui[key].input.value = item.name;
  updateFormMode(key);
  renderList(key, false);
  ui[key].input.focus();
  ui[key].input.select();
}

function stopEdit(key) {
  const id = state[key].editing;
  if (id === null) return;
  state[key].editing = null;
  ui[key].input.value = '';
  setError(key, '');
  updateFormMode(key);
  renderList(key, false);
  focusRow(key, id, '.edit');
}

function commitEdit(key, name) {
  const st = state[key];
  const id = st.editing;
  const item = findItem(key, id);
  st.editing = null;
  ui[key].input.value = '';
  updateFormMode(key);
  if (item && item.name !== name) {
    item.name = name;
    st.items.sort(byName);
    saveLists();
    renderList(key); // строка переезжает на новое алфавитное место
    refreshPair();   // у выбранного варианта могло смениться имя — результат устарел
    announce(`Сохранено: «${name}»`);
  } else {
    renderList(key, false);
  }
  reveal(key, id);
  focusRow(key, id, '.edit');
}

/* ===== Удаление с возможностью отмены ===== */
function deleteItem(key, id) {
  const st = state[key];
  const index = st.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [item] = st.items.splice(index, 1);
  const wasSelected = st.selected === id;
  if (wasSelected) st.selected = null;
  if (st.editing === id) {
    st.editing = null;
    ui[key].input.value = '';
    setError(key, '');
    updateFormMode(key);
  }
  saveLists();
  renderList(key);
  refreshPair();

  // Фокус не должен пропасть вместе с удалённой строкой
  const neighbour = st.items[Math.min(index, st.items.length - 1)];
  if (neighbour) focusRow(key, neighbour.id, '.pick');
  else ui[key].input.focus({ preventScroll: true });

  showToast(`«${item.name}» удалён из списка «${TITLES[key]}»`, {
    onUndo: () => restoreItem(key, item, wasSelected),
    returnFocus: () => focusList(key),
  });
}

function restoreItem(key, item, wasSelected) {
  const st = state[key];
  if (st.items.some((existing) => sameName(existing.name, item.name))) {
    showToast(`Не удалось вернуть «${item.name}»: такой вариант уже есть в списке.`, { returnFocus: () => focusList(key) });
    return;
  }
  st.items.push(item);
  st.items.sort(byName);
  if (wasSelected && st.selected === null) st.selected = item.id;
  saveLists();
  renderList(key);
  refreshPair();
  reveal(key, item.id);
  focusRow(key, item.id, '.pick');
}

function showToast(text, { onUndo = null, returnFocus = null } = {}) {
  const toast = el('div', 'toast');
  toast.append(el('span', 'toast-text', text));

  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    const hadFocus = toast.contains(document.activeElement);
    toast.remove();
    if (hadFocus && returnFocus) returnFocus();
  };
  const addButton = (label, primary, handler) => {
    const button = el('button', primary ? 'primary' : '', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    toast.append(button);
  };
  if (onUndo) {
    addButton('Отменить', true, () => { close(); onUndo(); });
    addButton('Подтвердить', false, close);
  } else {
    addButton('Закрыть', false, close);
  }

  // Автоподтверждение; пока на уведомлении мышь или фокус — таймер стоит
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, TOAST_MS); };
  const hold = () => clearTimeout(timer);
  toast.addEventListener('mouseenter', hold);
  toast.addEventListener('focusin', hold);
  toast.addEventListener('mouseleave', arm);
  toast.addEventListener('focusout', arm);
  ui.toasts.append(toast);
  // Много удалений подряд не должны закрывать экран: самое старое уведомление (его удаление) считается подтверждённым
  while (ui.toasts.children.length > MAX_TOASTS) ui.toasts.firstElementChild.remove();
  arm();
}

/* ===== Генератор стартапа ===== */
const known = {
  what: new Map(DATA.what.map((entry) => [norm(entry.name), entry])),
  who: new Map(DATA.who.map((entry) => [norm(entry.name), entry])),
};

const pick = (array) => array[Math.floor(Math.random() * array.length)];
const pickN = (array, n) => {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
};

// {key} подставляет значение как есть, {Key} — с заглавной буквы. Неизвестный ключ — ошибка шаблона.
function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const low = key.charAt(0).toLowerCase() + key.slice(1);
    if (!(low in vars)) throw new Error(`В шаблоне нет значения для {${key}}`);
    return key === low ? vars[low] : ucFirst(vars[low]);
  });
}

// Корень для названия из чужого слова: первое слово, обрезанное после первой гласной за третьей буквой
function stem(name) {
  const word = (name.match(/[\p{L}\p{N}]+/u) || [name])[0];
  if (word.length <= 3) return word === word.toUpperCase() ? word : ucFirst(word.toLowerCase());
  const i = word.slice(3).search(/[аеёиоуыэюяaeiouy]/i);
  const cut = i < 0 ? word : word.slice(0, 4 + i);
  return ucFirst(cut.slice(0, 7).toLowerCase());
}

// Смешные названия: «Дядя Дрон», «КолосДрон», «ГрядкаХаб» — приставка, корни обеих сторон или суффикс
function makeName(what, who, whatName, whoName) {
  const w = pick(what.roots || [stem(whatName)]);
  const h = pick(who.roots || [stem(whoName)]);
  const roll = Math.random();
  if (roll < 0.35) return `${pick(DATA.prefixes)} ${pick([w, h])}`;
  if (roll < 0.7) return w + h;
  return pick([w, h]) + pick(DATA.suffixes);
}

/* --- Симулятор дохода: чистые функции --- */
// Модель: охват в месяц × доля покупающих = новые клиенты. Подписка копит клиентов с оттоком, разовая покупка — нет.
// До первых продаж (delay месяцев) идут только расходы.
function simulate(p, months = 24) {
  const out = [];
  let customers = 0;
  let cum = -p.invest;
  for (let m = 1; m <= months; m++) {
    const fresh = m > p.delay ? p.reach * Math.pow(1 + p.growth, m - p.delay - 1) * p.conv / 100 : 0;
    customers = p.mode === 'sub' ? customers * (1 - p.churn / 100) + fresh : fresh;
    const revenue = customers * p.price;
    const costs = p.fixed + revenue * p.varCost;
    const profit = revenue - costs;
    cum += profit;
    out.push({ m, fresh, customers, revenue, costs, profit, cum });
  }
  return out;
}
const roundTo = (x, step) => Math.round(x / step) * step;
const priceStep = (x) => (x >= 10000 ? 100 : x >= 1000 ? 50 : 10);

// Стартовые настройки: цена и доли — из данных, а охват подбирается так, чтобы через год прибыль была умеренно положительной
function makeSim(kind, what, who) {
  const s = kind.sim;
  const b2b = who.b2b;
  const rawPrice = s.ticket ? (what.ticket || s.ticket) * s.price[who.budget] * (b2b ? 1.2 : 1) : s.price[who.budget] * (b2b ? 1.5 : 1);
  const price = roundTo(rawPrice, priceStep(rawPrice));
  const conv = Math.round(s.conv * (b2b ? 1.4 : 1) * 10) / 10;
  const churn = s.mode === 'sub' ? Math.round(s.churn * (b2b ? 0.6 : 1) * 2) / 2 : 0;
  const base = { mode: s.mode, delay: s.delay, price, reach: 1, conv, churn, fixed: s.fixed, varCost: s.varCost, growth: s.growth, invest: s.invest };
  const revenuePerReach = simulate(base, 12)[11].revenue;
  const wanted = (s.fixed * 1.8) / (1 - s.varCost);
  let reach = wanted / revenuePerReach;
  const reachStep = reach >= 10000 ? 100 : reach >= 1000 ? 50 : 10;
  reach = Math.max(50, roundTo(reach, reach >= 10000 ? 500 : reachStep));
  const pStep = priceStep(price);
  return {
    mode: s.mode,
    labels: { price: s.priceLabel, priceHint: s.priceHint, clients: s.clientsLabel },
    defaults: { price, reach, conv, churn, fixed: s.fixed },
    ranges: {
      price: { min: Math.max(pStep, roundTo(price * 0.3, pStep)), max: roundTo(price * 3, pStep), step: pStep },
      reach: { min: Math.max(reachStep, roundTo(reach * 0.1, reachStep)), max: roundTo(reach * 4, reachStep), step: reachStep },
      conv: { min: 0.2, max: Math.max(10, Math.ceil(conv * 3)), step: 0.1 },
      churn: { min: 1, max: 30, step: 0.5 },
      fixed: { min: roundTo(s.fixed * 0.2, 5000), max: roundTo(s.fixed * 3, 5000), step: 5000 },
    },
    delay: s.delay, varCost: s.varCost, growth: s.growth, invest: s.invest,
  };
}
const simParams = (sim, values) => ({ mode: sim.mode, delay: sim.delay, varCost: sim.varCost, growth: sim.growth, invest: sim.invest, ...values });
const firstMonth = (rows, test) => { const i = rows.findIndex(test); return i < 0 ? null : rows[i].m; };

function buildStartup(whatName, whoName) {
  const what = known.what.get(norm(whatName)) || DATA.genericWhat;
  const who = known.who.get(norm(whoName)) || DATA.genericWho;
  const kind = DATA.kinds[what.kind];
  const T = DATA.templates;

  // Формы аудитории: у чужой аудитории не склоняем, а оборачиваем в «аудитории «X»»
  const alias = `аудитории «${whoName}»`;
  const vars = {
    what: whatName, whatLc: lcFirst(whatName), who: whoName,
    whoGen: who.gen || alias, whoDat: who.dat || alias,
    whoAcc: who.acc || `аудиторию «${whoName}»`,
    whoWith: who.with || `с аудиторией «${whoName}»`,
  };
  const f = (s) => fill(s, vars);

  // Выбор из обеих сторон: боли и каналы аудитории, возможности продукта и правила вида продукта
  const pains = pickN(who.pains, 3).map(f);
  const channels = [
    ...pickN(who.channels, 2),
    ...pickN([...kind.channels, ...(what.channels || [])], 2),
  ].map(f);
  // Первая функция в данных — ключевая: она всегда «главная функция» в плане; остальные две выбираются случайно
  const features = [what.features[0], ...pickN(what.features.slice(1), 2)].map(f);
  const adapts = pickN(who.adapt, 2).map(f);

  Object.assign(vars, {
    name: makeName(what, who, whatName, whoName),
    pain: pains[0], workaround: f(who.workaround), goal: f(who.goal), wish: f(who.wish),
    segment: f(who.segment), pilot: f(who.pilot),
    cap: f(what.cap), edge: f(what.edge), vibe: f(what.vibe), incumbents: f(what.incumbents),
    analogy: f(what.analogy), twist: f(who.twist),
    whatPunch: f(pick(what.punch)), whoPunch: f(pick(who.punch)),
    whyPay: f(who.whyPay),
    gap: pick(DATA.gaps), kindGap: f(kind.gap),
    price: kind.price[who.budget].replace(/(\d) (?=\d)/g, '$1 ').replace(/ ₽/g, ' ₽'), // без переноса цифр и «₽»
    adapt: adapts[0], feature1: features[0],
    channel1: channels[0], channel2: channels[2],
  });

  const note = DATA.audienceNote[who.b2b ? 'b2b' : who.budget];
  const cards = [
    { id: 'problem', icon: 'u-bolt', title: 'Проблема', text: f(pick(T.problem)) },
    { id: 'solution', icon: 'u-bulb', title: 'Решение', text: f(pick(T.solution)) },
    { id: 'audience', icon: 'u-users', title: 'Для кого и что болит', text: f(pick(T.audience)), items: pains.map(ucFirst) },
    { id: 'value', icon: 'u-target', title: 'Что мы обещаем', text: f(pick(T.value)) },
    { id: 'money', icon: 'u-coin', title: 'Как зарабатываем', text: `${f(pick(kind.model))} ${f(note)}` },
    { id: 'channels', icon: 'u-mega', title: 'Где искать клиентов', items: channels.map(ucFirst) },
    { id: 'competitors', icon: 'u-flag', title: 'С кем соревнуемся', items: T.competitors.map(f) },
    { id: 'mvp', icon: 'u-cube', title: 'Что в первой версии', items: [...features, `для ${vars.whoGen}: ${adapts[1]}`, f(pick(kind.mvp))].map(ucFirst) },
    { id: 'risks', icon: 'u-warn', title: 'Три главных риска', items: [pick(what.risks), pick(who.risks), pick(kind.risks)].map((s) => ucFirst(f(s))) },
  ];

  // Точечный план: что изучить, навыки, образование, документы, этапы — из данных продукта, аудитории и вида продукта
  const study = [...what.study, ...who.study, ...kind.study].map((s) => ({ t: f(s.t), d: f(s.d), h: s.h }));
  const hours = study.reduce((sum, s) => sum + s.h, 0);
  const plan = {
    team: kind.team.map(f),
    budgetMvp: kind.budgetMvp, budgetMonth: kind.budgetMonth, timeToCash: kind.timeToCash,
    study, hours, weeks: Math.ceil(hours / 8),
    skills: unique([...what.skills, ...kind.skills, `Умение говорить ${vars.whoWith} на одном языке`].map(f)),
    education: [f(what.edu), f(who.edu)],
    docs: unique([...kind.legal, ...what.legal, who.reg].map(f)),
    tools: unique([...what.tools, ...kind.tools].map(f)).slice(0, 7).map(ucFirst),
    stages: kind.stages.map((st, i) => ({ n: i + 1, title: f(st.title), when: st.when, goal: f(st.goal), steps: st.steps.map(f), done: lcFirst(f(st.done)) })),
    first10: [f(who.discover), ...kind.first10.map(f)],
    pivot: kind.pivot.map(f),
  };

  const sim = makeSim(kind, what, who);
  return {
    name: vars.name,
    slogan: f(pick(T.slogan)),
    pitch: f(pick(T.pitch)),
    grandma: f(pick(T.grandma)),
    icon: what.icon,
    kindLabel: kind.label,
    cards,
    quote: { text: f(who.quote), by: f(who.quoteBy) },
    proof: T.proof.map(f),
    metrics: [...pickN(kind.metrics, 2), what.metric, who.metric].map((s) => ucFirst(f(s))),
    plan,
    sim,
  };
}

// Тот же объект результата и рисуется на странице, и превращается в текст для буфера обмена
function toText(result) {
  const d = result.data;
  const L = [`UPstar · ${d.name}`, d.slogan, `Пара: ${result.whatName} × ${result.whoName}`, '', d.pitch, d.grandma, ''];
  for (const c of d.cards) {
    L.push(c.title.toUpperCase());
    if (c.text) L.push(c.text);
    (c.items || []).forEach((item) => L.push(`• ${item}`));
    L.push('');
  }
  L.push(`«${d.quote.text}» — ${d.quote.by}`, '', 'ПОЧЕМУ ЭТО НЕ ШУТКА');
  d.proof.forEach((p) => L.push(`• ${p}`));
  L.push('', 'МЕТРИКИ УСПЕХА');
  d.metrics.forEach((m) => L.push(`• ${m}`));

  const rows = simulate(simParams(d.sim, d.sim.defaults));
  const r12 = rows[11];
  const be = firstMonth(rows, (r) => r.profit > 0);
  const pb = firstMonth(rows, (r) => r.cum >= 0);
  L.push('', 'ПРИКИДКА ДОХОДА (настройки по умолчанию)',
    `Через 12 месяцев: ${d.sim.labels.clients.toLowerCase()} — ${fmtInt(r12.customers)}, выручка — ${fmtRub(r12.revenue)} в месяц, прибыль — ${fmtRub(r12.profit)} в месяц.`,
    `Выход в плюс: ${be ? `${be}-й месяц` : 'не за 24 месяца'}. Вложения (${fmtRub(d.sim.invest)}) окупятся: ${pb ? `к ${pb}-му месяцу` : 'позже 24 месяцев'}.`);

  const p = d.plan;
  L.push('', 'ПЛАН ЗАПУСКА', '', 'Команда:');
  p.team.forEach((t) => L.push(`• ${t}`));
  L.push(`Деньги на старт: ${p.budgetMvp}; ${p.budgetMonth}.`, `Срок: ${p.timeToCash}.`, '', `Что изучить (≈ ${p.hours} ч):`);
  p.study.forEach((s) => L.push(`• ${s.t} — ${s.d} (≈ ${s.h} ч)`));
  L.push('', 'Навыки:');
  p.skills.forEach((s) => L.push(`• ${s}`));
  L.push('', 'Образование:');
  p.education.forEach((s) => L.push(`• ${s}`));
  L.push('', 'Документы и правила:');
  p.docs.forEach((s) => L.push(`• ${s}`));
  L.push('', `Инструменты: ${p.tools.join('; ')}`);
  for (const st of p.stages) {
    L.push('', `ЭТАП ${st.n} (${st.when}). ${st.title}`, `Цель: ${st.goal}.`);
    st.steps.forEach((step, i) => L.push(`${i + 1}. ${step}`));
    L.push(`Готово, если: ${st.done}`);
  }
  L.push('', 'ПЕРВЫЕ 10 КЛИЕНТОВ');
  p.first10.forEach((s, i) => L.push(`${i + 1}. ${s}`));
  L.push('', 'КОГДА МЕНЯТЬ КУРС');
  p.pivot.forEach((s) => L.push(`• ${s}`));
  return L.join('\n').trim();
}

function generate() {
  const what = selectedItem('what');
  const who = selectedItem('who');
  if (!what || !who) return;
  const previous = state.result ? state.result.text : null;
  let result;
  // «Создать заново» должно дать другой текст: повторяем, пока он не отличится от прежнего
  for (let attempt = 0; attempt < 12; attempt++) {
    result = { whatName: what.name, whoName: who.name, data: buildStartup(what.name, who.name) };
    result.text = toText(result);
    if (result.text !== previous) break;
  }
  const firstShow = state.result === null;
  state.result = result;
  renderResult();
  announce(`Создан стартап «${result.data.name}»`);
  if (firstShow) {
    ui.resultTitle.focus({ preventScroll: true });
    ui.resultSection.scrollIntoView({ behavior: motionAllowed() ? 'smooth' : 'auto', block: 'start' });
  }
}

/* ===== Результат на странице ===== */
function bulletList(items, className) {
  const ul = el('ul', className);
  for (const text of items) ul.append(el('li', '', text));
  return ul;
}

function renderCard(c) {
  const card = el('article', 'card glass');
  card.dataset.block = c.id;
  const head = el('div', 'card-head');
  const ic = icon(c.icon, 'card-ic');
  head.append(ic, el('h4', '', c.title));
  card.append(head);
  if (c.text) card.append(el('p', '', c.text));
  if (c.items) card.append(bulletList(c.items));
  return card;
}

function renderResult() {
  const r = state.result;
  ui.resultSection.hidden = !r;
  const enabled = Boolean(r);
  ui.navResult.setAttribute('aria-disabled', String(!enabled));
  ui.navResult.tabIndex = enabled ? 0 : -1;
  if (!r) { stopDashboard(); return; }
  const d = r.data;
  ui.resultPair.textContent = `${d.kindLabel} · ${r.whatName} × ${r.whoName}`;
  ui.resultTitle.textContent = d.name;
  ui.resultSlogan.textContent = d.slogan;
  ui.resultPitch.textContent = d.pitch;
  ui.resultGrandma.textContent = d.grandma;

  const art = svgEl('svg', { x: 0, y: 0, width: 176, height: 176, viewBox: '0 0 64 64' });
  art.append(svgEl('use', { href: `#i-${d.icon}` }));
  ui.posterIcon.replaceChildren(art);

  const cards = d.cards.map(renderCard);
  const quote = el('article', 'card quote-card glass');
  quote.dataset.block = 'quote';
  const quoteBody = el('div');
  quoteBody.append(el('p', 'quote-text', `«${d.quote.text}»`), el('p', 'quote-by', `— ${d.quote.by}. Отзыв из будущего.`));
  quote.append(icon('u-quote', 'quote-ic'), quoteBody);
  cards.splice(3, 0, quote); // после блока про аудиторию и боли
  ui.ideaCards.replaceChildren(...cards);

  ui.proofList.replaceChildren(...d.proof.map((text) => {
    const li = el('li', 'proof-item glass');
    li.append(icon('u-check', 'ic'), el('span', '', text));
    return li;
  }));
  ui.targetsList.replaceChildren(...d.metrics.map((text) => el('li', '', text)));

  renderPlan(d);
  initDashboard(d);
}

/* ===== План запуска ===== */
function planCard(iconId, title, ...content) {
  const card = el('section', 'plan-card glass');
  const head = el('h4');
  head.append(icon(iconId, 'ic'), document.createTextNode(title));
  card.append(head, ...content);
  return card;
}

function renderPlan(d) {
  const p = d.plan;
  const root = ui.planBody;
  root.replaceChildren();

  // Команда, деньги, сроки
  const top = el('div', 'plan-top');
  top.append(
    planCard('u-users', 'Кто нужен в команде', bulletList(p.team)),
    planCard('u-wallet', 'Деньги на старт', el('p', '', `До первой версии: ${p.budgetMvp}.`), el('p', '', `${ucFirst(p.budgetMonth)}.`)),
    planCard('u-clock', 'Сроки', el('p', '', `${ucFirst(p.timeToCash)}.`), el('p', '', `На учёбу уйдёт примерно ${p.hours} ч — это около ${p.weeks} недель по 8 часов в неделю.`)),
  );
  root.append(top);

  // Что изучить
  root.append(el('h4', 'plan-sub', 'Что нужно изучить'));
  const study = el('ul', 'study-list');
  for (const s of p.study) {
    const li = el('li', 'study-item');
    const hours = el('span', 'study-h', String(s.h));
    hours.append(el('small', '', 'часов'));
    li.append(el('span', 'study-t', s.t), el('span', 'study-d', s.d), hours);
    study.append(li);
  }
  root.append(study, el('p', 'study-total', `Всего ≈ ${p.hours} часов. Не всё сразу: начинайте с интервью, а теорию добирайте по ходу.`));

  // Навыки
  root.append(el('h4', 'plan-sub', 'Навыки'));
  const chips = el('ul', 'chips');
  for (const s of p.skills) {
    const [name, hire] = s.split(' — можно нанять');
    const chip = el('li', 'chip', name);
    if (hire !== undefined) chip.append(el('small', '', 'можно нанять'));
    chips.append(chip);
  }
  root.append(chips);

  // Образование и документы
  const two = el('div', 'two-col');
  two.append(
    planCard('u-graduate', 'Образование: нужен ли диплом', ...p.education.map((text) => el('p', '', text))),
    planCard('u-book', 'Документы и правила', bulletList(p.docs)),
  );
  root.append(two);

  // Пошаговый план с галочками
  root.append(el('h4', 'plan-sub', 'Пошагово: три этапа'));
  const total = p.stages.reduce((sum, st) => sum + st.steps.length, 0);
  const progress = el('div', 'progress-wrap');
  const line = el('div', 'progress-line');
  const doneLabel = el('span', '', `Сделано 0 из ${total}`);
  const pct = el('span', '', '0%');
  line.append(doneLabel, pct);
  const bar = el('div', 'progress');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Выполнено шагов плана');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', '0');
  const fillBar = el('i');
  bar.append(fillBar);
  const msg = el('p', 'progress-msg');
  progress.append(line, bar, msg);
  root.append(progress);

  const boxes = [];
  const updateProgress = () => {
    const done = boxes.filter((b) => b.checked).length;
    doneLabel.textContent = `Сделано ${done} из ${total}`;
    pct.textContent = `${Math.round((done / total) * 100)}%`;
    fillBar.style.width = `${(done / total) * 100}%`;
    bar.setAttribute('aria-valuenow', String(done));
    msg.textContent = done === total
      ? 'Все шаги отмечены. Поздравляем: стартап построен. Теперь самое сложное — клиенты.'
      : done > 0 ? 'Хороший ход. Следующий шаг — ниже по списку.' : '';
    for (const count of $$('.stage-count', root)) {
      const checks = $$('input', count.closest('details'));
      count.textContent = `${checks.filter((b) => b.checked).length}/${checks.length}`;
    }
  };
  for (const st of p.stages) {
    const details = el('details', 'stage');
    details.dataset.stage = st.n;
    if (st.n === 1) details.open = true;
    const summary = el('summary');
    const titles = el('span', 'stage-title');
    titles.append(el('b', '', st.title), el('span', '', st.when));
    summary.append(el('span', 'stage-num', String(st.n)), titles, el('span', 'stage-count', `0/${st.steps.length}`), icon('u-check', 'stage-chev'));
    const body = el('div', 'stage-body');
    body.append(el('p', 'stage-goal', `Цель: ${st.goal}.`));
    const list = el('ul', 'checklist');
    st.steps.forEach((step, i) => {
      const id = `step-${st.n}-${i}`;
      const li = el('li', 'check');
      const box = el('input');
      box.type = 'checkbox';
      box.id = id;
      box.addEventListener('change', updateProgress);
      boxes.push(box);
      const label = el('label', '', step);
      label.htmlFor = id;
      li.append(box, label);
      list.append(li);
    });
    const done = el('p', 'done');
    done.append(el('b', '', 'Готово, если: '), document.createTextNode(st.done));
    body.append(list, done);
    details.append(summary, body);
    root.append(details);
  }

  // Инструменты, первые клиенты, когда менять курс
  root.append(el('h4', 'plan-sub', 'Инструменты'));
  const tools = el('ul', 'chips');
  for (const t of p.tools) tools.append(el('li', 'chip', t));
  root.append(tools);

  const last = el('div', 'two-col');
  const first = el('ol');
  first.className = 'numbered';
  for (const text of p.first10) first.append(el('li', '', text));
  last.append(planCard('u-target', 'Как получить первых 10 клиентов', first), planCard('u-flag', 'Когда менять курс', bulletList(p.pivot)));
  root.append(last);
}

/* ===== Дашборд: ползунки, анимированные числа, график и поток денег ===== */
const dash = {
  d: null, sim: null, values: null, month: 12, view: null, raf: 0, insightTimer: 0,
  chart: $('#chart'), flow: $('#flow'),
  sliders: Object.fromEntries(['price', 'reach', 'conv', 'churn', 'fixed', 'month'].map((k) => [k, $(`#sim-${k}`)])),
  outs: Object.fromEntries(['price', 'reach', 'conv', 'churn', 'fixed', 'month'].map((k) => [k, $(`#out-${k}`)])),
};
const CH = { W: 760, H: 330, L: 70, R: 20, T: 26, B: 46 };
const FMT = {
  price: (v) => `${fmtInt(v)} ₽${dash.sim && dash.sim.mode === 'sub' ? '/мес' : ''}`,
  reach: (v) => `${fmtInt(v)} чел.`,
  conv: fmtPct,
  churn: fmtPct,
  fixed: (v) => fmtRub(v),
  month: (v) => `${v} мес.`,
};

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// Кадр — всё, что анимируется: ряды для графика и числа для плиток и потока
function frameOf(rows, month) {
  const row = rows[month - 1];
  return {
    rev: rows.map((r) => r.revenue), cost: rows.map((r) => r.costs),
    customers: row.customers, revenue: row.revenue, profit: row.profit,
    year: rows.slice(0, 12).reduce((sum, r) => sum + r.revenue, 0),
    reach: 0, fresh: row.fresh, monthPos: month,
  };
}
const zeroFrame = (frame) => ({ ...frame, rev: frame.rev.map(() => 0), cost: frame.cost.map(() => 0), customers: 0, revenue: 0, profit: 0, year: 0, reach: 0, fresh: 0 });
const lerp = (a, b, t) => a + (b - a) * t;
function lerpFrame(a, b, t) {
  const out = {};
  for (const key of Object.keys(b)) {
    out[key] = Array.isArray(b[key]) ? b[key].map((v, i) => lerp(a[key][i], v, t)) : lerp(a[key], b[key], t);
  }
  return out;
}

function stopDashboard() {
  cancelAnimationFrame(dash.raf);
  clearTimeout(dash.insightTimer);
  dash.d = null;
  dash.view = null;
}

function initDashboard(d) {
  stopDashboard();
  dash.d = d;
  dash.sim = d.sim;
  dash.month = 12;
  dash.values = { ...d.sim.defaults };

  $('#lbl-price').textContent = d.sim.labels.price;
  $('#hint-price').textContent = d.sim.labels.priceHint;
  $('#kpi-customers-label').textContent = d.sim.labels.clients;
  $('#slider-churn').hidden = d.sim.mode !== 'sub';
  for (const key of ['price', 'reach', 'conv', 'churn', 'fixed']) {
    const slider = dash.sliders[key];
    const range = d.sim.ranges[key];
    slider.min = range.min; slider.max = range.max; slider.step = range.step;
    slider.value = d.sim.defaults[key];
  }
  dash.sliders.month.value = dash.month;
  $('#sim-assume').textContent =
    `Допущения: первые ${d.sim.delay} мес. идут только расходы, продажи начинаются с ${d.sim.delay + 1}-го; охват растёт на ${Math.round(d.sim.growth * 100)}% в месяц; ` +
    `переменные расходы — ${Math.round(d.sim.varCost * 100)}% выручки; на старт вложено ${fmtRub(d.sim.invest)}${d.sim.mode === 'sub' ? '; отток считается от клиентов прошлого месяца' : ''}.`;

  buildChart();
  buildFlow(d.name);
  applySliders(true);
}

function readSliders() {
  const v = {};
  for (const key of ['price', 'reach', 'conv', 'churn', 'fixed']) v[key] = Number(dash.sliders[key].value);
  if (dash.sim.mode !== 'sub') v.churn = 0;
  dash.values = v;
  dash.month = Number(dash.sliders.month.value);
}

function paintSliders() {
  for (const key of ['price', 'reach', 'conv', 'churn', 'fixed', 'month']) {
    const slider = dash.sliders[key];
    const value = Number(slider.value);
    const pct = ((value - Number(slider.min)) / (Number(slider.max) - Number(slider.min))) * 100;
    slider.style.setProperty('--p', `${pct}%`);
    const text = FMT[key](value);
    dash.outs[key].textContent = text;
    slider.setAttribute('aria-valuetext', text);
  }
}

// first — самый первый показ: числа «разгоняются» с нуля
function applySliders(first = false) {
  if (!dash.d) return;
  readSliders();
  paintSliders();
  const rows = simulate(simParams(dash.sim, dash.values));
  const target = frameOf(rows, dash.month);
  // тот же охват, на котором посчитаны продажи этого месяца (до запуска — ноль)
  target.reach = dash.month > dash.sim.delay ? dash.values.reach * Math.pow(1 + dash.sim.growth, dash.month - dash.sim.delay - 1) : 0;
  dash.rows = rows;
  dash.target = target;
  updateStatic(rows);
  setDots(target);
  if (first) { dash.view = zeroFrame(target); animateTo(target); } else animateTo(target);
  clearTimeout(dash.insightTimer);
  dash.insightTimer = setTimeout(() => updateInsight(rows), first ? 0 : 450);
}

function animateTo(target) {
  cancelAnimationFrame(dash.raf);
  if (!motionAllowed() || !dash.view) { dash.view = target; renderFrame(target); return; }
  const from = dash.view;
  const t0 = performance.now();
  const duration = 520;
  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    dash.view = lerpFrame(from, target, 1 - Math.pow(1 - t, 3));
    renderFrame(dash.view);
    if (t < 1) dash.raf = requestAnimationFrame(step);
  };
  dash.raf = requestAnimationFrame(step);
}

function setKpi(name, valueText, noteText, tone) {
  const box = $(`.kpi[data-kpi="${name}"]`);
  const value = $('.kpi-value', box);
  if (valueText !== null) value.textContent = valueText;
  if (tone) { value.classList.toggle('pos', tone === 'pos'); value.classList.toggle('neg', tone === 'neg'); }
  if (noteText !== null) $('.kpi-note', box).textContent = noteText;
}

// Статичные (не анимируемые) части: итоговые значения для скринридера, срок окупаемости, подписи
function updateStatic(rows) {
  const be = firstMonth(rows, (r) => r.profit > 0);
  const pb = firstMonth(rows, (r) => r.cum >= 0);
  const t = dash.target;
  const sr = {
    customers: fmtInt(t.customers), revenue: fmtRub(t.revenue), profit: fmtRub(t.profit), year: fmtRub(t.year),
    payback: pb ? `${pb}-й месяц` : 'позже 24 месяцев',
  };
  for (const [name, text] of Object.entries(sr)) $('.sr-only', $(`.kpi[data-kpi="${name}"]`)).textContent = text;
  const month = `через ${dash.month} мес.`;
  setKpi('customers', null, dash.sim.mode === 'sub' ? `активных ${month}` : month);
  setKpi('revenue', null, `в месяц ${month}`);
  setKpi('profit', null, be ? `в плюс — с ${be}-го месяца` : 'пока в минусе');
  setKpi('year', null, 'сумма за первые 12 месяцев');
  setKpi('payback', null, `вложено ${fmtRub(dash.sim.invest)}`);
  const payback = $('.kpi[data-kpi="payback"] .kpi-value');
  payback.textContent = pb ? `${pb}-й мес.` : '> 24 мес.';
  const rev = rows[23].revenue;
  dash.chart.setAttribute('aria-label',
    `График за 24 месяца. Выручка растёт с ${fmtRub(rows[0].revenue)} до ${fmtRub(rev)} в месяц, расходы — от ${fmtRub(rows[0].costs)} до ${fmtRub(rows[23].costs)}. ` +
    (be ? `Выход в плюс — ${be}-й месяц.` : 'В плюс за 24 месяца не выходим.'));
  dash.flow.setAttribute('aria-label',
    `Схема: ${fmtInt(t.reach)} человек в месяц узнают о продукте, ${fmtInt(t.fresh)} из них ${dash.sim.mode === 'sub' ? 'становятся клиентами' : 'покупают'}, выручка — ${fmtRub(t.revenue)} в месяц.`);
}

function updateInsight(rows) {
  const be = firstMonth(rows, (r) => r.profit > 0);
  const pb = firstMonth(rows, (r) => r.cum >= 0);
  const r12 = rows[11];
  let text;
  if (!be) text = 'Пока касса плачет: расходы больше выручки все 24 месяца. Поднимите цену или охват — или урежьте расходы.';
  else if (be > 12) text = `В плюс — только на ${be}-м месяце: это марафон, а не спринт. Готовьте запас денег на ${be} месяцев.`;
  else text = `В плюс — на ${be}-м месяце.${be <= 3 ? ' Бабушка уже заказала торт.' : ''}`;
  if (be) text += pb ? ` Вложения вернутся к ${pb}-му месяцу.` : ' Вложения за два года пока не вернутся.';
  if (be && r12.profit > r12.costs * 4) text += ' Слишком красиво? Проверьте, не завышены ли охват и доля покупающих.';
  $('#sim-insight').textContent = text;
}

/* --- График --- */
const chartX = (m) => CH.L + ((m - 1) / 23) * (CH.W - CH.L - CH.R);

// График рисуется в реальных пикселях: размер подписей не зависит от ширины экрана
function fitChart() {
  const width = Math.round(dash.chart.getBoundingClientRect().width) || 760;
  CH.W = Math.max(300, width);
  CH.H = Math.round(Math.max(230, Math.min(360, CH.W * 0.44)));
  CH.L = CH.W < 520 ? 54 : 70;
  CH.R = 16;
  dash.chart.setAttribute('viewBox', `0 0 ${CH.W} ${CH.H}`);
}

function buildChart() {
  fitChart();
  const svg = dash.chart;
  svg.replaceChildren();
  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id: 'area-grad', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgEl('stop', { offset: 0, 'stop-color': '#19ff3a', 'stop-opacity': 0.34 }), svgEl('stop', { offset: 1, 'stop-color': '#19ff3a', 'stop-opacity': 0 }));
  defs.append(grad);
  dash.g = {
    grid: svgEl('g'), area: svgEl('path', { fill: 'url(#area-grad)' }), cost: svgEl('path', { class: 'cost-line' }),
    rev: svgEl('path', { class: 'rev-line' }), be: svgEl('g'), marker: svgEl('g'), axis: svgEl('g'),
  };
  dash.g.markerLine = svgEl('line', { class: 'marker-line' });
  dash.g.markerDot = svgEl('circle', { class: 'marker-dot', r: 7 });
  dash.g.markerTag = svgEl('text', { class: 'marker-tag' });
  dash.g.marker.append(dash.g.markerLine, dash.g.markerDot, dash.g.markerTag);
  for (const m of [1, 6, 12, 18, 24]) dash.g.axis.append(svgEl('text', { class: 'axis-text', x: chartX(m), y: CH.H - 22, 'text-anchor': 'middle' }, String(m)));
  dash.g.axis.append(svgEl('text', { class: 'axis-title', x: CH.L + (CH.W - CH.L - CH.R) / 2, y: CH.H - 4 }, 'месяцы после старта'));
  svg.append(defs, dash.g.grid, dash.g.area, dash.g.cost, dash.g.rev, dash.g.be, dash.g.marker, dash.g.axis);
}

function renderChart(frame) {
  const { W, H, L, R, T, B } = CH;
  const ph = H - T - B;
  const max = niceMax(Math.max(...frame.rev, ...frame.cost, 1));
  const Y = (v) => T + ph - (v / max) * ph;
  const g = dash.g;
  g.grid.replaceChildren();
  for (let i = 0; i <= 4; i++) {
    const y = Y((max * i) / 4);
    g.grid.append(svgEl('line', { class: 'grid-line', x1: L, x2: W - R, y1: y, y2: y }),
      svgEl('text', { class: 'axis-text', x: L - 10, y: y + 4, 'text-anchor': 'end' }, compact((max * i) / 4)));
  }
  const path = (series) => series.map((v, i) => `${i ? 'L' : 'M'}${chartX(i + 1).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  g.rev.setAttribute('d', path(frame.rev));
  g.cost.setAttribute('d', path(frame.cost));
  g.area.setAttribute('d', `${path(frame.rev)} L${chartX(24).toFixed(1)} ${Y(0)} L${chartX(1).toFixed(1)} ${Y(0)} Z`);

  const be = frame.rev.findIndex((v, i) => v > 0 && v >= frame.cost[i]);
  g.be.replaceChildren();
  if (be >= 0) {
    const x = chartX(be + 1);
    const y = Y(frame.rev[be]);
    g.be.append(svgEl('circle', { class: 'be-dot', cx: x, cy: y, r: 6 }), svgEl('text', { class: 'be-tag', x, y: y - 14 }, 'в плюсе'));
  }
  const mp = frame.monthPos;
  const i0 = Math.max(0, Math.floor(mp) - 1);
  const i1 = Math.min(23, i0 + 1);
  const value = lerp(frame.rev[i0], frame.rev[i1], mp - Math.floor(mp));
  const mx = chartX(mp);
  g.markerLine.setAttribute('x1', mx); g.markerLine.setAttribute('x2', mx);
  g.markerLine.setAttribute('y1', T - 6); g.markerLine.setAttribute('y2', T + ph);
  g.markerDot.setAttribute('cx', mx); g.markerDot.setAttribute('cy', Y(value));
  g.markerTag.setAttribute('x', Math.min(W - 40, Math.max(L + 24, mx)));
  g.markerTag.setAttribute('y', T - 10);
  g.markerTag.textContent = `${Math.round(mp)} мес.`;
}

/* --- Поток денег: аудитория → продукт → касса --- */
const FLOW = { L: [120, 100, 62], C: [480, 100, 84], R: [840, 100, 62] };
const FLOW_PATH = { in: 'M186 100 C260 30 330 170 392 100', out: 'M568 100 C640 30 710 170 774 100' };

function buildFlow(name) {
  const svg = dash.flow;
  svg.replaceChildren();
  const node = (cx, cy, r, cls) => svgEl('circle', { class: cls, cx, cy, r });
  svg.append(
    svgEl('path', { class: 'flow-path', id: 'flow-in', d: FLOW_PATH.in }),
    svgEl('path', { class: 'flow-path', id: 'flow-out', d: FLOW_PATH.out }),
    node(...FLOW.L, 'flow-node'), node(...FLOW.C, 'flow-orb'), node(...FLOW.R, 'flow-node'),
  );
  const ic = (id, cx, cy, size) => { const s = svgEl('svg', { class: 'flow-ic', x: cx - size / 2, y: cy - size / 2, width: size, height: size, viewBox: id.startsWith('i-') ? '0 0 64 64' : '0 0 24 24' }); s.append(svgEl('use', { href: `#${id}` })); return s; };
  svg.append(ic('i-people', 120, 100, 70), ic(`i-${dash.d.icon}`, 480, 100, 92), ic('u-coin', 840, 100, 62));
  dash.flowDots = { in: svgEl('g'), out: svgEl('g') };
  svg.append(dash.flowDots.in, dash.flowDots.out);
  // Подписи и числа — обычный HTML под схемой: читаются на любом экране
  dash.flowText = { reach: $('#flow-reach'), fresh: $('#flow-fresh'), money: $('#flow-money') };
  $('#flow-name').textContent = name;
  $('#flow-fresh-sub').textContent = dash.sim.mode === 'sub' ? 'новых клиентов в месяц' : 'покупок в месяц';
  dash.dotCounts = { in: -1, out: -1 };
}

function setDotGroup(group, pathId, count, cls, slow) {
  const path = $(`#${pathId}`, dash.flow);
  group.replaceChildren();
  const total = path.getTotalLength();
  for (let i = 0; i < count; i++) {
    const dot = svgEl('circle', { class: cls, r: cls === 'dot-out' ? 4.4 : 3.4 });
    if (motionAllowed()) {
      const duration = slow + (i % 5) * 0.35;
      const anim = svgEl('animateMotion', { dur: `${duration}s`, repeatCount: 'indefinite', begin: `-${((i / count) * duration).toFixed(2)}s` });
      anim.append(svgEl('mpath', { href: `#${pathId}` }));
      dot.append(anim);
    } else {
      const p = path.getPointAtLength((total * (i + 0.5)) / count);
      dot.setAttribute('cx', p.x.toFixed(1)); dot.setAttribute('cy', p.y.toFixed(1));
    }
    group.append(dot);
  }
}

function setDots(target) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const nIn = clamp(Math.round(Math.sqrt(target.reach) / 2.6), 6, 40);
  const nOut = clamp(Math.round(Math.sqrt(target.revenue / 1000) * 0.9), 2, 26);
  if (dash.dotCounts.in !== nIn || dash.dotCounts.motion !== motionAllowed()) setDotGroup(dash.flowDots.in, 'flow-in', nIn, 'dot-in', 3.2);
  if (dash.dotCounts.out !== nOut || dash.dotCounts.motion !== motionAllowed()) setDotGroup(dash.flowDots.out, 'flow-out', nOut, 'dot-out', 3.6);
  dash.dotCounts = { in: nIn, out: nOut, motion: motionAllowed() };
}

function renderFlow(frame) {
  dash.flowText.reach.textContent = fmtInt(frame.reach);
  dash.flowText.fresh.textContent = fmtInt(frame.fresh);
  dash.flowText.money.textContent = fmtRub(frame.revenue);
}

// Большие суммы в плитках — «10,9 млн ₽», чтобы число влезало
const fmtKpiRub = (n) => (Math.abs(n) >= 1e7 ? `${n < 0 ? '−' : ''}${(Math.abs(n) / 1e6).toFixed(1).replace('.', ',')} млн ₽` : fmtRub(n));

function renderFrame(frame) {
  setKpi('customers', fmtInt(frame.customers), null);
  setKpi('revenue', fmtKpiRub(frame.revenue), null);
  setKpi('profit', fmtKpiRub(frame.profit), null, frame.profit >= 0 ? 'pos' : 'neg');
  setKpi('year', fmtKpiRub(frame.year), null);
  renderChart(frame);
  renderFlow(frame);
}

// Переключатель анимаций: пересобрать частицы и показать итоговые значения
function onMotionChanged() {
  if (!dash.d) return;
  cancelAnimationFrame(dash.raf);
  dash.view = dash.target;
  renderFrame(dash.target);
  dash.dotCounts = { in: -1, out: -1 };
  setDots(dash.target);
}

/* ===== Копирование ===== */
function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:-9999px';
  const active = document.activeElement;
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  area.remove();
  if (active && active.focus) active.focus({ preventScroll: true });
  return ok;
}

let copyTimer = 0;
async function copyResult() {
  if (!state.result) return;
  const text = state.result.text;
  let ok;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    ok = legacyCopy(text); // нет Clipboard API или нет разрешения
  }
  ui.copy.textContent = ok ? 'Скопировано ✓' : 'Не удалось скопировать';
  announce(ok ? 'Текст скопирован в буфер обмена' : 'Не удалось скопировать текст');
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { ui.copy.textContent = 'Копировать всё'; }, 2000);
}

/* ===== Сброс, переключатель анимаций и запуск ===== */
function resetLists() {
  for (const key of KEYS) {
    state[key] = makeState(defaultNames(key));
    ui[key].input.value = '';
    ui[key].current = null;
    setError(key, '');
    updateFormMode(key);
    renderList(key, false);
  }
  ui.toasts.replaceChildren();
  state.result = null;
  renderResult();
  updateGenerate();
  saveLists();
  announce('Списки сброшены к исходным');
}

function setMotion(on, persist) {
  document.documentElement.setAttribute('data-motion', on ? 'on' : 'off');
  ui.motionToggle.setAttribute('aria-pressed', String(on));
  ui.motionLabel.textContent = on ? 'Анимации: вкл' : 'Анимации: выкл';
  if (persist) {
    try { localStorage.setItem(MOTION_KEY, on ? 'on' : 'off'); } catch (e) { /* без сохранения */ }
  }
  onMotionChanged();
}

function initMotion() {
  setMotion(motionAllowed(), false);
  ui.motionToggle.addEventListener('click', () => setMotion(!motionAllowed(), true));
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem(MOTION_KEY); } catch (err) { saved = null; }
    if (saved !== 'on' && saved !== 'off') setMotion(!e.matches, false);
  });
}

function init() {
  const stored = readStored();
  for (const key of KEYS) {
    state[key] = makeState(stored ? stored[key] : defaultNames(key));
    bindList(key);
    bindForm(key);
    updateFormMode(key);
    renderList(key, false);
  }
  ui.storageNote.hidden = storageOk;
  updateGenerate();
  initMotion();

  ui.generate.addEventListener('click', generate);
  ui.regen.addEventListener('click', generate);
  ui.copy.addEventListener('click', copyResult);
  ui.reset.addEventListener('click', () => {
    if (window.confirm('Сбросить оба списка к исходным? Свои варианты и правки будут удалены.')) resetLists();
  });
  ui.navResult.addEventListener('click', (e) => { if (!state.result) e.preventDefault(); });

  if ('ResizeObserver' in window) {
    let lastWidth = 0;
    new ResizeObserver(() => {
      const width = Math.round(dash.chart.getBoundingClientRect().width);
      if (!dash.d || !width || width === lastWidth) return;
      lastWidth = width;
      buildChart(); // новая ширина — пересобрать график под неё
      renderChart(dash.view || dash.target);
    }).observe(dash.chart.parentElement);
  }

  for (const slider of Object.values(dash.sliders)) slider.addEventListener('input', () => applySliders());
  $('#sim-reset').addEventListener('click', () => {
    if (!dash.d) return;
    for (const key of ['price', 'reach', 'conv', 'churn', 'fixed']) dash.sliders[key].value = dash.sim.defaults[key];
    dash.sliders.month.value = 12;
    applySliders();
  });
}

init();
