const DEF = window.SPF_DEMO_DATA;
let S = JSON.parse(JSON.stringify(DEF));
let scenarioBase = JSON.parse(JSON.stringify(DEF));
const activeScenarios = new Set(['bAllZero']);
let demoSnapshot = null;
let sel = { i: 0, c: 'tgt' };
let lessonStep = 1;
let lessonRow = 0;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const f = x => Number(x).toLocaleString('en-US', { maximumFractionDigits: 1 });
const N = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const MAX_VALUE_SLIDER_LIMIT = 1000000;
localStorage.removeItem('wip-slider-max');
let valueSliderLimit = 200;
let activeValueCell = null;

function syncCellSlider(input, value) {
  const slider = input.nextElementSibling;
  const active = activeValueCell === input.closest('td');
  slider.max = String(valueSliderLimit);
  slider.step = String(Math.max(1, Math.ceil(valueSliderLimit / 300)));
  const sliderValue = Math.min(N(value), valueSliderLimit);
  slider.value = String(sliderValue);
  slider.style.setProperty('--value-progress', `${valueSliderLimit ? sliderValue / valueSliderLimit * 100 : 0}%`);
  slider.setAttribute('aria-label', window.WIP_I18N.t('metric.' + input.dataset.k));
  slider.setAttribute('aria-hidden', String(!active));
  slider.tabIndex = active ? 0 : -1;
}

function activateValueCell(input) {
  const cell = input.closest('td[data-c]');
  if (!cell) return;
  if (activeValueCell !== cell) {
    deactivateValueCell();
    activeValueCell = cell;
    cell.classList.add('slider-active');
  }
  syncCellSlider(input, input.value);
}

function deactivateValueCell() {
  if (!activeValueCell) return;
  const slider = activeValueCell.querySelector('input.cell-slider');
  activeValueCell.classList.remove('slider-active');
  if (slider) {
    slider.setAttribute('aria-hidden', 'true');
    slider.tabIndex = -1;
  }
  activeValueCell = null;
}
const SHIFT_MINUTES = [60, 60, 60, 30, 30, 60, 60, 60, 60, 30, 60, 30, 60];
const LESSON_CELLS = ['bal', 'tgt', 'tl', 'load', 'qc', 'bal'];
function fitPickerCalendar(_, __, picker) {
  picker.calendarContainer.style.width = `${Math.ceil(picker.input.getBoundingClientRect().width)}px`;
}

const timePickerOptions = {
  enableTime: true,
  noCalendar: true,
  dateFormat: 'h:i K',
  time_24hr: false,
  minuteIncrement: 5,
  allowInput: false,
  disableMobile: true,
  onOpen: fitPickerCalendar,
  minTime: '08:00',
  maxTime: '21:00'
};
const shiftStartPicker = flatpickr('#shiftStart', { ...timePickerOptions, defaultDate: '8:00 AM', maxTime: '20:55' });
const shiftEndPicker = flatpickr('#shiftEnd', { ...timePickerOptions, defaultDate: '5:00 PM', minTime: '08:05' });

function pickerMinutes(picker) {
  const date = picker.selectedDates[0];
  return date ? date.getHours() * 60 + date.getMinutes() : NaN;
}

