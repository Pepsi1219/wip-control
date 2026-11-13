(() => {
  const SHIFT_MINUTES = [60, 60, 60, 30, 30, 60, 60, 60, 60, 30, 60, 30, 60];

  function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
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
      workedMinutes += number(row.m);
      const cumulativeTarget = Math.round(targetPerHour * workedMinutes / 60);
      row.b = cumulativeTarget - previousTarget;
      previousTarget = cumulativeTarget;
    });
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
        load: number(previous.load),
        loadEntered: previous.loadEntered ?? true,
        qc: number(previous.qc),
        fn: number(previous.fn),
        qcEntered: Boolean(previous.qcEntered),
        fnEntered: Boolean(previous.fnEntered)
      });
    }

    distributeBaseTargets(rows, targetPerHour);
    return { open: number(source.open), rows };
  }

  function calculate(state) {
    const rows = state.rows, count = rows.length;
    const remain = [];
    let remainingMinutes = 0;
    for (let i = count - 1; i >= 0; i--) {
      remainingMinutes += number(rows[i].m);
      remain[i] = remainingMinutes;
    }

    let balance = number(state.open), cumulativeBase = 0, cumulativeQc = 0, cumulativeFn = 0, cumulativeTarget = 0;
    const output = [];
    for (let i = 0; i < count; i++) {
      const row = rows[i];
      const base = number(row.b), load = number(row.load), qc = number(row.qc), fn = number(row.fn), minutes = number(row.m);
      const shortfall = Math.max(0, cumulativeBase - cumulativeQc);
      const rawExtra = remain[i] > 0 ? shortfall * minutes / remain[i] : 0;
      const extra = Math.round(rawExtra);
      const target = base + extra;
      const loadGap = i === 0 ? target * 1.25 - balance : (target - balance) * 1.25;
      const targetLoad = Math.round(Math.max(0, loadGap));
      const balanceBefore = balance;
      balance = balance + load - qc;
      const result = {
        i, b: base, m: minutes, load, qc, fn, shortfall, raw: rawExtra, extra,
        target, tl: targetLoad, balBefore: balanceBefore, bal: balance,
        remain: remain[i], cumBBefore: cumulativeBase, cumQBefore: cumulativeQc
      };
      cumulativeBase += base;
      cumulativeQc += qc;
      cumulativeFn += fn;
      cumulativeTarget += target;
      result.cumQ = cumulativeQc;
      result.cumF = cumulativeFn;
      result.cumT = cumulativeTarget;
      result.qcDiff = cumulativeQc - cumulativeTarget;
      result.fnDiff = cumulativeFn - cumulativeTarget;
      result.loadCls = load < targetLoad ? 'lo' : (load > 1.25 * targetLoad ? 'hi' : '');
      output.push(result);
    }

    const totals = { tl: 0, load: 0, tgt: 0, qc: 0, fn: 0, b: 0, extra: 0 };
    output.forEach(row => {
      totals.tl += row.tl;
      totals.load += row.load;
      totals.tgt += row.target;
      totals.qc += row.qc;
      totals.fn += row.fn;
      totals.b += row.b;
      totals.extra += row.extra;
    });
    totals.bal = balance;
    totals.qcDiff = totals.qc - totals.tgt;
    totals.fnDiff = totals.fn - totals.tgt;
    totals.loadCls = totals.load < totals.tl ? 'lo' : (totals.load > 1.25 * totals.tl ? 'hi' : '');
    return { rows: output, T: totals };
  }

  window.SPF_LOGIC = Object.freeze({ clockValue, periodDuration, distributeBaseTargets, makeShiftData, calculate });
})();