const DEF = window.SPF_DEMO_DATA;
let S = JSON.parse(JSON.stringify(DEF));
let scenarioBase = JSON.parse(JSON.stringify(DEF));
const activeScenarios = new Set(['bAllZero']);
let demoSnapshot = null;
let sel = { i: 0, c: 'tgt' };
let lessonStep = 1;
let lessonRow = 0;
let gameSession = null;
let gameSnapshot = null;
let gameTimerId = null;
let gameSettings = null;
let gameIsOpen = false;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const f = x => Number(x).toLocaleString('en-US', { maximumFractionDigits: 1 });
const N = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const MAX_VALUE_SLIDER_LIMIT = 1000000;
localStorage.removeItem('wip-slider-max');
const STORAGE_KEY = 'spf-hourly-saved-state';
const GAME_STORAGE_KEY = 'spf-hourly-game-session';
let saveFeedbackTimer;

function readSavedSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (snapshot?.version !== 1 || !snapshot.settings || !snapshot.state || !Array.isArray(snapshot.state.rows) || !snapshot.state.rows.length) return null;

    const settings = snapshot.settings;
    const shiftStart = Number(settings.shiftStart);
    const shiftEnd = Number(settings.shiftEnd);
    const targetPerHour = Number(settings.targetPerHour);
    const sliderLimit = Number(settings.valueSliderLimit);
    if (![shiftStart, shiftEnd, targetPerHour, sliderLimit].every(Number.isFinite) || shiftStart < 480 || shiftEnd > 1260 || shiftStart >= shiftEnd || targetPerHour < 0 || !Number.isSafeInteger(sliderLimit) || sliderLimit < 1 || sliderLimit > MAX_VALUE_SLIDER_LIMIT) return null;
    if (!Number.isFinite(Number(snapshot.state.open)) || snapshot.state.rows.some(row => !row || typeof row.l !== 'string')) return null;

    return {
      settings: { shiftStart, shiftEnd, targetPerHour, valueSliderLimit: sliderLimit, displayAllHours: Boolean(settings.displayAllHours) },
      state: {
        open: N(snapshot.state.open),
        rows: snapshot.state.rows.map(row => ({
          l: row.l, m: N(row.m), b: N(row.b), load: N(row.load), loadEntered: Boolean(row.loadEntered),
          qc: N(row.qc), qcEntered: Boolean(row.qcEntered), fn: N(row.fn), fnEntered: Boolean(row.fnEntered)
        }))
      }
    };
  } catch {
    return null;
  }
}

function readSavedGameState() {
  try {
    const saved = JSON.parse(localStorage.getItem(GAME_STORAGE_KEY));
    const session = saved?.session;
    const rows = session?.challenge?.rows;
    const settings = saved?.settings;
    if (saved?.version !== 1 || !session || !settings || !Array.isArray(rows) || !rows.length) return null;
    if (!Array.isArray(session.entries) || session.entries.length !== rows.length || !Array.isArray(session.answers) || session.answers.length !== rows.length) return null;
    if (!Number.isInteger(session.currentRow) || session.currentRow < 0 || session.currentRow >= rows.length) return null;
    if (!Number.isFinite(Number(session.challenge.open)) || !Number.isFinite(Number(session.targetPerHour))) return null;
    if (!Number.isFinite(Number(settings.openingWip)) || !Number.isFinite(Number(settings.targetPerHour)) || !Number.isFinite(Number(settings.duration))) return null;
    if (!/^\d{2}:\d{2}$/.test(settings.shiftStart) || !/^\d{2}:\d{2}$/.test(settings.shiftEnd) || settings.shiftEnd <= settings.shiftStart) return null;
    if (rows.some(row => !row || typeof row.l !== 'string' || !['m', 'b', 'load', 'qc', 'fn'].every(key => Number.isFinite(Number(row[key]))))) return null;
    const answerFields = ['tl', 'tgt', 'bal'];
    if (session.entries.some(entry => !entry || answerFields.some(field => entry[field] !== null && !Number.isFinite(Number(entry[field]))))) return null;
    if (session.answers.some(answer => !answer || answerFields.some(field => !Number.isFinite(Number(answer[field]))))) return null;
    if (session.started && !session.finished && !Number.isFinite(Number(session.endsAt)) && !Number.isFinite(Number(session.remainingSeconds))) return null;

    const mainSnapshot = saved.mainSnapshot;
    const validMainSnapshot = Boolean(
      mainSnapshot?.state && Array.isArray(mainSnapshot.state.rows) && mainSnapshot.state.rows.length &&
      Array.isArray(mainSnapshot.activeScenarios) &&
      Number.isFinite(Number(mainSnapshot.shiftStart)) && Number.isFinite(Number(mainSnapshot.shiftEnd)) &&
      Number.isFinite(Number(mainSnapshot.targetPerHour)) && Number.isFinite(Number(mainSnapshot.valueSliderLimit)) &&
      Number.isInteger(mainSnapshot.lessonRow) && Number.isInteger(mainSnapshot.lessonStep) &&
      mainSnapshot.selection && typeof mainSnapshot.selection.c === 'string'
    );
    return {
      session,
      settings,
      isOpen: Boolean(saved.isOpen && validMainSnapshot),
      mainSnapshot: validMainSnapshot ? mainSnapshot : null
    };
  } catch {
    return null;
  }
}

