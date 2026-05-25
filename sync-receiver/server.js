// ═══════════════════════════════════════════════════════════════════
//  AIECOS Social CRM — Sync Receiver v1.5
//  Receives data from Chrome extension "AIECOS Pancake Connector"
//  POST /api/sync with header X-AIECOS-Token
//  Supports BATCH format (recommended) và SINGLE format (legacy)
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const PORT = process.env.PORT || 3500;
const API_TOKEN = process.env.API_TOKEN || 'CHANGE_ME_IN_ENV';

const SUPA_URL = process.env.SUPABASE_URL || 'http://supabase-kong:8000';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPA_SCHEMA = process.env.SUPABASE_SCHEMA || 'aiecos_social';

if (!SUPA_KEY) {
  console.error('[FATAL] SUPABASE_SERVICE_KEY env var is required');
  process.exit(1);
}
if (API_TOKEN === 'CHANGE_ME_IN_ENV') {
  console.warn('[WARN] API_TOKEN is default — set a strong token in production');
}

const supabase = createClient(SUPA_URL, SUPA_KEY, {
  db: { schema: SUPA_SCHEMA },
  auth: { autoRefreshToken: false, persistSession: false },
});

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── CORS ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'X-AIECOS-Token, Content-Type, Authorization, apikey, Prefer');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── Auth middleware ──
function auth(req, res, next) {
  const token = req.headers['x-aiecos-token'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (token !== API_TOKEN) {
    console.warn(`[AUTH] Invalid token from ${req.ip} on ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Public health check ──
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    service: 'aiecos-social-crm-sync',
    version: '1.5.0',
    schema: SUPA_SCHEMA,
    uptime: process.uptime(),
  });
});

// ── Channels (pages) ──
app.post('/api/channel/register', auth, async (req, res) => {
  try {
    const { page_id, page_name, channel } = req.body || {};
    if (!page_id) return res.status(400).json({ error: 'page_id required' });
    const { error } = await supabase.from('pages').upsert({
      id: page_id, name: page_name || page_id, type: channel || 'facebook',
      is_active: true, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/channels', auth, async (req, res) => {
  try {
    const { data } = await supabase.from('pages').select('*').order('name');
    res.json({ channels: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helpers ──
function extractThreadId(url) {
  if (!url) return '';
  const mZ = url.match(/pzl_(\d+)/);
  if (mZ) return 'pzl_' + mZ[1];
  const mF = url.match(/[?&](?:selected_item_id=|thread_id=)?(\d{10,})/);
  if (mF) return 'fb_' + mF[1];
  const mA = url.match(/(\d{8,})/);
  if (mA) return 'id_' + mA[1];
  return '';
}

function parseThreadType(threadId, channel) {
  if (channel) return channel;
  if (!threadId) return 'unknown';
  if (threadId.startsWith('pzl_')) return 'zalo';
  if (threadId.startsWith('fb_')) return 'facebook';
  return 'other';
}

async function processOneMessage(msg, ctx) {
  const { page_name, channel, ten_khach, url } = ctx;
  const threadId = msg.thread_id || extractThreadId(url) || ctx.thread_id;
  if (!threadId) throw new Error('No thread_id derived');

  const content = msg.content || msg.tin_nhan || '';
  if (!content || content.trim().length === 0) throw new Error('Empty content');

  const senderType = msg.sender_type || 'customer';
  const senderName = msg.sender_name || ten_khach || 'unknown';
  const ts = msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString();

  const channelType = parseThreadType(threadId, channel);
  const pageId = (page_name || channelType || 'unknown').toString().slice(0, 200);

  // conversation_id = page + customer slug (Pancake URL doesn't change per conversation)
  function slugify(s) {
    return (s || 'unknown').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  }
  const customerSlug = slugify(ten_khach);
  const conversationId = customerSlug && customerSlug !== 'unknown'
    ? `${pageId}__${customerSlug}`
    : threadId;

  // Dedup priority:
  //  1. pancake_msg_id (unique từ Pancake/Zalo, stable) — extension v4.6+
  //  2. fallback sha1 hash của (conv|sender|content|ts|name)
  let msgHash;
  if (msg.pancake_msg_id && typeof msg.pancake_msg_id === 'string') {
    msgHash = crypto.createHash('sha1').update('pmid:' + msg.pancake_msg_id).digest('hex').substring(0, 16);
  } else {
    msgHash = crypto.createHash('sha1')
      .update(`${conversationId}|${senderType}|${content}|${ts}|${senderName}`)
      .digest('hex').substring(0, 16);
  }

  // 1. Upsert page (preserve real name)
  const isIdLikeName = /^(pzl_|fb_|id_)/.test(page_name || '');
  const pageUpsert = {
    id: pageId, type: channelType,
    is_active: true, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  if (!isIdLikeName) pageUpsert.name = page_name || pageId;
  const { data: existing } = await supabase.from('pages').select('name').eq('id', pageId).maybeSingle();
  if (!existing || !existing.name || existing.name === pageId || /^(pzl_|fb_|id_)/.test(existing.name)) {
    pageUpsert.name = page_name || pageId;
  }
  await supabase.from('pages').upsert(pageUpsert, { onConflict: 'id' });

  // 2. Upsert customer (only for customer messages)
  let customerId = null;
  if (ten_khach && senderType === 'customer') {
    const custKey = `${pageId}_${ten_khach}`.slice(0, 200);
    await supabase.from('customers').upsert({
      id: custKey, name: ten_khach, page_id: pageId, last_seen_at: ts,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    customerId = custKey;
  }

  // 3. Upsert conversation
  await supabase.from('conversations').upsert({
    id: conversationId, page_id: pageId, customer_id: customerId,
    customer_name: ten_khach || null,
    snippet: content.substring(0, 200), updated_at: ts,
  }, { onConflict: 'id' });

  // 4. Upsert message
  const { error: msgErr } = await supabase.from('messages').upsert({
    id: msgHash, conversation_id: conversationId, page_id: pageId,
    sender_name: senderName, sender_type: senderType, content,
    created_time: ts, synced_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (msgErr && msgErr.code !== '23505' && !(msgErr.message || '').toLowerCase().includes('duplicate')) {
    throw msgErr;
  }

  return { msg_hash: msgHash, conversation_id: conversationId, deduped: !!msgErr };
}

// ── Main /api/sync — supports both batch & single ──
app.post('/api/sync', auth, async (req, res) => {
  try {
    const p = req.body || {};

    // BATCH format (recommended): { messages: [...] }
    if (Array.isArray(p.messages) && p.messages.length > 0) {
      const ctx = {
        page_name: p.page_name, channel: p.channel,
        ten_khach: p.ten_khach, url: p.url, thread_id: p.thread_id,
      };
      let inserted = 0, deduped = 0, failed = 0;
      const errors = [];
      for (const msg of p.messages) {
        try {
          const r = await processOneMessage(msg, ctx);
          if (r.deduped) deduped++; else inserted++;
        } catch (e) {
          failed++;
          errors.push({ content: (msg.content || '').slice(0, 30), error: e.message });
        }
      }
      console.log(`[SYNC] BATCH ${p.page_name || 'unknown'}: total=${p.messages.length} inserted=${inserted} deduped=${deduped} failed=${failed}`);
      return res.json({ success: true, total: p.messages.length, inserted, deduped, failed, errors: errors.slice(0, 5) });
    }

    // SINGLE format (legacy): { tin_nhan: "...", ... }
    if (p.tin_nhan || p.content) {
      const ctx = {
        page_name: p.page_name, channel: p.channel,
        ten_khach: p.ten_khach, url: p.url, thread_id: p.thread_id,
      };
      const msg = {
        sender_name: p.sender_name, sender_type: p.sender_type,
        content: p.tin_nhan || p.content, timestamp: p.timestamp, thread_id: p.thread_id,
        pancake_msg_id: p.pancake_msg_id,
      };
      const r = await processOneMessage(msg, ctx);
      console.log(`[SYNC] SINGLE ${p.page_name || 'unknown'}: ${r.deduped ? 'deduped' : 'inserted'} ${r.msg_hash}`);
      return res.json({ success: true, inserted: r.deduped ? 0 : 1, deduped: r.deduped ? 1 : 0, msg_hash: r.msg_hash });
    }

    return res.status(400).json({ error: 'Invalid payload: missing messages[] or tin_nhan', received_keys: Object.keys(p) });
  } catch (err) {
    console.error('[SYNC] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Refresh pages.total_conversations + total_messages from actual aggregate
app.post('/api/admin/refresh-aggregates', auth, async (req, res) => {
  try {
    const { data: pages } = await supabase.from('pages').select('id');
    let updated = 0;
    for (const p of (pages || [])) {
      const { count: cConv } = await supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('page_id', p.id);
      const { count: cMsg } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('page_id', p.id);
      await supabase.from('pages').update({
        total_conversations: cConv || 0,
        total_messages: cMsg || 0,
        updated_at: new Date().toISOString(),
      }).eq('id', p.id);
      updated++;
    }
    res.json({ success: true, pages_updated: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use((req, res) => {
  console.log(`[UNHANDLED] ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Periodic aggregate refresh every 60s
setInterval(async () => {
  try {
    const { data: pages } = await supabase.from('pages').select('id');
    for (const p of (pages || [])) {
      const { count: cConv } = await supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('page_id', p.id);
      const { count: cMsg } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('page_id', p.id);
      await supabase.from('pages').update({
        total_conversations: cConv || 0,
        total_messages: cMsg || 0,
      }).eq('id', p.id);
    }
  } catch (e) { console.error('[AGG] error:', e.message); }
}, 60000);

app.listen(PORT, () => {
  console.log(`[AIECOS-SYNC v1.5] Listening on :${PORT}`);
  console.log(`[AIECOS-SYNC] Supabase: ${SUPA_URL} schema=${SUPA_SCHEMA}`);
  console.log(`[AIECOS-SYNC] API token: ${API_TOKEN.substring(0, 6)}...${API_TOKEN.slice(-4)}`);
});
