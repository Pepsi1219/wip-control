const DEF = window.SPF_DEMO_DATA;
let S = JSON.parse(JSON.stringify(DEF));
let scenarioBase = JSON.parse(JSON.stringify(DEF));
const activeScenarios = new Set(['bAllZero']);
let demoSnapshot = null;
let sel = { i: 0, c: 'bal' };
let lessonStep = 0;
let lessonRow = 0;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const f = x => Number(x).toLocaleString('en-US', { maximumFractionDigits: 1 });
const N = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const SHIFT_MINUTES = [60, 60, 60, 30, 30, 60, 60, 60, 60, 30, 60, 30];
const NAME = { tl: 'TARGET LOAD', load: 'ACTUAL LOAD', tgt: 'HOURLY TARGET', qc: 'QC PASS', bal: 'BALANCE WIP', fn: 'SCAN BOX' };
const LESSON_CELLS = ['bal', 'tgt', 'tl', 'load', 'qc', 'bal'];

function makeShiftData(source, start, end, targetPerHour) {
  const previousRows = new Map(source.rows.map(row => [row.l, row]));
  let workedMinutes = 0;
  const startHour = Number(start.slice(0, 2));
  const endHour = Number(end.slice(0, 2));
  const rows = [];

  for (let hour = 8; hour < 20; hour++) {
    if (hour < startHour || hour >= endHour) continue;
    const minutes = SHIFT_MINUTES[hour - 8];
    const previousMinutes = workedMinutes;
    workedMinutes += minutes;
    const label = `${String(hour).padStart(2, '0')}:00-${String(hour + 1).padStart(2, '0')}:00`;
    const previous = previousRows.get(label) || {};
    const baseTarget = Math.round(targetPerHour * workedMinutes / 60) - Math.round(targetPerHour * previousMinutes / 60);
    rows.push({
      l: label,
      m: minutes,
      b: baseTarget,
      load: N(previous.load),
      qc: N(previous.qc),
      fn: N(previous.fn),
      qcEntered: Boolean(previous.qcEntered),
      fnEntered: Boolean(previous.fnEntered)
    });
  }

  return { open: N(source.open), rows };
}

function currentShiftData(source) {
  return makeShiftData(source, $('#shiftStart').value, $('#shiftEnd').value, N($('#targetPerHour').value));
}

function visibleRowCount() {
  if ($('#displayAllHours').checked) return S.rows.length;
  let count = 1;
  while (count < S.rows.length && S.rows[count - 1].qcEntered && S.rows[count - 1].fnEntered) count++;
  return count;
}

