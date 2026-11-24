// deno-lint-ignore-file no-explicit-any
// One Hub server function.
//  - The database runs it every minute (x-cron-secret header) to send assignment reminders as push notifications.
//  - The signed-in app calls it to connect Google Calendar, read calendar events, and send a test notification.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import ICAL from 'npm:ical.js@1.5.0';
import { makeExpander } from './ics.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class Fail { constructor(public code: string, public status = 400) {} }

function serviceKey(): string {
  const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (k) return k;
  try {
    const s = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const v = s.default || Object.values(s)[0];
    if (v) return String(v);
  } catch (_) { /* fall through */ }
  return Deno.env.get('HUB_SERVICE_KEY') || '';
}
const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const VAPID_PUBLIC = Deno.env.get('HUB_VAPID_PUBLIC') || '';
const VAPID_PRIVATE = Deno.env.get('HUB_VAPID_PRIVATE') || '';
const SITE = Deno.env.get('HUB_SITE_URL') || 'https://mr-sacid.github.io/OneHub/';
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(SITE, VAPID_PUBLIC, VAPID_PRIVATE);
const expandIcs = makeExpander(ICAL);

function sameSecret(a: string | null, b: string | undefined) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- push ---------- */
async function sendPush(s: any, payload: Record<string, unknown>) {
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(payload),
      { TTL: 6 * 3600, urgency: 'high' },
    );
    return 'ok';
  } catch (e: any) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) {
      await admin.from('hub_push_subs').delete().eq('user_id', s.user_id).eq('endpoint', s.endpoint);
      return 'gone';
    }
    console.error('push failed', e && e.statusCode, e && e.message);
    return 'failed';
  }
}

function reminderBody(d: any) {
  const parts: string[] = [];
  if (d.due) {
    const dt = new Date(d.due + 'T12:00:00Z');
    if (!isNaN(dt.getTime())) parts.push('Due ' + dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
  }
  if (d.course) parts.push(String(d.course));
  return parts.join(' · ') || 'Reminder from One Hub';
}

async function sendDueReminders() {
  const now = new Date(), since = new Date(now.getTime() - 30 * 60_000);
  const { data: rows, error } = await admin.from('hub_docs').select('user_id,id,data').eq('col', 'tasks')
    .gte('data->>remindAt', since.toISOString()).lte('data->>remindAt', now.toISOString());
  if (error) throw error;
  const due = (rows || []).filter((r: any) => r.data && r.data.status !== 'done');
  let sent = 0;
  if (due.length) {
    // claim each reminder first, so two overlapping runs never send it twice
    const { data: claimed, error: e2 } = await admin.from('hub_reminders_sent')
      .upsert(due.map((r: any) => ({ user_id: r.user_id, task_id: r.id, remind_at: r.data.remindAt })),
        { onConflict: 'user_id,task_id,remind_at', ignoreDuplicates: true })
      .select('user_id,task_id,remind_at');
    if (e2) throw e2;
    const fresh = new Set((claimed || []).map((c: any) => c.user_id + '|' + c.task_id + '|' + c.remind_at));
    const todo = due.filter((r: any) => fresh.has(r.user_id + '|' + r.id + '|' + r.data.remindAt));
    const users = [...new Set(todo.map((r: any) => r.user_id))];
    const subs = users.length
      ? ((await admin.from('hub_push_subs').select('user_id,endpoint,p256dh,auth').in('user_id', users)).data || [])
      : [];
    for (const r of todo as any[]) {
      for (const s of subs.filter((s: any) => s.user_id === r.user_id)) {
        const res = await sendPush(s, { title: r.data.title || 'Assignment', body: reminderBody(r.data), tag: 'task-' + r.id, url: './#study' });
        if (res === 'ok') sent++;
      }
    }
  }
  await admin.from('hub_reminders_sent').delete().lt('sent_at', new Date(now.getTime() - 30 * 864e5).toISOString());
  return { due: due.length, sent };
}

/* ---------- calendar (Google secret iCal address) ---------- */
const icsCache = new Map<string, { text: string; at: number }>();
function validIcs(u: string) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === 'calendar.google.com' &&
      x.pathname.startsWith('/calendar/ical/') && x.pathname.endsWith('.ics');
  } catch (_) { return false; }
}
async function fetchIcs(uid: string, url: string, fresh: boolean) {
  const c = icsCache.get(uid);
  if (!fresh && c && Date.now() - c.at < 60_000) return c.text;
  let r: Response;
  try { r = await fetch(url, { headers: { 'User-Agent': 'OneHub/1.0' } }); } catch (_) { throw new Fail('calendar_unavailable', 502); }
  if ([401, 403, 404, 410].includes(r.status)) throw new Fail('ics_gone', 410);
  if (!r.ok) throw new Fail('calendar_unavailable', 502);
  const text = await r.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Fail('ics_gone', 410);
  icsCache.set(uid, { text, at: Date.now() });
  return text;
}
async function icsUrlFor(uid: string) {
  const { data, error } = await admin.from('hub_private').select('ics_url').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return (data && data.ics_url) || '';
}