function clockValue(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function setPickerMinutes(picker, minutes) {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  picker.setDate(date, false);
}

function normalizeShiftPickers(changedPicker) {
  let start = pickerMinutes(shiftStartPicker);
  let end = pickerMinutes(shiftEndPicker);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  if (start >= end && changedPicker === shiftStartPicker) {
    end = start + 5;
    if (end > 21 * 60) {
      start = 21 * 60 - 5;
      end = 21 * 60;
      setPickerMinutes(shiftStartPicker, start);
    }
    setPickerMinutes(shiftEndPicker, end);
  } else if (start >= end && changedPicker === shiftEndPicker) {
    start = end - 5;
    if (start < 8 * 60) {
      start = 8 * 60;
      end = start + 5;
      setPickerMinutes(shiftEndPicker, end);
    }
    setPickerMinutes(shiftStartPicker, start);
  }

  return pickerMinutes(shiftStartPicker) < pickerMinutes(shiftEndPicker);
}

function makeShiftData(source, start, end, targetPerHour) {
  const previousRows = new Map(source.rows.map(row => [row.l, row]));
  let workedMinutes = 0;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  const rows = [];

  for (let hour = 8; hour < 21; hour++) {
    const periodStart = hour * 60;
    const periodEnd = periodStart + 60;
    const activeStart = Math.max(periodStart, startMinutes);
    const activeEnd = Math.min(periodEnd, endMinutes);
    if (activeEnd <= activeStart) continue;
    const minutes = Math.min(SHIFT_MINUTES[hour - 8], activeEnd - activeStart);
    const previousMinutes = workedMinutes;
    workedMinutes += minutes;
    const label = `${clockValue(activeStart)}-${clockValue(activeEnd)}`;
    const previous = previousRows.get(label) || {};
    const baseTarget = Math.round(targetPerHour * workedMinutes / 60) - Math.round(targetPerHour * previousMinutes / 60);
    rows.push({
      l: label,
      m: minutes,
      b: baseTarget,
      load: N(previous.load),
      loadEntered: previous.loadEntered ?? true,
      qc: N(previous.qc),
      fn: N(previous.fn),
      qcEntered: Boolean(previous.qcEntered),
      fnEntered: Boolean(previous.fnEntered)
    });
  }

  return { open: N(source.open), rows };
}

function currentShiftData(source) {
  return makeShiftData(source, clockValue(pickerMinutes(shiftStartPicker)), clockValue(pickerMinutes(shiftEndPicker)), N($('#targetPerHour').value));
}

function visibleRowCount() {
  if ($('#displayAllHours').checked) return S.rows.length;
  let count = 1;
  while (count < S.rows.length && S.rows[count - 1].qcEntered && S.rows[count - 1].fnEntered) count++;
  return count;
}

function updateShiftSettings(changedPicker) {
  normalizeShiftPickers(changedPicker);
  const start = pickerMinutes(shiftStartPicker);
  const end = pickerMinutes(shiftEndPicker);
  const valid = Number.isFinite(start) && Number.isFinite(end) && start >= 8 * 60 && end <= 21 * 60 && end > start;
  $('#shiftError').hidden = valid;
  $('#shiftStart').setAttribute('aria-invalid', String(!valid));
  $('#shiftEnd').setAttribute('aria-invalid', String(!valid));
  if (!valid) return;

  const oldLesson = S.rows[lessonRow]?.l;
  scenarioBase = currentShiftData(S);
  S = JSON.parse(JSON.stringify(scenarioBase));
  activeScenarios.clear();
  demoSnapshot = null;
  const nextLesson = S.rows.findIndex(row => row.l === oldLesson);
  lessonRow = nextLesson >= 0 ? nextLesson : 0;
  build();
  updateScenarioButtons();
  update();
}

function calc() {
  const rows = S.rows, n = rows.length;
  const remain = [];
  let s = 0;
  for (let i = n - 1; i >= 0; i--) {
    s += N(rows[i].m);
    remain[i] = s;
  }
  let bal = N(S.open), cumB = 0, cumQ = 0, cumF = 0, cumT = 0, out = [];
  for (let i = 0; i < n; i++) {
    const r = rows[i], b = N(r.b), load = N(r.load), qc = N(r.qc), fn = N(r.fn), m = N(r.m);
    const shortfall = Math.max(0, cumB - cumQ);
    const raw = remain[i] > 0 ? shortfall * m / remain[i] : 0;
    const extra = Math.round(raw);
    const target = b + extra;
    const tl = Math.round(Math.max(0, target - bal) * 1.25);
    const balBefore = bal;
    bal = bal + load - qc;
    const x = { i, b, m, load, qc, fn, shortfall, raw, extra, target, tl, balBefore, bal, remain: remain[i], cumBBefore: cumB, cumQBefore: cumQ };
    cumB += b; cumQ += qc; cumF += fn; cumT += target;
    x.cumQ = cumQ; x.cumF = cumF; x.cumT = cumT; x.qcDiff = cumQ - cumT; x.fnDiff = cumF - cumT;
    x.loadCls = load < tl ? 'lo' : (load > 1.25 * tl ? 'hi' : '');
    out.push(x);
  }
  const T = { tl: 0, load: 0, tgt: 0, qc: 0, fn: 0, b: 0, extra: 0 };
  out.forEach(x => { T.tl += x.tl; T.load += x.load; T.tgt += x.target; T.qc += x.qc; T.fn += x.fn; T.b += x.b; T.extra += x.extra; });
  T.bal = bal; T.qcDiff = T.qc - T.tgt; T.fnDiff = T.fn - T.tgt;
  T.loadCls = T.load < T.tl ? 'lo' : (T.load > 1.25 * T.tl ? 'hi' : '');
  return { rows: out, T };
}

const cells = {};
function build() {
  deactivateValueCell();
  const tb = $('#tb');
  tb.innerHTML = '';
  Object.keys(cells).forEach(key => delete cells[key]);
  S.rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th data-i="${i}">${r.l}</th>
      <td data-i="${i}" data-c="tl"><span></span></td>
      <td data-i="${i}" data-c="load"><div class="cellwrap"><input class="cell w5" type="number" min="0" data-k="load" data-i="${i}"><input class="cell-slider" type="range" min="0" max="200" step="1" tabindex="-1" aria-hidden="true"></div></td>
      <td data-i="${i}" data-c="tgt"><span></span></td>
      <td data-i="${i}" data-c="qc"><div class="cellwrap"><input class="cell" type="number" min="0" data-k="qc" data-i="${i}"><input class="cell-slider" type="range" min="0" max="200" step="1" tabindex="-1" aria-hidden="true"><small class="diff"></small></div></td>
      <td data-i="${i}" data-c="bal"><span></span></td>
      <td data-i="${i}" data-c="fn"><div class="cellwrap"><input class="cell" type="number" min="0" data-k="fn" data-i="${i}"><input class="cell-slider" type="range" min="0" max="200" step="1" tabindex="-1" aria-hidden="true"><small class="diff"></small></div></td>`;
    tb.appendChild(tr);
  });
  $$('td[data-c]').forEach(td => { cells[td.dataset.i + '_' + td.dataset.c] = td; });
  $('#setRows').innerHTML = S.rows.map(row => `<tr><td>${row.l}</td><td>${f(row.m)}</td><td>${f(row.b)}</td></tr>`).join('');
  $('#setMinutesTotal').textContent = f(S.rows.reduce((total, row) => total + N(row.m), 0));
  $('#setBaseTotal').textContent = f(S.rows.reduce((total, row) => total + N(row.b), 0));
  $('#lessonPeriod').innerHTML = S.rows.map((r, i) => `<option value="${i}">${r.l}</option>`).join('');
  lessonRow = Math.min(lessonRow, S.rows.length - 1);
  $('#lessonPeriod').value = String(lessonRow);
}
function syncInputs() {
  S.rows.forEach((r, i) => {
    $$(`input[data-i="${i}"]`).forEach(inp => {
      const entered = inp.dataset.k === 'load' ? r.loadEntered : inp.dataset.k === 'qc' ? r.qcEntered : r.fnEntered;
      if (document.activeElement !== inp) inp.value = entered ? r[inp.dataset.k] : '';
    });
  });
  if (document.activeElement !== $('#open')) $('#open').value = S.open;
}
function arrow(d) {
  if (!d) return '';
  return d < 0 ? `<span aria-hidden="true">↓</span>${f(Math.abs(d))}` : `<span aria-hidden="true">↑</span>${f(d)}`;
}
function renderLesson(R) {
  const t = window.WIP_I18N.t;
  const x = R.rows[lessonRow], row = S.rows[lessonRow], previous = S.rows[lessonRow - 1];
  const extraFormula = x.remain > 0
    ? `round(${f(x.shortfall)} × ${f(x.m)} ÷ ${f(x.remain)}) = ${f(x.extra)}`
    : t('lesson.noTime');
  const steps = [
    {
      title: t('lesson.startTitle'),
      description: t(lessonRow === 0 ? 'lesson.startDescFirst' : 'lesson.startDescNext'),
      calculation: lessonRow === 0
        ? t('lesson.startCalcFirst', { open: f(S.open), period: row.l, balance: f(x.balBefore) })
        : t('lesson.startCalcNext', { previous: previous.l, period: row.l, balance: f(x.balBefore) })
    },
    {
      title: t('lesson.targetTitle'),
      description: t('lesson.targetDesc'),
      calculation: t('lesson.targetCalc', {
        baseBefore: f(x.cumBBefore), qcBefore: f(x.cumQBefore), shortfall: f(x.shortfall), extraFormula,
        base: f(x.b), extra: f(x.extra), target: f(x.target)
      })
    },
    {
      title: t('lesson.loadTitle'),
      description: t('lesson.loadDesc'),
      calculation: t('lesson.loadCalc', { target: f(x.target), balance: f(x.balBefore), load: f(x.tl) })
    },
    {
      title: t('lesson.actualTitle'),
      description: t('lesson.actualDesc'),
      calculation: t('lesson.actualCalc', { period: row.l, load: f(x.load), balance: f(x.balBefore), afterLoad: f(x.balBefore + x.load) })
    },
    {
      title: t('lesson.qcTitle'),
      description: t('lesson.qcDesc'),
      calculation: t('lesson.qcCalc', { period: row.l, qc: f(x.qc) })
    },
    {
      title: t('lesson.balanceTitle'),
      description: t(lessonRow < S.rows.length - 1 ? 'lesson.balanceDescNext' : 'lesson.balanceDescLast'),
      calculation: lessonRow < S.rows.length - 1
        ? t('lesson.balanceCalcNext', { balanceBefore: f(x.balBefore), load: f(x.load), qc: f(x.qc), balance: f(x.bal), next: S.rows[lessonRow + 1].l })
        : t('lesson.balanceCalcLast', { balanceBefore: f(x.balBefore), load: f(x.load), qc: f(x.qc), balance: f(x.bal), period: row.l })
    }
  ];
  const step = steps[lessonStep];
  $('#lessonProgress').textContent = t('lesson.progress', { step: lessonStep + 1, total: steps.length, period: row.l });
  $('#lessonTitle').textContent = step.title;
  $('#lessonDescription').textContent = step.description;
  $('#lessonCalculation').textContent = step.calculation;
  $$('.lesson-step').forEach((button, index) => {
    button.setAttribute('aria-current', index === lessonStep ? 'step' : 'false');
  });
  $('#lessonPrev').disabled = lessonStep === 0;
  $('#lessonNext').disabled = lessonStep === steps.length - 1;
}
function selectLessonCell(R) {
  sel = { i: lessonRow, c: LESSON_CELLS[lessonStep] };
  paint(R);
}
function update() {
  const R = calc();
  const shownCount = visibleRowCount();
  R.rows.forEach(x => {
    const i = x.i, g = c => cells[i + '_' + c];
    const rowElement = g('tl').parentElement;
    const pending = i >= shownCount;
    rowElement.classList.toggle('row-pending', pending);
    rowElement.setAttribute('aria-hidden', String(pending));
    rowElement.inert = pending;
    g('tl').firstElementChild.textContent = f(x.tl);
    const ld = g('load').querySelector('input'); ld.className = 'cell w5 ' + x.loadCls;
    syncCellSlider(ld, x.load);
    const t = g('tgt'); t.className = x.extra > 0 ? 'warn' : ''; t.firstElementChild.textContent = f(x.target);
    const qi = g('qc').querySelector('input'); qi.className = 'cell ' + (x.qc > x.target ? 'pos' : '');
    syncCellSlider(qi, x.qc);
    const qd = g('qc').querySelector('small'); qd.className = 'diff' + (x.qcDiff > 0 ? ' up' : ''); qd.innerHTML = arrow(x.qcDiff);
    g('bal').firstElementChild.textContent = f(x.bal);
    const fi = g('fn').querySelector('input'); fi.className = 'cell ' + (x.fn > 0 && x.fn >= x.target ? 'pos' : '');
    syncCellSlider(fi, x.fn);
    const fd = g('fn').querySelector('small'); fd.className = 'diff' + (x.fnDiff > 0 ? ' up' : ''); fd.innerHTML = arrow(x.fnDiff);
  });
  const shownRows = R.rows.slice(0, shownCount);
  const T = { tl: 0, load: 0, tgt: 0, qc: 0, fn: 0, b: 0 };
  shownRows.forEach(row => {
    T.tl += row.tl; T.load += row.load; T.tgt += row.target;
    T.qc += row.qc; T.fn += row.fn; T.b += row.b;
  });
  T.bal = shownRows.at(-1).bal;
  T.qcDiff = shownRows.at(-1).qcDiff;
  T.fnDiff = shownRows.at(-1).fnDiff;
  T.loadCls = T.load < T.tl ? 'lo' : (T.load > 1.25 * T.tl ? 'hi' : '');
  const g = c => cells['-1_' + c];
  g('tl').textContent = f(T.tl);
  g('load').innerHTML = `<span class="${T.loadCls}">${f(T.load)}</span>`;
  g('tgt').innerHTML = `<span class="${T.extra > 0 ? 'warn' : ''}">${f(T.tgt)}</span>`;
  g('qc').innerHTML = `<div class="cellwrap"><span class="${T.qc > T.tgt ? 'pos' : ''}">${f(T.qc)}</span><small class="diff${T.qcDiff > 0 ? ' up' : ''}">${arrow(T.qcDiff)}</small></div>`;
  g('bal').textContent = f(T.bal);
  g('fn').innerHTML = `<div class="cellwrap"><span class="${T.fn > 0 && T.fn >= T.tgt ? 'pos' : ''}">${f(T.fn)}</span><small class="diff${T.fnDiff > 0 ? ' up' : ''}">${arrow(T.fnDiff)}</small></div>`;
  syncInputs();
  paint(R);
  renderLesson(R);
}

function td(i, c) { return cells[i + '_' + c]; }
function paint(R) {
  $$('.sel').forEach(e => e.classList.remove('sel'));
  $$('.dep').forEach(e => e.classList.remove('dep'));
  const { i, c } = sel, n = S.rows.length, d = [];
  const addC = (ii, cc) => { const e = td(ii, cc); if (e) d.push(e); };
  const addS = k => { const e = document.querySelector(`[data-setting="${k}"]`); if (e) d.push(e); };
  const s = td(i, c); if (s) s.classList.add('sel');
  if (i === -1) { for (let j = 0; j < n; j++) addC(j, c); if (c === 'bal') addC(n - 1, 'bal'); }
  else if (c === 'tl') { addC(i, 'tgt'); if (i > 0) addC(i - 1, 'bal'); else d.push($('#open').parentElement); }
  else if (c === 'tgt') { for (let j = 0; j < i; j++) addC(j, 'qc'); addS('shiftStart'); addS('shiftEnd'); addS('targetPerHour'); }
  else if (c === 'bal') { if (i > 0) addC(i - 1, 'bal'); else d.push($('#open').parentElement); addC(i, 'load'); addC(i, 'qc'); }
  else if (c === 'qc' || c === 'fn') { for (let j = 0; j <= i; j++) { addC(j, c); addC(j, 'tgt'); } }
  else if (c === 'load') addC(i, 'tl');
  d.forEach(e => { if (e !== s) e.classList.add('dep'); });
  $('#selectedExplanation').innerHTML = explain(R, i, c);
  $$('.formula-summary-item').forEach(item => {
    item.hidden = item.dataset.formula !== c;
  });
  $('#side').scrollTop = 0;
}
function explain(R, i, c) {
  const t = window.WIP_I18N.t;
  if (i === -1) return explainSum(R, c);
  const x = R.rows[i], r = S.rows[i], lab = r.l;
  const head = `<h2>${t('metric.' + c)}</h2><div class="sub"><span class="tag">${t('explain.rowTag', { period: lab })}</span></div>`;
  if (c === 'tl') {
    const gap = Math.max(0, x.target - x.balBefore);
    return head + `<div class="formula">${t('metric.tl')} = round( max(0, ${t('metric.tgt')} − ${t('explain.balanceBefore')}) × 1.25 )</div>
    <div class="calc">${t('explain.balanceBefore')} = ${f(x.balBefore)} ${t(i === 0 ? 'explain.opening' : 'explain.previousRow')}
${t('explain.hourlyTarget')} = ${f(x.target)}
max(0, ${f(x.target)} − ${f(x.balBefore)}) = ${f(gap)}
${f(gap)} × 1.25 = ${f(gap * 1.25)} → ${t('explain.roundedLoad')} = ${f(x.tl)}</div>
    <div class="why">${t('explain.tlWhy')}</div>
    ${x.tl === 0 ? `<div class="note">${t('explain.tlNote')}</div>` : ''}`;
  }
  if (c === 'load') {
    const lim = 1.25 * x.tl;
    const why = x.loadCls === 'hi' ? t('explain.loadHigh') : x.loadCls === 'lo' ? t('explain.loadLow') : t('explain.loadNormal');
    return head + `<div class="formula">${t('metric.load')} = period_wip_line</div>
    <div class="calc">${f(x.load)} | ${t('metric.tl')} = ${f(x.tl)} | 1.25 × ${f(x.tl)} = ${f(lim)}</div>
    <div class="why">${t('explain.loadInput')}<br><br>${why}</div>`;
  }
  if (c === 'tgt') {
    const first = i === 0;
    const calculation = t('lesson.targetCalc', {
      baseBefore: f(x.cumBBefore), qcBefore: f(x.cumQBefore), shortfall: f(x.shortfall),
      extraFormula: x.remain > 0 ? `round(${f(x.shortfall)} × ${f(x.m)} ÷ ${f(x.remain)}) = ${f(x.extra)}` : t('lesson.noTime'),
      base: f(x.b), extra: f(x.extra), target: f(x.target)
    });
    return head + `<div class="formula">${t('explain.tgtWhy')}</div><div class="calc">${calculation}</div>${first ? `<div class="why">${t('explain.firstPeriod')}</div>` : ''}`;
  }
  if (c === 'qc') {
    const arrowMeaning = x.qcDiff < 0 ? t('explain.qcBehind', { amount: f(Math.abs(x.qcDiff)) }) : x.qcDiff > 0 ? t('explain.qcAhead', { amount: f(x.qcDiff) }) : t('explain.qcEqual');
    return head + `<div class="formula">${t('metric.qc')} = period_qc_pass<br>${t('explain.qcArrow')} = Σ${t('metric.qc')} − Σ${t('metric.tgt')}</div>
    <div class="calc">${t('metric.qc')} = ${f(x.qc)} | Σ${t('metric.qc')} = ${f(x.cumQ)} | Σ${t('metric.tgt')} = ${f(x.cumT)}<br>${arrowMeaning}</div>
    <div class="why">${t('explain.qcGreen')}<br><br>${t('explain.qcInput')}</div>`;
  }
  if (c === 'bal') {
    return head + `<div class="formula">${t('metric.bal')} = ${t('explain.balanceBefore')} + ${t('metric.load')} − ${t('metric.qc')}</div>
    <div class="calc">${f(x.balBefore)} + ${f(x.load)} − ${f(x.qc)} = ${f(x.bal)}</div>
    <div class="why">${t('explain.balanceWhy')}</div>`;
  }
  if (c === 'fn') {
    return head + `<div class="formula">${t('metric.fn')} = period_fn_qty<br>${t('explain.qcArrow')} = Σ${t('metric.fn')} − Σ${t('metric.tgt')}</div>
    <div class="calc">${t('metric.fn')} = ${f(x.fn)} | Σ${t('metric.fn')} = ${f(x.cumF)} | Σ${t('metric.tgt')} = ${f(x.cumT)}<br>${t('metric.fn')} − ${t('metric.tgt')} = ${f(x.fnDiff)}</div>
    <div class="why">${t('explain.fnGreen')}<br><br>${t('explain.fnSeparate')}</div>`;
  }
}
function explainSum(R, c) {
  const t = window.WIP_I18N.t;
  const T = R.T, head = `<h2>${t('common.summary')}: ${t('metric.' + c)}</h2><div class="sub"><span class="tag">${t('explain.summaryTag')}</span></div>`;
  const list = k => R.rows.map(x => f(x[k])).join(' + ');
  if (c === 'tl') return head + `<div class="formula">${t('explain.sumRows')}</div><div class="calc">${list('tl')} = ${f(T.tl)}</div>`;
  if (c === 'load') return head + `<div class="formula">Σ ${t('metric.load')}</div><div class="calc">${list('load')} = ${f(T.load)}</div><div class="why">${t('explain.sumLoadColor', { limit: f(1.25 * T.tl), status: t(T.loadCls === 'hi' ? 'explain.statusHigh' : T.loadCls === 'lo' ? 'explain.statusLow' : 'explain.statusOk') })}</div>`;
  if (c === 'tgt') return head + `<div class="formula">Σ ${t('metric.tgt')}</div><div class="calc">${list('target')} = ${f(T.tgt)}<br>${t('explain.sumTarget', { base: f(T.b), extra: f(T.extra) })}</div><div class="why">${t('explain.extraWhy')}</div>`;
  if (c === 'qc') return head + `<div class="formula">Σ ${t('metric.qc')} | ${t('explain.qcArrow')} = Σ${t('metric.qc')} − Σ${t('metric.tgt')}</div><div class="calc">${list('qc')} = ${f(T.qc)}<br>${f(T.qc)} − ${f(T.tgt)} = ${f(T.qcDiff)}</div>`;
  if (c === 'bal') return head + `<div class="formula">${t('explain.sumBalance')}</div><div class="calc">= ${f(T.bal)}</div>`;
  if (c === 'fn') return head + `<div class="formula">Σ ${t('metric.fn')} | ${t('explain.qcArrow')} = Σ${t('metric.fn')} − Σ${t('metric.tgt')}</div><div class="calc">${list('fn')} = ${f(T.fn)}<br>${f(T.fn)} − ${f(T.tgt)} = ${f(T.fnDiff)}</div>`;
}

document.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('input.cell-slider')) {
    const valueInput = t.previousElementSibling;
    valueInput.value = t.value;
    valueInput.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (t.id === 'open') { S.open = N(t.value); clearScenarioSelectionForManualEdit(); update(); return; }
  if (t.id === 'targetPerHour') { updateShiftSettings(); return; }
  if (t.dataset && t.dataset.k) {
    S.rows[t.dataset.i][t.dataset.k] = N(t.value);
    if (t.dataset.k === 'load') S.rows[t.dataset.i].loadEntered = t.value !== '';
    if (t.dataset.k === 'qc') S.rows[t.dataset.i].qcEntered = t.value !== '';
    if (t.dataset.k === 'fn') S.rows[t.dataset.i].fnEntered = t.value !== '';
    lessonRow = Number(t.dataset.i);
    $('#lessonPeriod').value = String(lessonRow);
    if (t.closest('td[data-c]')) sel = { i: +t.dataset.i, c: t.closest('td').dataset.c };
    clearScenarioSelectionForManualEdit();
    update();
  }
});
$('#shiftStart').addEventListener('change', () => updateShiftSettings(shiftStartPicker));
$('#shiftEnd').addEventListener('change', () => updateShiftSettings(shiftEndPicker));
$('#displayAllHours').addEventListener('change', update);
$('#valueSliderMaxSetting').value = String(valueSliderLimit);
$('#valueSliderMaxSetting').addEventListener('change', e => {
  const max = Number(e.target.value);
  if (!Number.isSafeInteger(max) || max < 1) {
    e.target.value = String(valueSliderLimit);
    return;
  }
  valueSliderLimit = Math.min(max, MAX_VALUE_SLIDER_LIMIT);
  e.target.value = String(valueSliderLimit);
  update();
});
$('#languageSelect').addEventListener('change', e => {
  window.WIP_I18N.setLanguage(e.target.value);
  update();
});
$$('input[name="theme"]').forEach(input => input.addEventListener('change', e => {
  if (e.target.checked) window.WIP_I18N.setTheme(e.target.value);
}));
function pick(e) {
  const c = e.target.closest('td[data-c]');
  if (c) {
    sel = { i: +c.dataset.i, c: c.dataset.c };
    const stepForCell = { tgt: 1, tl: 2, load: 3, qc: 4, bal: 5 }[c.dataset.c];
    if (+c.dataset.i >= 0 && stepForCell !== undefined) {
      lessonRow = +c.dataset.i;
      lessonStep = stepForCell;
      $('#lessonPeriod').value = String(lessonRow);
      renderLesson(calc());
    }
    paint(calc());
  }
}
document.addEventListener('click', pick);
document.addEventListener('focusin', e => {
  pick(e);
  const input = e.target.closest('input.cell[data-k]');
  if (input) activateValueCell(input);
  else if (e.target.matches('input.cell-slider')) activateValueCell(e.target.previousElementSibling);
  else if (activeValueCell && !activeValueCell.contains(e.target)) deactivateValueCell();
});
document.addEventListener('click', e => {
  const input = e.target.closest('input.cell[data-k]');
  if (input) activateValueCell(input);
  else if (e.target.matches('input.cell-slider')) activateValueCell(e.target.previousElementSibling);
  else if (activeValueCell && !activeValueCell.contains(e.target)) deactivateValueCell();
});
$('#valueSliderMaxSetting').addEventListener('input', e => {
  const max = Number(e.target.value);
  if (!Number.isSafeInteger(max) || max < 1) return;
  valueSliderLimit = Math.min(max, MAX_VALUE_SLIDER_LIMIT);
  update();
});
document.addEventListener('keydown', e => {
  const settingsMenu = $('.settings-menu');
  if (e.key === 'Escape' && settingsMenu.open) {
    settingsMenu.open = false;
    $('.settings-toggle').focus();
  }
});
function updateScenarioButtons() {
  $$('.scenario-button:not(#bRefresh)').forEach(button => {
    button.setAttribute('aria-pressed', String(activeScenarios.has(button.id)));
  });
}
function applyScenarioSelection() {
  S = JSON.parse(JSON.stringify(scenarioBase));
  if (activeScenarios.has('bQcTarget')) {
    for (let i = 0; i < S.rows.length; i++) {
      S.rows[i].qc = calc().rows[i].target;
      S.rows[i].qcEntered = true;
    }
  }
  if (activeScenarios.has('bQcZero')) S.rows.forEach(row => { row.qc = 0; row.qcEntered = false; });

  if (activeScenarios.has('bAllZero')) {
    S.rows.forEach(row => { row.qc = 0; row.fn = 0; });
  } else {
    const targets = calc().rows.map(row => row.target);
    if (activeScenarios.has('bFnTarget')) S.rows.forEach((row, i) => { row.fn = targets[i]; row.fnEntered = true; });
    if (activeScenarios.has('bFnZero')) S.rows.forEach(row => { row.fn = 0; row.fnEntered = false; });
  }
  if (activeScenarios.has('bLoadTarget')) {
    for (let i = 0; i < S.rows.length; i++) {
      S.rows[i].load = calc().rows[i].tl;
      S.rows[i].loadEntered = true;
    }
  }
  if (activeScenarios.has('bLoadZero')) S.rows.forEach(row => { row.load = 0; row.loadEntered = true; });
  updateScenarioButtons();
  update();
}
function clearScenarioSelectionForManualEdit() {
  scenarioBase = JSON.parse(JSON.stringify(S));
  activeScenarios.clear();
  updateScenarioButtons();
}
function toggleScenario(scenarioId) {
  if (scenarioId === 'bReset') {
    if (activeScenarios.has('bReset') && demoSnapshot) {
      scenarioBase = JSON.parse(JSON.stringify(demoSnapshot.base));
      activeScenarios.clear();
      demoSnapshot.active.forEach(id => activeScenarios.add(id));
      demoSnapshot = null;
      applyScenarioSelection();
      return;
    }

    demoSnapshot = {
      base: JSON.parse(JSON.stringify(scenarioBase)),
      active: [...activeScenarios]
    };
    const demoData = { ...DEF, rows: DEF.rows.map(row => ({ ...row, qcEntered: true, fnEntered: true })) };
    scenarioBase = currentShiftData(demoData);
    activeScenarios.clear();
    activeScenarios.add('bReset');
    applyScenarioSelection();
    return;
  }

  if (activeScenarios.has(scenarioId)) {
    activeScenarios.delete(scenarioId);
    if (scenarioId === 'bLoadTarget') activeScenarios.add('bLoadZero');
    if (scenarioId === 'bQcTarget') activeScenarios.add('bQcZero');
    if (scenarioId === 'bFnTarget') activeScenarios.add('bFnZero');
    applyScenarioSelection();
    return;
  }

  demoSnapshot = null;
  activeScenarios.delete('bReset');
  if (scenarioId === 'bLoadTarget') activeScenarios.delete('bLoadZero');
  if (scenarioId === 'bLoadZero') activeScenarios.delete('bLoadTarget');
  if (scenarioId === 'bQcTarget') activeScenarios.delete('bQcZero');
  if (scenarioId === 'bQcZero') activeScenarios.delete('bQcTarget');
  if (scenarioId === 'bFnTarget') activeScenarios.delete('bFnZero');
  if (scenarioId === 'bFnZero') activeScenarios.delete('bFnTarget');
  if (scenarioId === 'bAllZero') {
    ['bQcTarget', 'bQcZero', 'bFnTarget', 'bFnZero'].forEach(id => activeScenarios.delete(id));
  } else if (scenarioId !== 'bLoadTarget') {
    activeScenarios.delete('bAllZero');
  }
  activeScenarios.add(scenarioId);

  if (scenarioId === 'bLoadTarget' && activeScenarios.has(scenarioId)) sel = { i: 0, c: 'load' };
  applyScenarioSelection();
}
['bReset', 'bLoadTarget', 'bQcTarget', 'bFnTarget'].forEach(id => {
  $('#' + id).onclick = () => toggleScenario(id);
});
$('#bRefresh').onclick = () => {
  demoSnapshot = null;
  activeScenarios.clear();
  activeScenarios.add('bAllZero');
  S = JSON.parse(JSON.stringify(scenarioBase));
  S.rows.forEach(row => {
    row.load = 0;
    row.loadEntered = false;
    row.qc = 0;
    row.fn = 0;
    row.qcEntered = false;
    row.fnEntered = false;
  });
  scenarioBase = JSON.parse(JSON.stringify(S));
  sel = { i: 0, c: 'tgt' };
  lessonRow = 0;
  lessonStep = 1;
  $('#lessonPeriod').value = '0';
  updateScenarioButtons();
  update();
};
$('#lessonPeriod').addEventListener('change', e => {
  lessonRow = Number(e.target.value);
  selectLessonCell(calc());
  renderLesson(calc());
});
$$('.lesson-step').forEach(button => button.addEventListener('click', () => {
  lessonStep = Number(button.dataset.lessonStep);
  selectLessonCell(calc());
  renderLesson(calc());
}));
$('#lessonPrev').onclick = () => {
  if (lessonStep > 0) lessonStep--;
  selectLessonCell(calc());
  renderLesson(calc());
};
$('#lessonNext').onclick = () => {
  if (lessonStep < LESSON_CELLS.length - 1) lessonStep++;
  selectLessonCell(calc());
  renderLesson(calc());
};
const initialData = { ...DEF, rows: DEF.rows.map(row => ({ ...row, load: 0, loadEntered: false, qcEntered: false, fnEntered: false })) };
S = currentShiftData(initialData);
scenarioBase = JSON.parse(JSON.stringify(S));
build();
applyScenarioSelection();
const tableCard = $('.tblcard');
const sidePanel = $('#side');
const settingsPanel = $('.settings-panel');
const syncSideHeight = () => {
  const sideRect = sidePanel.getBoundingClientRect();
  sidePanel.style.height = `${tableCard.getBoundingClientRect().height}px`;
  settingsPanel.style.width = `${sideRect.width}px`;
};
if ('ResizeObserver' in window) {
  const sideHeightObserver = new ResizeObserver(syncSideHeight);
  sideHeightObserver.observe(tableCard);
} else {
  window.addEventListener('resize', syncSideHeight);
}
syncSideHeight();