function saveGameSession() {
  if (!gameSession || !gameSettings) return;
  try {
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify({
      version: 1,
      isOpen: gameIsOpen,
      mainSnapshot: gameIsOpen ? gameSnapshot : null,
      settings: gameSettings,
      session: gameSession
    }));
  } catch {}
}

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

function periodDuration(label) {
  const [start, end] = label.split('-').map(time => {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
  });
  return end - start;
}

function distributeBaseTargets(rows, targetPerHour) {
  let workedMinutes = 0;
  let previousTarget = 0;
  rows.forEach(row => {
    workedMinutes += N(row.m);
    const cumulativeTarget = Math.round(targetPerHour * workedMinutes / 60);
    row.b = cumulativeTarget - previousTarget;
    previousTarget = cumulativeTarget;
  });
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
    const label = `${clockValue(activeStart)}-${clockValue(activeEnd)}`;
    const previous = previousRows.get(label) || {};
    const requestedMinutes = Number.isFinite(Number(previous.m)) ? Number(previous.m) : SHIFT_MINUTES[hour - 8];
    const minutes = Math.min(Math.max(0, requestedMinutes), activeEnd - activeStart);
    rows.push({
      l: label,
      m: minutes,
      b: 0,
      load: N(previous.load),
      loadEntered: previous.loadEntered ?? true,
      qc: N(previous.qc),
      fn: N(previous.fn),
      qcEntered: Boolean(previous.qcEntered),
      fnEntered: Boolean(previous.fnEntered)
    });
  }

  distributeBaseTargets(rows, targetPerHour);
  return { open: N(source.open), rows };
}

function currentShiftData(source) {
  return makeShiftData(source, clockValue(pickerMinutes(shiftStartPicker)), clockValue(pickerMinutes(shiftEndPicker)), N($('#targetPerHour').value));
}