/* ---------- health check (cron secret only; sends nothing) ---------- */
async function healthCheck() {
  const out: Record<string, unknown> = { serviceKey: !!serviceKey(), vapid: !!(VAPID_PUBLIC && VAPID_PRIVATE) };
  for (const t of ['hub_docs', 'hub_push_subs', 'hub_private', 'hub_reminders_sent']) {
    const { error } = await admin.from(t).select('*', { count: 'exact', head: true });
    out[t] = error ? error.message : 'ok';
  }
  try {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const b64u = (a: Uint8Array) => btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const det = webpush.generateRequestDetails(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/selfcheck', keys: { p256dh: b64u(raw), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } },
      'selfcheck',
    );
    out.push = det && det.headers && det.headers.Authorization ? 'ok' : 'no headers';
  } catch (e: any) { out.push = 'error: ' + (e && e.message); }
  try { out.ical = expandIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20260101T100000Z\r\nDTEND:20260101T110000Z\r\nSUMMARY:t\r\nEND:VEVENT\r\nEND:VCALENDAR', new Date('2025-12-31'), new Date('2026-01-02')).length === 1 ? 'ok' : 'wrong'; }
  catch (e: any) { out.ical = 'error: ' + (e && e.message); }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body: any = await req.json().catch(() => ({}));
    const cron = req.headers.get('x-cron-secret');
    if (cron !== null) {
      if (!sameSecret(cron, Deno.env.get('HUB_CRON_SECRET'))) return json({ error: 'forbidden' }, 403);
      return json(body && body.check ? await healthCheck() : await sendDueReminders());
    }

    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who, error: authErr } = jwt ? await admin.auth.getUser(jwt) : { data: null, error: true };
    if (authErr || !who || !who.user) return json({ error: 'not_signed_in' }, 401);
    const uid = who.user.id;

    switch (body.action) {
      case 'calStatus':
        return json({ linked: !!(await icsUrlFor(uid)) });
      case 'calLink': {
        const url = String(body.url || '').trim();
        if (!validIcs(url)) throw new Fail('bad_url');
        await fetchIcs(uid, url, true);
        const { error } = await admin.from('hub_private').upsert({ user_id: uid, ics_url: url, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json({ linked: true });
      }
      case 'calUnlink': {
        icsCache.delete(uid);
        const { error } = await admin.from('hub_private').upsert({ user_id: uid, ics_url: null, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json({ linked: false });
      }
      case 'events': {
        const from = new Date(body.timeMin), to = new Date(body.timeMax);
        if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 62 * 864e5) throw new Fail('bad_range');
        const url = await icsUrlFor(uid);
        if (!url) throw new Fail('not_linked', 409);
        const text = await fetchIcs(uid, url, !!body.fresh);
        return json({ events: expandIcs(text, from, to) });
      }
      case 'testPush': {
        const { data: subs } = await admin.from('hub_push_subs').select('user_id,endpoint,p256dh,auth').eq('user_id', uid);
        let sent = 0;
        for (const s of subs || []) {
          if (await sendPush(s, { title: 'One Hub', body: 'Notifications are working. Reminders will arrive like this.', tag: 'test', url: './' }) === 'ok') sent++;
        }
        return json({ sent, devices: (subs || []).length });
      }
      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e: any) {
    if (e instanceof Fail) return json({ error: e.code }, e.status);
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
});