function updateShiftSettings() {
  const start = $('#shiftStart').value;
  const end = $('#shiftEnd').value;
  const startHour = Number(start.slice(0, 2));
  const endHour = Number(end.slice(0, 2));
  const valid = /^\d{2}:00$/.test(start) && /^\d{2}:00$/.test(end) && startHour >= 8 && endHour <= 20 && endHour > startHour;
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
  const tb = $('#tb');
  tb.innerHTML = '';
  Object.keys(cells).forEach(key => delete cells[key]);
  S.rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th data-i="${i}">${r.l}</th>
      <td data-i="${i}" data-c="tl"><span></span></td>
      <td data-i="${i}" data-c="load"><div class="cellwrap"><input class="cell w5" type="number" min="0" data-k="load" data-i="${i}"></div></td>
      <td data-i="${i}" data-c="tgt"><span></span></td>
      <td data-i="${i}" data-c="qc"><div class="cellwrap"><input class="cell" type="number" min="0" data-k="qc" data-i="${i}"><small class="diff"></small></div></td>
      <td data-i="${i}" data-c="bal"><span></span></td>
      <td data-i="${i}" data-c="fn"><div class="cellwrap"><input class="cell" type="number" min="0" data-k="fn" data-i="${i}"><small class="diff"></small></div></td>`;
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
      const entered = inp.dataset.k === 'qc' ? r.qcEntered : inp.dataset.k === 'fn' ? r.fnEntered : true;
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
  const x = R.rows[lessonRow], row = S.rows[lessonRow], previous = S.rows[lessonRow - 1];
  const extraFormula = x.remain > 0
    ? `round(${f(x.shortfall)} × ${f(x.m)} ÷ ${f(x.remain)}) = ${f(x.extra)}`
    : '0 (ไม่มีเวลาทำงานเหลือ)';
  const steps = [
    {
      title: 'เริ่มจาก WIP ที่ยกมาจากเมื่อวาน',
      description: lessonRow === 0
        ? 'คาบแรกเริ่มจากจำนวนงานที่ค้างในสายผลิตเมื่อวาน ค่านี้เป็นจุดตั้งต้นของ Balance ในวันนี้'
        : 'คาบนี้เริ่มจาก Balance ที่เหลือหลังจบคาบก่อนหน้า ค่า WIP จะถูกส่งต่อไปทีละคาบ',
      calculation: lessonRow === 0
        ? `งานค้างในสายผลิตเมื่อวาน = ${f(S.open)} ชิ้น\nWIP ก่อน ${row.l} = ${f(x.balBefore)} ชิ้น`
        : `Balance หลัง ${previous.l} = ${f(x.balBefore)} ชิ้น\nWIP ก่อน ${row.l} = ${f(x.balBefore)} ชิ้น`
    },
    {
      title: 'กำหนดเป้าหมายของคาบนี้',
      description: 'เริ่มจากเป้าพื้นฐาน แล้วบวกยอดที่ต้องไล่ตามจากคาบก่อน ๆ ตามเวลาทำงานที่ยังเหลือ ยอดเพิ่มนี้เป็นสูตรจำลองจากข้อมูลตัวอย่าง ไม่ใช่สูตรยืนยันจาก server',
      calculation: `ยอดขาดสะสม = max(0, ${f(x.cumBBefore)} − ${f(x.cumQBefore)}) = ${f(x.shortfall)} ชิ้น\nยอดเพิ่ม = ${extraFormula}\nเป้าพื้นฐาน ${f(x.b)} + ยอดเพิ่ม ${f(x.extra)} = HOURLY TARGET ${f(x.target)} ชิ้น`
    },
    {
      title: 'คำนวณจำนวนงานที่ควรโหลด',
      description: 'นำเป้าของคาบนี้ลบ WIP ที่มีอยู่แล้ว ถ้ายังขาดจึงโหลดเพิ่ม และเผื่ออีก 25% ถ้า WIP มากกว่าเป้า TARGET LOAD จะเป็นศูนย์',
      calculation: `round(max(0, HOURLY TARGET − WIP ก่อนคาบ) × 1.25)\nround(max(0, ${f(x.target)} − ${f(x.balBefore)}) × 1.25) = ${f(x.tl)} ชิ้น`
    },
    {
      title: 'รับจำนวนงานที่โหลดเข้าจริง',
      description: 'ACTUAL LOAD มาจากระบบหลังบ้าน บทเรียนใช้ค่านี้ตามจริงเพื่อจำลองว่างานในสายเพิ่มขึ้นเท่าไร',
      calculation: `ACTUAL LOAD ของ ${row.l} = ${f(x.load)} ชิ้น\nWIP หลังโหลด = ${f(x.balBefore)} + ${f(x.load)} = ${f(x.balBefore + x.load)} ชิ้น`
    },
    {
      title: 'หักงานที่ผ่าน QC',
      description: 'QC PASS คืองานที่ผ่านการตรวจคุณภาพ รวมงานแก้ไขที่กลับมาผ่านแล้ว งานส่วนนี้ออกจาก WIP ในสาย',
      calculation: `QC PASS ของ ${row.l} = ${f(x.qc)} ชิ้น\nงานที่ผ่าน QC จะถูกหักออกจาก WIP`
    },
    {
      title: 'ได้ Balance WIP สำหรับคาบถัดไป',
      description: lessonRow < S.rows.length - 1
        ? 'นำ WIP ก่อนคาบ บวกงานที่โหลดเข้าจริง แล้วหักงานที่ผ่าน QC ค่านี้จะกลายเป็น WIP ตั้งต้นของคาบถัดไป'
        : 'คำนวณ WIP ที่เหลือหลังคาบสุดท้ายของวันนี้',
      calculation: `${f(x.balBefore)} + ${f(x.load)} − ${f(x.qc)} = ${f(x.bal)} ชิ้น\n${lessonRow < S.rows.length - 1 ? `WIP ตั้งต้นของ ${S.rows[lessonRow + 1].l} = ${f(x.bal)} ชิ้น` : `WIP หลัง ${row.l} = ${f(x.bal)} ชิ้น`}`
    }
  ];
  const step = steps[lessonStep];
  $('#lessonProgress').textContent = `ขั้น ${lessonStep + 1} จาก ${steps.length} | คาบ ${row.l}`;
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
    const t = g('tgt'); t.className = x.extra > 0 ? 'warn' : ''; t.firstElementChild.textContent = f(x.target);
    const qi = g('qc').querySelector('input'); qi.className = 'cell ' + (x.qc > x.target ? 'pos' : '');
    const qd = g('qc').querySelector('small'); qd.className = 'diff' + (x.qcDiff > 0 ? ' up' : ''); qd.innerHTML = arrow(x.qcDiff);
    g('bal').firstElementChild.textContent = f(x.bal);
    const fi = g('fn').querySelector('input'); fi.className = 'cell ' + (x.fn > 0 && x.fn >= x.target ? 'pos' : '');
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
  if (i === -1) return explainSum(R, c);
  const x = R.rows[i], r = S.rows[i], lab = r.l;
  const head = `<h2>${NAME[c]}</h2><div class="sub"><span class="tag">แถว ${lab}</span></div>`;
  if (c === 'tl') {
    const gap = Math.max(0, x.target - x.balBefore);
    return head + `<div class="formula">TARGET LOAD = round( max(0, HOURLY TARGET − BALANCE ก่อนหน้า) × 1.25 )</div>
    <div class="calc">BALANCE ก่อนหน้า = ${f(x.balBefore)} ${i === 0 ? '(Opening WIP)' : '(Balance ของแถวบน)'}
HOURLY TARGET   = ${f(x.target)}
max(0, ${f(x.target)} − ${f(x.balBefore)}) = ${f(gap)}
${f(gap)} × 1.25 = ${f(gap * 1.25)}  → ปัด = ${f(x.tl)}</div>
    <div class="why"><b>ทำไมคิดแบบนี้:</b> ถ้างานที่ค้างในสายมากพอสำหรับเป้าชั่วโมงนี้แล้ว ก็ไม่ต้องโหลดเพิ่ม (ได้ 0) ถ้างานค้างไม่พอ ต้องโหลดส่วนที่ขาด และเผื่อไว้อีก 25% กันงานสะดุด</div>
    ${x.tl === 0 ? '<div class="note">ตอนนี้เป็น 0 เพราะ Balance สูงกว่าเป้า ลองกดปุ่ม "LOAD = TARGET" เหนือตาราง แล้วดู ACTUAL LOAD เทียบกับ TARGET LOAD</div>' : ''}`;
  }
  if (c === 'load') {
    const lim = 1.25 * x.tl;
    const why = x.loadCls === 'hi' ? `Load ${f(x.load)} มากกว่า 1.25 × Target Load (${f(lim)}) จึงเป็น <b>สีส้ม</b> คือโหลดมากกว่าที่สายต้องการ` : x.loadCls === 'lo' ? `Load ${f(x.load)} น้อยกว่า Target Load ${f(x.tl)} จึงเป็น <b>สีฟ้า</b> คือโหลดไม่พอ` : 'Load อยู่ในช่วงที่ยอมรับได้ จึงเป็นสีขาว';
    return head + `<div class="formula">ACTUAL LOAD = period_wip_line (server ส่งมา)</div>
    <div class="calc">ค่าปัจจุบัน = ${f(x.load)}
Target Load = ${f(x.tl)}   เกณฑ์สูง = 1.25 × ${f(x.tl)} = ${f(lim)}</div>
    <div class="why">ช่องนี้เป็น <b>ข้อมูลนำเข้า</b> ไม่ได้คำนวณจากช่องอื่น ลองแก้ตัวเลขในช่องได้เลย แล้วดู Balance WIP ของแถวนี้และแถวล่างๆ ขยับตาม<br><br>${why}</div>`;
  }
  if (c === 'tgt') {
    const first = i === 0;
    return head + `<div class="formula">HOURLY TARGET = เป้าพื้นฐาน + ยอดเพิ่ม
ยอดเพิ่ม = ยอดที่ขาดสะสม × นาทีของคาบนี้ ÷ นาทีที่เหลือ (รวมคาบนี้)
ยอดที่ขาดสะสม = max(0, Σเป้าพื้นฐานคาบก่อนหน้า − ΣQC คาบก่อนหน้า)</div>
    <ol class="steps">
      <li>Σ เป้าพื้นฐานคาบก่อนหน้า = <b>${f(x.cumBBefore)}</b></li>
      <li>Σ QC คาบก่อนหน้า = <b>${f(x.cumQBefore)}</b></li>
      <li>ยอดที่ขาดสะสม = max(0, ${f(x.cumBBefore)} − ${f(x.cumQBefore)}) = <b>${f(x.shortfall)}</b></li>
      <li>นาทีคาบนี้ = ${f(x.m)}, นาทีที่เหลือรวมคาบนี้ = ${f(x.remain)}</li>
      <li>ยอดเพิ่ม = ${f(x.shortfall)} × ${f(x.m)} ÷ ${f(x.remain)} = ${x.raw.toFixed(2)} → ปัด = <b>${f(x.extra)}</b></li>
      <li>HOURLY TARGET = ${f(x.b)} + ${f(x.extra)} = <b>${f(x.target)}</b></li>
    </ol>
    <div class="why"><b>ทำไมคิดแบบนี้:</b> ถ้าชั่วโมงก่อนๆ ทำ QC ได้ไม่ถึงเป้า ยอดที่ขาดต้องไปตามให้ทันภายในเวลาที่เหลือ ระบบจึงกระจายยอดที่ขาดตามสัดส่วนนาทีของแต่ละคาบ ยิ่งใกล้สิ้นวัน เวลาเหลือน้อย ยอดเพิ่มยิ่งสูง (เช่น คาบสุดท้ายเป้าพุ่งเป็น 264) ${first ? '<br>แถวแรกยังไม่มีคาบก่อนหน้า จึงไม่มียอดเพิ่ม' : ''}</div>
    `;
  }
  if (c === 'qc') {
    return head + `<div class="formula">QC PASS = QC Pass + Reprocess (period_qc_pass)
ลูกศร = ΣQC สะสม − ΣHourly Target สะสม</div>
    <div class="calc">QC แถวนี้ = ${f(x.qc)}
ΣQC สะสมถึงแถวนี้ = ${f(x.cumQ)}
ΣHourly Target สะสม = ${f(x.cumT)}
ลูกศร = ${f(x.cumQ)} − ${f(x.cumT)} = ${f(x.qcDiff)}</div>
    <div class="why"><b>อ่านลูกศร:</b> ${x.qcDiff < 0 ? `ติดลบ ${f(Math.abs(x.qcDiff))} หมายถึง ณ แถวนี้ QC สะสม <b>ต่ำกว่าเป้าสะสม</b> อยู่ ${f(Math.abs(x.qcDiff))} ชิ้น (สีแดง)` : x.qcDiff > 0 ? `บวก ${f(x.qcDiff)} หมายถึงเกินเป้าสะสม (สีเขียว)` : 'เท่ากับเป้าสะสมพอดี จึงไม่แสดงลูกศร'}<br>ตัวเลขหลักเป็นสีเขียวเมื่อ QC PASS มากกว่า HOURLY TARGET<br><br>ช่องนี้เป็นข้อมูลนำเข้า แก้แล้ว Balance WIP, ยอดเพิ่มของ Hourly Target และลูกศรของแถวล่างทั้งหมดจะขยับ</div>`;
  }
  if (c === 'bal') {
    return head + `<div class="formula">BALANCE WIP = BALANCE ก่อนหน้า + ACTUAL LOAD − QC PASS</div>
    <div class="calc">BALANCE ก่อนหน้า = ${f(x.balBefore)} ${i === 0 ? '(Opening WIP)' : ''}
+ ACTUAL LOAD     = ${f(x.load)}
− QC PASS         = ${f(x.qc)}
= ${f(x.balBefore)} + ${f(x.load)} − ${f(x.qc)} = ${f(x.bal)}</div>
    <div class="why"><b>ทำไมคิดแบบนี้:</b> Balance คืองานที่ค้างอยู่ในสาย งานเพิ่มเมื่อโหลดเข้า และลดลงเมื่อ QC ผ่านออกจากสาย แถวแรกเริ่มนับจากงานที่ค้างมาตั้งแต่เมื่อวาน (Opening WIP) ค่าแถวสุดท้ายจึงเท่ากับงานค้างในสาย ณ ปัจจุบัน</div>`;
  }
  if (c === 'fn') {
    return head + `<div class="formula">SCAN BOX = period_fn_qty (server ส่งมา)
ลูกศร = ΣScan สะสม − ΣHourly Target สะสม</div>
    <div class="calc">Scan แถวนี้ = ${f(x.fn)}
ΣScan สะสม = ${f(x.cumF)}
ΣHourly Target สะสม = ${f(x.cumT)}
ลูกศร = ${f(x.cumF)} − ${f(x.cumT)} = ${f(x.fnDiff)}</div>
    <div class="why">ตัวเลขหลักเป็น<b>สีเขียว</b>เมื่อ Scan ของคาบมากกว่า 0 และถึง Hourly Target ${x.fn > 0 && x.fn >= x.target ? '(ตอนนี้เป็นเขียว)' : '(ตอนนี้ยังไม่ถึง)'}<br>ช่องนี้เป็นข้อมูลนำเข้า และ<b>ไม่ได้</b>ถูกนำไปคิด Balance WIP (Balance ใช้ QC PASS)</div>`;
  }
}
function explainSum(R, c) {
  const T = R.T, head = `<h2>Summary : ${NAME[c]}</h2><div class="sub"><span class="tag">แถวรวม</span></div>`;
  const list = k => R.rows.map(x => f(x[k])).join(' + ');
  if (c === 'tl') return head + `<div class="formula">Σ ทุกแถว</div><div class="calc">${list('tl')} = ${f(T.tl)}</div>`;
  if (c === 'load') return head + `<div class="formula">Σ ACTUAL LOAD ทุกแถว</div><div class="calc">${list('load')} = ${f(T.load)}</div><div class="why">สี: เทียบกับ 1.25 × ΣTarget Load (${f(1.25 * T.tl)}) ตอนนี้${T.loadCls === 'hi' ? 'สูงกว่า จึงเป็นสีส้ม' : T.loadCls === 'lo' ? 'ต่ำกว่า Target Load จึงเป็นสีฟ้า' : 'อยู่ในเกณฑ์'}</div>`;
  if (c === 'tgt') return head + `<div class="formula">Σ HOURLY TARGET ทุกแถว</div><div class="calc">${list('target')} = ${f(T.tgt)}
(เป้าพื้นฐาน ${f(T.b)} + ยอดเพิ่มรวม ${f(T.extra)})</div><div class="why">ยอดเพิ่มรวมคือเป้าที่ต้องตามเพิ่มเพราะ QC ตามหลังเป้าอยู่ ยิ่ง QC ต่ำ ยอดรวมนี้ยิ่งเกินเป้าต่อวันเดิม</div>`;
  if (c === 'qc') return head + `<div class="formula">Σ QC ทุกแถว และลูกศร = ΣQC − ΣHourly Target</div><div class="calc">${list('qc')} = ${f(T.qc)}
${f(T.qc)} − ${f(T.tgt)} = ${f(T.qcDiff)}</div>`;
  if (c === 'bal') return head + `<div class="formula">ใช้ค่า BALANCE ของแถวสุดท้าย (ไม่ได้บวกรวม)</div><div class="calc">= ${f(T.bal)}</div><div class="why">เพราะ Balance เป็นยอดสะสมอยู่แล้ว การบวกรวมทุกแถวจะนับซ้ำ</div>`;
  if (c === 'fn') return head + `<div class="formula">Σ SCAN BOX ทุกแถว และลูกศร = ΣScan − ΣHourly Target</div><div class="calc">${list('fn')} = ${f(T.fn)}
${f(T.fn)} − ${f(T.tgt)} = ${f(T.fnDiff)}</div>`;
}

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'open') { S.open = N(t.value); clearScenarioSelectionForManualEdit(); update(); return; }
  if (t.id === 'targetPerHour') { updateShiftSettings(); return; }
  if (t.dataset && t.dataset.k) {
    S.rows[t.dataset.i][t.dataset.k] = N(t.value);
    if (t.dataset.k === 'qc') S.rows[t.dataset.i].qcEntered = t.value !== '';
    if (t.dataset.k === 'fn') S.rows[t.dataset.i].fnEntered = t.value !== '';
    lessonRow = Number(t.dataset.i);
    $('#lessonPeriod').value = String(lessonRow);
    if (t.closest('td[data-c]')) sel = { i: +t.dataset.i, c: t.closest('td').dataset.c };
    clearScenarioSelectionForManualEdit();
    update();
  }
});
$('#shiftStart').addEventListener('change', updateShiftSettings);
$('#shiftEnd').addEventListener('change', updateShiftSettings);
$('#displayAllHours').addEventListener('change', update);
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
document.addEventListener('focusin', pick);
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
    if (activeScenarios.has('bFnZero')) S.rows.forEach(row => { row.fn = 0; row.fnEntered = true; });
  }
  if (activeScenarios.has('bLoadTarget')) {
    for (let i = 0; i < S.rows.length; i++) {
      S.rows[i].load = calc().rows[i].tl;
    }
  }
  if (activeScenarios.has('bLoadZero')) S.rows.forEach(row => row.load = 0);
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
$('#bRefresh').onclick = () => window.location.reload();
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
const initialData = { ...DEF, rows: DEF.rows.map(row => ({ ...row, qcEntered: false, fnEntered: false })) };
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
  settingsPanel.style.height = `${sideRect.height}px`;
};
if ('ResizeObserver' in window) {
  const sideHeightObserver = new ResizeObserver(syncSideHeight);
  sideHeightObserver.observe(tableCard);
} else {
  window.addEventListener('resize', syncSideHeight);
}
syncSideHeight();