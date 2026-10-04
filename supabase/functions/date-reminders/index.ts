import webpush from 'npm:web-push@3.6.7';

const base = Deno.env.get('SUPABASE_URL')!;
const namedSecret = Deno.env.get('SUPABASE_SECRET_KEYS');
const key = namedSecret ? JSON.parse(namedSecret).default : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!base || !key) throw new Error('Supabase backend credentials unavailable');
const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: key };
if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;

async function db(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`Database request failed (${response.status}): ${await response.text()}`);
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

type Reminder = { delivery_id: string; subscription_id: string; schedule_id: string; asset_id: string;
  endpoint: string; p256dh: string; auth: string; due_date: string; lead_days: number;
  asset_name: string; service_title: string };

function allowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && (
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com' ||
      url.hostname === 'push.apple.com' || url.hostname.endsWith('.push.apple.com')
    );
  } catch { return false; }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const provided = request.headers.get('x-costrig-cron');
  if (!provided) return new Response('Unauthorized', { status: 401 });
  try {
    const expected = await db('rpc/costrig_push_secret', { method: 'POST', body: JSON.stringify({ secret_name: 'costrig_push_cron_token' }) });
    if (!expected || provided !== expected) return new Response('Unauthorized', { status: 401 });
    const privateKey = await db('rpc/costrig_push_secret', { method: 'POST', body: JSON.stringify({ secret_name: 'costrig_vapid_private' }) });
    const publicKey = 'BAo212SU7esYQmSk_61ldG3TXNBEMZ7dQxh-R-zuxPpKjArmTw2PrStEOjGyz75Pzw_NfuLWPcUDD-Q06V3dsi0';
    if (!privateKey || !publicKey) throw new Error('VAPID credentials unavailable');
    webpush.setVapidDetails('https://gcfd8hy5mb-ai.github.io', publicKey, privateKey);
    const reminders = await db('rpc/claim_due_date_reminders', { method: 'POST', body: '{}' }) as Reminder[];
    let sent = 0, failed = 0;
    for (const item of reminders) {
      if (!allowedPushEndpoint(item.endpoint)) {
        await db(`date_push_deliveries?id=eq.${item.delivery_id}`, { method: 'DELETE' });
        failed++;
        continue;
      }
      const when = item.lead_days === 7 ? 'in 7 days' : item.lead_days === 1 ? 'tomorrow' : 'today';
      const payload = JSON.stringify({
        title: `${item.service_title} ${when}`,
        body: `${item.asset_name} · Due ${item.due_date}`,
        assetId: item.asset_id,
        scheduleId: item.schedule_id
      });
      try {
        await webpush.sendNotification({ endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } }, payload, { TTL: 86400 });
        await db(`date_push_deliveries?id=eq.${item.delivery_id}`, { method: 'PATCH', body: JSON.stringify({ sent_at: new Date().toISOString() }) });
        sent++;
      } catch (error) {
        const code = (error as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db(`push_subscriptions?id=eq.${item.subscription_id}`, { method: 'DELETE' });
        else await db(`date_push_deliveries?id=eq.${item.delivery_id}`, { method: 'DELETE' });
        failed++;
      }
    }
    return Response.json({ sent, failed });
  } catch (error) {
    console.error('Date reminder run failed:', error instanceof Error ? error.message : String(error));
    return Response.json({ error: 'Reminder processing failed' }, { status: 500 });
  }
});
