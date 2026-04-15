/** Normalize HH:mm for comparison */
export function normalizeTime(t) {
  if (t == null || t === '') return '';
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  const h = Math.min(23, parseInt(m[1], 10));
  const min = Math.min(59, parseInt(m[2], 10));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Flatten batch schedule to { day, startTime } slots */
export function getScheduleSlots(batch) {
  if (!batch) return [];
  if (batch.schedule?.length) {
    return batch.schedule.map((s) => ({
      day: s.day,
      startTime: normalizeTime(s.startTime)
    }));
  }
  const t = normalizeTime(batch.startTime || '');
  return (batch.days || []).map((day) => ({ day, startTime: t }));
}

export function hasScheduleConflict(batchA, batchB) {
  const a = getScheduleSlots(batchA);
  const b = getScheduleSlots(batchB);
  for (const x of a) {
    for (const y of b) {
      if (x.day === y.day && x.startTime && x.startTime === y.startTime) return true;
    }
  }
  return false;
}
