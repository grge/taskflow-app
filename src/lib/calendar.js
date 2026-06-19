export function getDaySchedule(date, schedule) {
  const dow = date.getDay();
  const day = schedule.days.find(d => d.dayOfWeek === dow);
  return day?.enabled ? day : null;
}

export function advanceToWorkTime(cursor, schedule) {
  const result = new Date(cursor);
  let iterations = 0;

  while (iterations++ < 14) {
    const day = getDaySchedule(result, schedule);
    if (!day) {
      result.setDate(result.getDate() + 1);
      result.setHours(0, 0, 0, 0);
      continue;
    }

    const minutes = result.getHours() * 60 + result.getMinutes();
    if (minutes < day.startMinutes) {
      result.setHours(0, day.startMinutes, 0, 0);
      return result;
    }
    if (minutes >= day.endMinutes) {
      result.setDate(result.getDate() + 1);
      result.setHours(0, 0, 0, 0);
      continue;
    }
    return result;
  }

  return result;
}

export function advanceWork(startTime, durationMinutes, schedule) {
  const currentTime = new Date(startTime);
  let remainingMinutes = durationMinutes;

  let safety = 0;
  while (remainingMinutes > 0 && safety++ < 1000) {
    const daySchedule = getDaySchedule(currentTime, schedule);

    if (!daySchedule) {
      currentTime.setDate(currentTime.getDate() + 1);
      currentTime.setHours(0, 0, 0, 0);
      continue;
    }

    const currentMinute = currentTime.getHours() * 60 + currentTime.getMinutes();

    if (currentMinute < daySchedule.startMinutes) {
      currentTime.setHours(0, daySchedule.startMinutes, 0, 0);
      continue;
    }

    if (currentMinute >= daySchedule.endMinutes) {
      currentTime.setDate(currentTime.getDate() + 1);
      currentTime.setHours(0, 0, 0, 0);
      continue;
    }

    const availableToday = daySchedule.endMinutes - currentMinute;
    const toConsume = Math.min(remainingMinutes, availableToday);
    currentTime.setMinutes(currentTime.getMinutes() + toConsume);
    remainingMinutes -= toConsume;
  }

  return currentTime;
}

export function nextWorkDayStart(from, schedule) {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);

  let safety = 0;
  while (!getDaySchedule(next, schedule) && safety++ < 14) {
    next.setDate(next.getDate() + 1);
  }

  const day = getDaySchedule(next, schedule);
  next.setHours(0, day.startMinutes, 0, 0);
  return next;
}

export function getVisibleWorkDays(schedule, nDays = 7, fromDate = null) {
  const result = [];
  const cursor = fromDate ? new Date(fromDate) : new Date();
  cursor.setHours(0, 0, 0, 0);
  let safety = 0;

  while (result.length < nDays && safety++ < 60) {
    const day = getDaySchedule(cursor, schedule);
    if (day) {
      result.push({ date: new Date(cursor), daySchedule: day });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

// Walk backwards through work time by durationMinutes from startTime.
// Mirror of advanceWork — skips non-work periods in reverse.
export function retreatWork(startTime, durationMinutes, schedule) {
  const currentTime = new Date(startTime);
  let remainingMinutes = durationMinutes;

  let safety = 0;
  while (remainingMinutes > 0 && safety++ < 1000) {
    const daySchedule = getDaySchedule(currentTime, schedule);

    if (!daySchedule) {
      // Not a work day — jump to end of previous day and re-evaluate
      currentTime.setDate(currentTime.getDate() - 1);
      currentTime.setHours(23, 59, 0, 0);
      continue;
    }

    const currentMinute = currentTime.getHours() * 60 + currentTime.getMinutes();

    if (currentMinute > daySchedule.endMinutes) {
      // After work ends — clamp to end of day
      currentTime.setHours(0, daySchedule.endMinutes, 0, 0);
      continue;
    }

    if (currentMinute <= daySchedule.startMinutes) {
      // At or before work starts — jump to end of previous work day
      currentTime.setDate(currentTime.getDate() - 1);
      currentTime.setHours(23, 59, 0, 0);
      continue;
    }

    // Inside work hours — consume what's available back to start of day
    const availableToday = currentMinute - daySchedule.startMinutes;
    const toConsume = Math.min(remainingMinutes, availableToday);
    currentTime.setMinutes(currentTime.getMinutes() - toConsume);
    remainingMinutes -= toConsume;
  }

  return currentTime;
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function minutesToTimeString(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m === 0 ? `${displayH}${suffix}` : `${displayH}:${String(m).padStart(2, '0')}${suffix}`;
}

export function formatDateLabel(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  const shortDate = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  if (d.getTime() === today.getTime()) return { label: 'Today', short: shortDate };
  if (d.getTime() === tomorrow.getTime()) return { label: 'Tomorrow', short: shortDate };

  // Next week or later — show "Next week" for Mon-Sun block after tomorrow
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays <= 7) {
    return { label: date.toLocaleDateString('en-US', { weekday: 'long' }), short: shortDate };
  }

  return { label: 'Next week', short: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '+' };
}