function initialShiftData() {
  const initialData = { ...DEF, rows: DEF.rows.map(row => ({ ...row, load: 0, loadEntered: false, qcEntered: false, fnEntered: false })) };
  return currentShiftData(initialData);
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
    const loadGap = i === 0 ? target * 1.25 - bal : (target - bal) * 1.25;
    const tl = Math.round(Math.max(0, loadGap));
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
  const t = window.WIP_I18N.t;
  $('#setRows').innerHTML = S.rows.map((row, i) => `<tr><td>${row.l}</td><td><input class="schedule-minute-input" type="number" min="0" max="${periodDuration(row.l)}" step="1" value="${N(row.m)}" data-schedule-minute="${i}" aria-label="${t('schedule.minutesFor', { period: row.l })}"></td><td>${f(row.b)}</td></tr>`).join('');
  syncScheduleTable();
  $('#lessonPeriod').innerHTML = S.rows.map((r, i) => `<option value="${i}">${r.l}</option>`).join('');
  lessonRow = Math.min(lessonRow, S.rows.length - 1);
  $('#lessonPeriod').value = String(lessonRow);
}
function syncScheduleTable() {
  const minutesTotal = S.rows.reduce((total, row) => total + N(row.m), 0);
  const baseTotal = S.rows.reduce((total, row) => total + N(row.b), 0);
  S.rows.forEach((row, i) => {
    const input = $(`input[data-schedule-minute="${i}"]`);
    if (input) {
      input.max = String(periodDuration(row.l));
      input.setAttribute('aria-label', window.WIP_I18N.t('schedule.minutesFor', { period: row.l }));
      if (document.activeElement !== input) input.value = String(N(row.m));
    }
    const baseCell = $('#setRows').rows[i]?.cells[2];
    if (baseCell) baseCell.textContent = f(row.b);
  });
  $('#setMinutesTotal').textContent = f(minutesTotal);
  $('#setBaseTotal').textContent = f(baseTotal);
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
      description: t(lessonRow === 0 ? 'lesson.loadDescFirst' : 'lesson.loadDesc'),
      calculation: t(lessonRow === 0 ? 'lesson.loadCalcFirst' : 'lesson.loadCalc', { target: f(x.target), balance: f(x.balBefore), load: f(x.tl) })
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
  if (gameIsOpen && gameSession) { renderGameBoard(); return; }
  const R = calc();
  syncScheduleTable();
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
function renderFormulaTarget(R) {
  const live = $('#formulaTargetLive');
  if (!live) return;
  const t = window.WIP_I18N.t;
  const rowIndex = sel.c === 'tgt' && sel.i >= 0 ? sel.i : Math.max(0, Math.min(lessonRow, R.rows.length - 1));
  const x = R.rows[rowIndex], row = S.rows[rowIndex];
  const options = S.rows.map((item, index) => `<option value="${index}"${index === rowIndex ? ' selected' : ''}>${item.l}</option>`).join('');
  const extraFormula = x.remain > 0
    ? `round(${f(x.shortfall)} × ${f(x.m)} ÷ ${f(x.remain)}) = round(${f(x.raw)}) = ${f(x.extra)}`
    : t('lesson.noTime');
  live.innerHTML = `<label for="formulaTargetPeriod">${t('formula.tgt.period')}<select id="formulaTargetPeriod">${options}</select></label>
    <p><b>${t('schedule.baseTarget')} ${row.l}:</b> ${f(x.b)}</p>
    <p><b>${t('formula.tgt.baseBefore')}:</b> ${f(x.cumBBefore)}</p>
    <p><b>${t('formula.tgt.qcBefore')}:</b> ${f(x.cumQBefore)}</p>
    <p><b>${t('formula.tgt.shortfall')}:</b> max(0, ${f(x.cumBBefore)} − ${f(x.cumQBefore)}) = ${f(x.shortfall)}</p>
    <p><b>${t('formula.tgt.extra')}:</b> ${extraFormula}</p>
    <p><b>${t('formula.tgt.result')}:</b> ${f(x.b)} + ${f(x.extra)} = ${f(x.target)}</p>`;
}
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
  renderFormulaTarget(R);
  $('#side').scrollTop = 0;
}
function explain(R, i, c) {
  const t = window.WIP_I18N.t;
  if (i === -1) return explainSum(R, c);
  const x = R.rows[i], r = S.rows[i], lab = r.l;
  const head = `<h2>${t('metric.' + c)}</h2><div class="sub"><span class="tag">${t('explain.rowTag', { period: lab })}</span></div>`;
  if (c === 'tl') {
    const first = i === 0;
    const targetWip = first ? x.target * 1.25 : x.target;
    const gap = Math.max(0, targetWip - x.balBefore);
    const formula = first
      ? `${t('metric.tl')} = round( max(0, 1.25 × ${t('metric.tgt')} − ${t('common.openingWip')}) )`
      : `${t('metric.tl')} = round( max(0, ${t('metric.tgt')} − ${t('explain.balanceBefore')}) × 1.25 )`;
    const calculation = first
      ? `${t('explain.balanceBefore')} = ${f(x.balBefore)} ${t('explain.opening')}
${t('explain.hourlyTarget')} = ${f(x.target)}
1.25 × ${f(x.target)} = ${f(targetWip)}
max(0, ${f(targetWip)} − ${f(x.balBefore)}) = ${f(gap)}
${f(gap)} → ${t('explain.roundedLoad')} = ${f(x.tl)}`
      : `${t('explain.balanceBefore')} = ${f(x.balBefore)} ${t('explain.previousRow')}
${t('explain.hourlyTarget')} = ${f(x.target)}
max(0, ${f(x.target)} − ${f(x.balBefore)}) = ${f(gap)}
${f(gap)} × 1.25 = ${f(gap * 1.25)} → ${t('explain.roundedLoad')} = ${f(x.tl)}`;
    return head + `<div class="formula">${formula}</div>
    <div class="calc">${calculation}</div>
    <div class="why">${t(first ? 'explain.tlFirstWhy' : 'explain.tlWhy')}</div>
    ${x.tl === 0 ? `<div class="note">${t(first ? 'explain.tlFirstNote' : 'explain.tlNote')}</div>` : ''}`;
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
    <div class="why">${t('explain.qcGreen')}<br>${t('explain.qcInput')}</div>`;
  }
  if (c === 'bal') {
    return head + `<div class="formula">${t('metric.bal')} = ${t('explain.balanceBefore')} + ${t('metric.load')} − ${t('metric.qc')}</div>
    <div class="calc">${f(x.balBefore)} + ${f(x.load)} − ${f(x.qc)} = ${f(x.bal)}</div>
    <div class="why">${t('explain.balanceWhy')}</div>`;
  }
  if (c === 'fn') {
    return head + `<div class="formula">${t('metric.fn')} = period_fn_qty<br>${t('explain.qcArrow')} = Σ${t('metric.fn')} − Σ${t('metric.tgt')}</div>
    <div class="calc">${t('metric.fn')} = ${f(x.fn)} | Σ${t('metric.fn')} = ${f(x.cumF)} | Σ${t('metric.tgt')} = ${f(x.cumT)}<br>${t('metric.fn')} − ${t('metric.tgt')} = ${f(x.fnDiff)}</div>
    <div class="why">${t('explain.fnGreen')}<br>${t('explain.fnSeparate')}</div>`;
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
  if (t.matches('input[data-schedule-minute]')) {
    const rowIndex = Number(t.dataset.scheduleMinute);
    const maxMinutes = periodDuration(S.rows[rowIndex].l);
    const minutes = Math.min(maxMinutes, Math.max(0, Math.round(N(t.value))));
    t.value = String(minutes);
    S.rows[rowIndex].m = minutes;
    distributeBaseTargets(S.rows, N($('#targetPerHour').value));
    clearScenarioSelectionForManualEdit();
    update();
    return;
  }
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
document.addEventListener('change', e => {
  if (e.target.id !== 'formulaTargetPeriod') return;
  lessonRow = Number(e.target.value);
  sel = { i: lessonRow, c: 'tgt' };
  update();
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
  if (gameIsOpen) return;
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
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  setPickerMinutes(shiftStartPicker, 8 * 60);
  setPickerMinutes(shiftEndPicker, 17 * 60);
  $('#targetPerHour').value = '75';
  $('#displayAllHours').checked = false;
  valueSliderLimit = 200;
  $('#valueSliderMaxSetting').value = String(valueSliderLimit);
  $('#shiftStart').setAttribute('aria-invalid', 'false');
  $('#shiftEnd').setAttribute('aria-invalid', 'false');
  $('#shiftError').hidden = true;
  demoSnapshot = null;
  activeScenarios.clear();
  activeScenarios.add('bAllZero');
  S = initialShiftData();
  scenarioBase = JSON.parse(JSON.stringify(S));
  sel = { i: 0, c: 'tgt' };
  lessonRow = 0;
  lessonStep = 1;
  build();
  applyScenarioSelection();
};
$('#bSave').onclick = () => {
  const button = $('#bSave');
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      state: S,
      settings: {
        shiftStart: pickerMinutes(shiftStartPicker),
        shiftEnd: pickerMinutes(shiftEndPicker),
        targetPerHour: N($('#targetPerHour').value),
        displayAllHours: $('#displayAllHours').checked,
        valueSliderLimit
      }
    }));
    button.textContent = window.WIP_I18N.t('button.saved');
  } catch {
    button.textContent = window.WIP_I18N.t('button.saveFailed');
  }
  clearTimeout(saveFeedbackTimer);
  saveFeedbackTimer = setTimeout(() => { button.textContent = window.WIP_I18N.t('button.save'); }, 1500);
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
const savedSnapshot = readSavedSnapshot();
if (savedSnapshot) {
  setPickerMinutes(shiftStartPicker, savedSnapshot.settings.shiftStart);
  setPickerMinutes(shiftEndPicker, savedSnapshot.settings.shiftEnd);
  $('#targetPerHour').value = String(savedSnapshot.settings.targetPerHour);
  $('#displayAllHours').checked = savedSnapshot.settings.displayAllHours;
  valueSliderLimit = savedSnapshot.settings.valueSliderLimit;
  $('#valueSliderMaxSetting').value = String(valueSliderLimit);
  S = savedSnapshot.state;
  scenarioBase = JSON.parse(JSON.stringify(S));
  activeScenarios.clear();
} else {
  S = initialShiftData();
  scenarioBase = JSON.parse(JSON.stringify(S));
}
build();
if (savedSnapshot) {
  updateScenarioButtons();
  update();
} else {
  applyScenarioSelection();
}
const tableCard = $('.tblcard');
const sidePanel = $('#side');
const settingsPanel = $('.settings-panel');
const tableToolbar = $('.side-actions');
const sideToolbar = $('.side-toolbar');
const syncSideHeight = () => {
  const tableCardHeight = tableCard.getBoundingClientRect().height;
  const toolbarHeightDifference = tableToolbar.getBoundingClientRect().height - sideToolbar.getBoundingClientRect().height;
  sidePanel.style.height = `${Math.max(0, tableCardHeight + toolbarHeightDifference)}px`;
  const sideRect = sidePanel.getBoundingClientRect();
  settingsPanel.style.width = `${sideRect.width}px`;
};
if ('ResizeObserver' in window) {
  const sideHeightObserver = new ResizeObserver(syncSideHeight);
  sideHeightObserver.observe(tableCard);
  sideHeightObserver.observe(tableToolbar);
  sideHeightObserver.observe(sideToolbar);
  sideHeightObserver.observe(sidePanel);
} else {
  window.addEventListener('resize', syncSideHeight);
}
syncSideHeight();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function createGameChallenge(settings) {
  const [startHour, startMinute] = settings.shiftStart.split(':').map(Number);
  const [endHour, endMinute] = settings.shiftEnd.split(':').map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const open = settings.openingWip;
  const targetPerHour = settings.targetPerHour;
  const challenge = makeShiftData({ open, rows: [] }, clockValue(start), clockValue(end), targetPerHour);
  let runningWip = open;
  challenge.rows.forEach(row => {
    const maxLoad = Math.max(15, Math.round(targetPerHour * 1.35));
    row.load = randomInt(Math.min(maxLoad, Math.max(15, Math.round(targetPerHour * 0.45))), maxLoad);
    const available = runningWip + row.load;
    row.qc = randomInt(Math.max(0, Math.round(targetPerHour * 0.2)), Math.min(available, Math.round(targetPerHour * 1.15)));
    row.fn = randomInt(0, Math.round(targetPerHour * 1.25));
    row.loadEntered = row.qcEntered = row.fnEntered = true;
    runningWip = available - row.qc;
  });
  return { challenge, start, end, targetPerHour };
}
function gameText(key, values) {
  return window.WIP_I18N.t(key, values);
}
function gameDurationSeconds() {
  return gameSettings.duration * 60;
}
function formatGameClock(seconds) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}
function updateGameFacts() {
  if (!gameSession) return;
  const { challenge, start, end, targetPerHour } = gameSession;
  const startText = clockValue(start), endText = clockValue(end);
  $('#gameFacts').innerHTML = [
    ['settings.wip', `${f(challenge.open)} ${gameText('common.pieces')}`],
    ['settings.hourlyTarget', `${f(targetPerHour)} ${gameText('common.pieces')}`],
    ['settings.shiftStart', startText],
    ['settings.shiftEnd', endText]
  ].map(([label, value]) => `<div class="game-fact"><span>${gameText(label)}</span><strong>${value}</strong></div>`).join('');
  $('#gameRoundLabel').textContent = gameText('game.periodCount', { count: challenge.rows.length });
}
function gameFieldInput(rowIndex, field, value, locked, explainable = false) {
  const valueText = value === null ? '' : String(value);
  const lockAttribute = explainable ? 'readonly aria-haspopup="dialog"' : locked ? 'disabled' : '';
  return `<input class="game-answer-input" type="number" min="0" step="1" inputmode="numeric" data-game-field="${field}" data-game-row="${rowIndex}" aria-label="${gameText(`metric.${field === 'tl' ? 'tl' : field === 'tgt' ? 'tgt' : 'bal'}`)} ${gameText('common.row')} ${rowIndex + 1}" placeholder="?" value="${valueText}" ${lockAttribute}>`;
}
function updateGameSummary() {
  const visibleCount = gameSession.finished ? gameSession.entries.length : gameSession.currentRow + 1;
  const visibleEntries = gameSession.entries.slice(0, visibleCount);
  const sumField = field => {
    const values = visibleEntries.map(entry => entry[field]).filter(value => value !== null);
    return values.length ? f(values.reduce((sum, value) => sum + value, 0)) : '—';
  };
  cells['-1_tl'].textContent = sumField('tl');
  cells['-1_tgt'].textContent = sumField('tgt');
  const lastBalance = [...visibleEntries].reverse().find(entry => entry.bal !== null);
  cells['-1_bal'].textContent = lastBalance ? f(lastBalance.bal) : '—';
  ['load', 'qc', 'fn'].forEach(field => {
    const total = S.rows.slice(0, visibleCount).reduce((sum, row) => sum + N(row[field]), 0);
    cells[`-1_${field}`].textContent = f(total);
  });
}
function updateGameProgress() {
  let answered = 0;
  const totalAnswers = gameSession.entries.length * 3;
  gameSession.entries.forEach(entry => {
    ['tl', 'tgt', 'bal'].forEach(field => { if (entry[field] !== null) answered++; });
  });
  $('#gameProgress').style.width = `${totalAnswers ? answered / totalAnswers * 100 : 0}%`;
  $('#gameProgressText').textContent = `${answered} / ${totalAnswers}`;
  $('#tbl').tFoot.hidden = false;
}
function advanceGameHourWhenComplete() {
  const currentEntry = gameSession.entries[gameSession.currentRow];
  if (!['tl', 'tgt', 'bal'].every(field => currentEntry[field] !== null)) return false;
  if (gameSession.currentRow === gameSession.entries.length - 1) {
    $('#gameStatus').textContent = gameText('game.allComplete');
    return false;
  }
  gameSession.currentRow++;
  renderGameBoard();
  $(`input[data-game-row="${gameSession.currentRow}"][data-game-field="tl"]`)?.focus({ preventScroll: true });
  return true;
}
function commitGameAnswer(input) {
  if (!gameSession || !gameSession.started || gameSession.finished) return false;
  const row = Number(input.dataset.gameRow), field = input.dataset.gameField;
  const value = input.value === '' ? null : Math.max(0, Math.round(N(input.value)));
  gameSession.entries[row][field] = value;
  input.value = value === null ? '' : String(value);
  updateGameSummary();
  const advanced = advanceGameHourWhenComplete();
  if (!advanced) updateGameProgress();
  saveGameSession();
  return advanced;
}
function renderGameBoard() {
  if (!gameSession) return;
  const result = calc();
  const locked = !gameSession.started || gameSession.finished;
  result.rows.forEach((row, index) => {
    const entry = gameSession.entries[index];
    const unrevealed = !gameSession.finished && index > gameSession.currentRow;
    const rowElement = cells[`${index}_tl`]?.parentElement;
    if (rowElement) {
      rowElement.hidden = false;
      rowElement.classList.toggle('game-row-unrevealed', unrevealed);
      rowElement.inert = false;
      rowElement.setAttribute('aria-hidden', 'false');
    }
    const output = {
      tl: row.tl,
      tgt: row.target,
      bal: row.bal,
      load: row.load,
      qc: row.qc,
      fn: row.fn
    };
    ['tl', 'tgt', 'bal', 'load', 'qc', 'fn'].forEach(field => {
      const cell = cells[`${index}_${field}`];
      if (!cell) return;
      if (unrevealed) {
        cell.replaceChildren();
        return;
      }
      if (field === 'tl' || field === 'tgt' || field === 'bal') {
        const answer = gameSession.answers[index][field];
        let feedback = '';
        let inputClass = '';
        if (gameSession.finished) {
          const difference = Math.abs((entry[field] ?? NaN) - answer);
          const grade = difference === 0 ? 'is-correct' : difference <= 1 ? 'is-close' : 'is-wrong';
          inputClass = difference === 0 ? 'game-correct' : difference <= 1 ? 'game-close' : 'game-wrong';
          feedback = `<small class="game-answer-feedback ${grade}">${gameText(difference === 0 ? 'game.correct' : difference <= 1 ? 'game.close' : 'game.answer', { answer: f(answer) })}</small>`;
        }
        const explainable = gameSession.finished;
        cell.innerHTML = gameFieldInput(index, field, entry[field], locked || index !== gameSession.currentRow, explainable).replace('game-answer-input"', `game-answer-input ${inputClass}"`) + feedback;
      } else {
        cell.innerHTML = `<span class="game-given">${f(output[field])}</span>`;
      }
    });
  });
  updateGameSummary();
  updateGameProgress();
  updateGameFacts();
}
function refreshGameTimer() {
  if (!gameSession || !gameSession.started || gameSession.finished) return;
  const remaining = Math.max(0, Math.ceil((gameSession.endsAt - Date.now()) / 1000));
  gameSession.remainingSeconds = remaining;
  $('#gameTimer').textContent = formatGameClock(remaining);
  $('#gameTimer').classList.toggle('is-urgent', remaining <= 30);
  if (remaining === 0) finishGame();
}
function startGame() {
  if (!gameSession || gameSession.finished) return;
  const seconds = gameDurationSeconds();
  gameSession.started = true;
  gameSession.remainingSeconds = seconds;
  $('#gameStart').hidden = true;
  $('#gameFinish').hidden = false;
  $('#gameSettingsOpen').disabled = true;
  $('#gameStatus').textContent = gameText('game.playing');
  renderGameBoard();
  resumeGameTimer();
}
function resumeGameTimer() {
  if (!gameSession?.started || gameSession.finished) return;
  if (!gameSession.endsAt) {
    const remaining = Math.max(0, Math.ceil(gameSession.remainingSeconds ?? gameDurationSeconds()));
    gameSession.endsAt = Date.now() + remaining * 1000;
  }
  refreshGameTimer();
  if (!gameSession.finished && !gameTimerId) gameTimerId = setInterval(refreshGameTimer, 250);
  saveGameSession();
}
function finishGame() {
  if (!gameSession || gameSession.finished) return;
  gameSession.finished = true;
  gameSession.started = true;
  gameSession.remainingSeconds = Math.max(0, Math.ceil((gameSession.endsAt - Date.now()) / 1000));
  gameSession.endsAt = null;
  gameSession.currentRow = gameSession.entries.length - 1;
  clearInterval(gameTimerId);
  gameTimerId = null;
  let points = 0;
  const total = gameSession.entries.length * 3;
  gameSession.entries.forEach((entry, index) => {
    ['tl', 'tgt', 'bal'].forEach(field => {
      const difference = Math.abs((entry[field] ?? NaN) - gameSession.answers[index][field]);
      if (difference === 0) points += 1;
      else if (difference <= 1) points += 0.5;
    });
  });
  const maxPoints = total;
  const accuracy = total ? Math.round(points / maxPoints * 100) : 0;
  const rank = accuracy >= 90 ? 'game.rankTop' : accuracy >= 70 ? 'game.rankGood' : accuracy >= 45 ? 'game.rankWarm' : 'game.rankTry';
  $('#gameTimer').textContent = formatGameClock(gameSession.remainingSeconds);
  $('#gameTimer').classList.remove('is-urgent');
  $('#gameStatus').textContent = gameText('game.done');
  $('#gameStart').hidden = true;
  $('#gameFinish').hidden = true;
  $('#gameSettingsOpen').disabled = false;
  gameSession.result = { points, maxPoints, accuracy, rank };
  if (gameIsOpen) {
    renderGameResult();
    renderGameBoard();
  }
  saveGameSession();
}
function renderGameResult() {
  if (!gameSession?.result) return;
  const { points, maxPoints, accuracy, rank } = gameSession.result;
  $('#gameResult').innerHTML = `<div class="game-result-score">${f(points)}<small> / ${maxPoints}</small></div><div class="game-result-copy"><strong>${gameText(rank)}</strong><span>${gameText('game.resultSummary', { accuracy })}</span></div><button id="gameReplay" class="game-primary-button" type="button">${gameText('game.replay')}</button>`;
  $('#gameResult').hidden = false;
  $('#gameReplay').addEventListener('click', createGameSession);
}
function createGameSession() {
  const generated = createGameChallenge(gameSettings);
  S = generated.challenge;
  gameSession = {
    ...generated,
    started: false,
    finished: false,
    remainingSeconds: gameDurationSeconds(),
    currentRow: 0,
    entries: S.rows.map(() => ({ tl: null, tgt: null, bal: null })),
    answers: []
  };
  gameSession.answers = calc().rows.map(row => ({ tl: row.tl, tgt: row.target, bal: row.bal }));
  $('#gameResult').hidden = true;
  $('#gameResult').innerHTML = '';
  $('#gameSettingsOpen').disabled = false;
  $('#gameTimer').textContent = formatGameClock(gameDurationSeconds());
  $('#gameTimer').classList.remove('is-urgent');
  $('#gameStart').hidden = false;
  $('#gameFinish').hidden = true;
  $('#gameStatus').textContent = gameText('game.ready');
  build();
  renderGameBoard();
  saveGameSession();
}
function openGame() {
  if (gameIsOpen) return;
  if (!gameSnapshot) gameSnapshot = captureMainSnapshot();
  if (!gameSession) {
    gameSettings = {
      openingWip: N(S.open),
      targetPerHour: Math.max(1, N($('#targetPerHour').value)),
      shiftStart: clockValue(pickerMinutes(shiftStartPicker)),
      shiftEnd: clockValue(pickerMinutes(shiftEndPicker)),
      duration: 5
    };
  }
  gameIsOpen = true;
  $('header').hidden = true;
  $('.wrap').hidden = true;
  $('.lower').hidden = true;
  $('#gameScreen').hidden = false;
  $('#gameTableSlot').appendChild(tableCard);
  if (!gameSession) {
    createGameSession();
    $('#gameStart').focus();
    return;
  }
  S = gameSession.challenge;
  build();
  $('#gameStart').hidden = gameSession.started || gameSession.finished;
  $('#gameFinish').hidden = !gameSession.started || gameSession.finished;
  $('#gameSettingsOpen').disabled = gameSession.started && !gameSession.finished;
  $('#gameResult').hidden = !gameSession.finished;
  if (gameSession.finished) renderGameResult();
  renderGameBoard();
  if (gameSession.started && !gameSession.finished) resumeGameTimer();
  saveGameSession();
}
function captureMainSnapshot() {
  return {
    state: JSON.parse(JSON.stringify(S)),
    scenarioBase: JSON.parse(JSON.stringify(scenarioBase)),
    activeScenarios: [...activeScenarios],
    demoSnapshot: demoSnapshot ? JSON.parse(JSON.stringify(demoSnapshot)) : null,
    shiftStart: pickerMinutes(shiftStartPicker),
    shiftEnd: pickerMinutes(shiftEndPicker),
    targetPerHour: $('#targetPerHour').value,
    displayAllHours: $('#displayAllHours').checked,
    valueSliderLimit,
    lowerHidden: $('.lower').hidden,
    lessonRow,
    lessonStep,
    selection: { ...sel }
  };
}
function restoreMainSnapshot(snapshot) {
  S = snapshot.state;
  scenarioBase = snapshot.scenarioBase;
  activeScenarios.clear();
  snapshot.activeScenarios.forEach(id => activeScenarios.add(id));
  demoSnapshot = snapshot.demoSnapshot;
  setPickerMinutes(shiftStartPicker, snapshot.shiftStart);
  setPickerMinutes(shiftEndPicker, snapshot.shiftEnd);
  $('#targetPerHour').value = snapshot.targetPerHour;
  $('#displayAllHours').checked = snapshot.displayAllHours;
  valueSliderLimit = snapshot.valueSliderLimit;
  $('#valueSliderMaxSetting').value = String(valueSliderLimit);
  $('.lower').hidden = snapshot.lowerHidden ?? true;
  lessonRow = snapshot.lessonRow;
  lessonStep = snapshot.lessonStep;
  sel = snapshot.selection;
}
function closeGame() {
  if (!gameIsOpen) return;
  gameIsOpen = false;
  $('#gameScreen').hidden = true;
  $('.table-column').appendChild(tableCard);
  $('header').hidden = false;
  $('.wrap').hidden = false;
  if (gameSnapshot) {
    restoreMainSnapshot(gameSnapshot);
  } else {
    $('.lower').hidden = true;
  }
  gameSnapshot = null;
  tableCard.classList.remove('game-table-card');
  build();
  updateScenarioButtons();
  update();
  $('#bGame').focus();
  saveGameSession();
}
$('#bGame').addEventListener('click', openGame);
$('#gameExit').addEventListener('click', closeGame);
$('#gameStart').addEventListener('click', startGame);
$('#gameFinish').addEventListener('click', finishGame);
function openGameSettings() {
  if (!gameSession || gameSession.started && !gameSession.finished) return;
  $('#gameOpeningWip').value = String(gameSettings.openingWip);
  $('#gameTargetPerHour').value = String(gameSettings.targetPerHour);
  $('#gameShiftStart').value = gameSettings.shiftStart;
  $('#gameShiftEnd').value = gameSettings.shiftEnd;
  $('#gameDurationSetting').value = String(gameSettings.duration);
  $('#gameSettingsError').hidden = true;
  $('#gameSettingsDialog').showModal();
}
$('#gameSettingsOpen').addEventListener('click', openGameSettings);
$('#gameSettingsClose').addEventListener('click', () => $('#gameSettingsDialog').close());
$('#gameSettingsCancel').addEventListener('click', () => $('#gameSettingsDialog').close());
$('#gameSettingsForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const start = $('#gameShiftStart').value;
  const end = $('#gameShiftEnd').value;
  if (end <= start) {
    $('#gameSettingsError').hidden = false;
    $('#gameShiftEnd').focus();
    return;
  }
  gameSettings = {
    openingWip: Math.round(N($('#gameOpeningWip').value)),
    targetPerHour: Math.round(N($('#gameTargetPerHour').value)),
    shiftStart: start,
    shiftEnd: end,
    duration: Math.round(N($('#gameDurationSetting').value))
  };
  $('#gameSettingsDialog').close();
  createGameSession();
});
document.addEventListener('input', event => {
  const input = event.target.closest('input[data-game-field]');
  if (!input || !gameSession || !gameSession.started || gameSession.finished) return;
  const row = Number(input.dataset.gameRow), field = input.dataset.gameField;
  gameSession.entries[row][field] = input.value === '' ? null : Math.max(0, Math.round(N(input.value)));
  updateGameSummary();
  updateGameProgress();
  saveGameSession();
});
document.addEventListener('change', event => {
  const input = event.target.closest('input[data-game-field]');
  if (!input || !gameSession || !gameSession.started || gameSession.finished) return;
  commitGameAnswer(input);
});
document.addEventListener('keydown', event => {
  const input = event.target.closest('input[data-game-field]');
  if (input && gameSession?.finished && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openGameAnswerExplanation(input);
    return;
  }
  if (input && event.key === 'Enter' && gameSession?.started && !gameSession.finished) {
    event.preventDefault();
    const row = Number(input.dataset.gameRow), field = input.dataset.gameField;
    const advanced = commitGameAnswer(input);
    if (!advanced && gameSession.currentRow === row) {
      const currentEntry = gameSession.entries[row];
      const nextField = ['tl', 'tgt', 'bal'].find(candidate => currentEntry[candidate] === null);
      if (nextField) $(`input[data-game-row="${row}"][data-game-field="${nextField}"]`)?.focus({ preventScroll: true });
    }
    return;
  }
  if (!gameIsOpen || event.key !== 'Escape') return;
  if ($('#gameAnswerDialog').open || $('#gameSettingsDialog').open) return;
  closeGame();
});
function openGameAnswerExplanation(input) {
  if (!gameSession?.finished || !input.matches('.game-correct, .game-wrong, .game-close')) return;
  const rowIndex = Number(input.dataset.gameRow), field = input.dataset.gameField;
  const row = calc().rows[rowIndex];
  const answer = gameSession.answers[rowIndex][field];
  const userValue = gameSession.entries[rowIndex][field];
  const isCorrect = userValue !== null && userValue === answer;
  let formula, calculation, reason;
  if (field === 'tl') {
    const first = rowIndex === 0;
    formula = gameText(first ? 'game.explain.tlFirst' : 'game.explain.tl');
    const balanceLabel = gameText(first ? 'game.explain.openingWip' : 'game.explain.balanceBefore');
    const gap = Math.max(0, row.target - row.balBefore);
    calculation = first
      ? [
          `${gameText('metric.tgt')}: ${f(row.target)}`,
          `${balanceLabel}: ${f(row.balBefore)}`,
          `${gameText('game.explain.targetWip')}: ${f(row.target)} × 1.25 = ${f(row.target * 1.25)}`,
          `${gameText('metric.tl')}: round(max(0, ${f(row.target * 1.25)} − ${f(row.balBefore)})) = ${f(answer)}`
        ].join('\n')
      : [
          `${gameText('metric.tgt')}: ${f(row.target)}`,
          `${balanceLabel}: ${f(row.balBefore)}`,
          `${gameText('game.explain.gap')}: max(0, ${f(row.target)} − ${f(row.balBefore)}) = ${f(gap)}`,
          `${gameText('metric.tl')}: round(${f(gap)} × 1.25) = ${f(answer)}`
        ].join('\n');
    reason = gameText(first ? 'game.explain.tlFirstWhy' : 'game.explain.tlWhy');
  } else if (field === 'tgt') {
    formula = gameText('game.explain.tgt');
    const period = S.rows[rowIndex].l;
    const extraCalculation = row.remain > 0
      ? gameText('game.explain.extraCalc', {
          shortfall: f(row.shortfall), minutes: f(row.m), remain: f(row.remain), raw: f(row.raw), extra: f(row.extra)
        })
      : gameText('lesson.noTime');
    calculation = [
      `${gameText('game.explain.baseTarget', { period })}: ${f(row.b)}`,
      `${gameText('game.explain.baseBefore')}: ${f(row.cumBBefore)}`,
      `${gameText('game.explain.qcBefore')}: ${f(row.cumQBefore)}`,
      `${gameText('game.explain.shortfall')}: max(0, ${f(row.cumBBefore)} − ${f(row.cumQBefore)}) = ${f(row.shortfall)}`,
      `${gameText('game.explain.extra')}: ${extraCalculation}`,
      `${gameText('metric.tgt')}: ${f(row.b)} + ${f(row.extra)} = ${f(answer)}`
    ].join('\n');
    reason = gameText('game.explain.tgtWhy');
  } else {
    formula = gameText('game.explain.bal');
    const balanceLabel = gameText(rowIndex === 0 ? 'game.explain.openingWip' : 'game.explain.balanceBefore');
    calculation = [
      `${balanceLabel}: ${f(row.balBefore)}`,
      `${gameText('metric.load')}: ${f(row.load)}`,
      `${gameText('metric.qc')}: ${f(row.qc)}`,
      `${gameText('metric.bal')}: ${f(row.balBefore)} + ${f(row.load)} − ${f(row.qc)} = ${f(answer)}`
    ].join('\n');
    reason = gameText('game.explain.balWhy');
  }
  $('#gameAnswerPeriod').textContent = gameText('game.explain.period', { period: S.rows[rowIndex].l });
  $('#gameAnswerTitle').textContent = gameText(`metric.${field}`);
  $('#gameAnswerDetails').innerHTML = `<p class="game-answer-verdict ${isCorrect ? 'is-correct' : 'is-review'}">${gameText(isCorrect ? 'game.explain.correct' : 'game.explain.review')}</p><p class="game-answer-outcome${isCorrect ? ' is-correct' : ''}">${gameText('game.explain.outcome', {
    entered: userValue === null ? gameText('game.explain.blank') : f(userValue), answer: f(answer)
  })}</p><p class="game-answer-formula">${formula}</p><pre class="game-answer-calculation">${calculation}</pre><p class="game-answer-reason">${reason}</p>`;
  $('#gameAnswerDialog').showModal();
}
document.addEventListener('click', event => {
  const input = event.target.closest('input.game-answer-input.game-correct, input.game-answer-input.game-wrong, input.game-answer-input.game-close');
  if (input) openGameAnswerExplanation(input);
});
$('#gameAnswerClose').addEventListener('click', () => $('#gameAnswerDialog').close());

function restoreSavedGame() {
  const saved = readSavedGameState();
  if (!saved) return;
  gameSession = saved.session;
  gameSettings = saved.settings;
  if (saved.isOpen && saved.mainSnapshot) {
    gameSnapshot = saved.mainSnapshot;
    restoreMainSnapshot(gameSnapshot);
    openGame();
  } else if (gameSession.started && !gameSession.finished) {
    resumeGameTimer();
  }
}
window.addEventListener('pagehide', saveGameSession);
restoreSavedGame();