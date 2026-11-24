// Turns a Google Calendar iCal feed into the events that fall inside a time window.
// Each event comes back shaped like a Google Calendar API event:
//   { summary, start: { date } | { dateTime }, end: { date } | { dateTime } }
// Recurring events are expanded, cancelled ones and EXDATEs are dropped, moved occurrences use their new time.
export function makeExpander(ICAL) {
  const DAY = 864e5;
  const dateMs = t => Date.UTC(t.year, t.month - 1, t.day);
  const dateStr = t => t.year + '-' + String(t.month).padStart(2, '0') + '-' + String(t.day).padStart(2, '0');

  return function expandIcs(text, from, to, max = 400) {
    const root = new ICAL.Component(ICAL.parse(text));
    for (const tz of root.getAllSubcomponents('vtimezone')) {
      try { ICAL.TimezoneService.register(tz); } catch (_) { /* an odd zone should not stop the rest */ }
    }
    const masters = new Map(), exceptions = [];
    let n = 0;
    for (const v of root.getAllSubcomponents('vevent')) {
      const uid = v.getFirstPropertyValue('uid') || 'no-uid-' + n++;
      if (v.hasProperty('recurrence-id')) exceptions.push([uid, v]);
      else masters.set(uid, new ICAL.Event(v));
    }
    for (const [uid, v] of exceptions) {
      const m = masters.get(uid);
      if (m && m.isRecurring()) { try { m.relateException(v); continue; } catch (_) { /* fall through */ } }
      masters.set(uid + '#' + String(v.getFirstPropertyValue('recurrence-id')), new ICAL.Event(v));
    }

    const fromMs = from.getTime(), toMs = to.getTime(), out = [];
    const add = (item, start, end) => {
      if (String(item.component.getFirstPropertyValue('status') || '').toLowerCase() === 'cancelled') return;
      const summary = String(item.summary || 'Untitled event').trim();
      if (start.isDate) {
        const s = dateMs(start), e = end && end.isDate && dateMs(end) > s ? dateMs(end) : s + DAY;
        // all-day dates have no zone; allow a day of slack, the app filters by calendar date
        if (s < toMs + DAY && e > fromMs - DAY) {
          const endT = end && end.isDate && dateMs(end) > s ? end : null;
          out.push({ summary, start: { date: dateStr(start) }, end: { date: endT ? dateStr(endT) : new Date(s + DAY).toISOString().slice(0, 10) } });
        }
        return;
      }
      const s = start.toJSDate().getTime(), e = end ? end.toJSDate().getTime() : s;
      if (s < toMs && Math.max(e, s + 1) > fromMs) {
        out.push({ summary, start: { dateTime: new Date(s).toISOString() }, end: { dateTime: new Date(Math.max(e, s)).toISOString() } });
      }
    };

    for (const ev of masters.values()) {
      if (out.length >= max) break;
      if (!ev.isRecurring()) { add(ev, ev.startDate, ev.endDate); continue; }
      const it = ev.iterator();
      let t, guard = 0;
      while ((t = it.next()) && guard++ < 20000) {
        const ms = t.isDate ? dateMs(t) : t.toJSDate().getTime();
        if (ms >= toMs + DAY) break;
        const d = ev.getOccurrenceDetails(t);
        add(d.item, d.startDate, d.endDate);
        if (out.length >= max) break;
      }
    }
    return out.sort((a, b) => (a.start.dateTime || a.start.date) < (b.start.dateTime || b.start.date) ? -1 : 1);
  };
}
