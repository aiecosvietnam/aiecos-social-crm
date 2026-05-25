// ═══════════════════════════════════════════════════════════════════
//  AIECOS Social CRM — Sync Receiver v1.6
//  Production-grade: helmet + rate-limit + morgan + graceful shutdown
//
//  POST /api/sync with header X-AIECOS-Token
//  Supports BATCH format (recommended) and SINGLE format (legacy)
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const crypto = require('crypto');

// ── Config ──
const PORT = parseInt(process.env.PORT || '3500', 10);
const API_TOKEN = process.env.API_TOKEN || 'CHANGE_ME_IN_ENV';
const SUPA_URL = process.env.SUPABASE_URL || 'http://supabase-kong:8000';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPA_SCHEMA = process.env.SUPABASE_SCHEMA || 'aiecos_social';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const RATE_WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS || '60000', 10);
const RATE_MAX = parseInt(process.env.RATE_MAX || '300', 10);
const VERSION = '1.6.0';
const STARTED_AT = Date.now();

// ── Fail fast on misconfig ──
if (!SUPA_KEY) {
  console.error('[FATAL] SUPABASE_SERVICE_KEY env var is required');
  process.exit(1);
}
if (API_TOKEN === 'CHANGE_ME_IN_ENV') {
  console.warn('[WARN] API_TOKEN is default — generate one: openssl rand -hex 32');
}
if (API_TOKEN.length < 16) {
  console.warn('[WARN] API_TOKEN is short — recommend 32+ chars');
}

const supabase = createClient(SUPA_URL, SUPA_KEY, {
  db: { schema: SUPA_SCHEMA },
  auth: { autoRefreshToken: false, persistSession: false },
});

const app = express();
app.set('trust proxy', 1); // for X-Forwarded-For (Cloudflare/nginx)

// ── Security middleware ──
app.use(helmet({
  contentSecurityPolicy: false, // POST-only API, no HTML
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── Request logging (skip /api/status to keep logs clean) ──
app.use(morgan(':method :url :status :res[content-length] - :response-time ms', {
  skip: (req) => req.path === '/api/status',
}));

app.use(express.json({ limit: '10mb' }));

// ── CORS ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'X-AIECOS-Token, Content-Type, Authorization, apikey, Prefer');
  res.header('X-Service', `aiecos-sync/${VERSION}`);
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── Rate limiter on sync endpoint ──
const syncLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
  keyGenerator: (req) => req.ip + ':' + (req.headers['x-aiecos-token'] || '').slice(0, 8),
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

// ── Public health check (enhanced) ──
app.get('/api/status', async (req, res) => {
  const status = {
    status: 'online',
    service: 'aiecos-social-crm-sync',
    version: VERSION,
    schema: SUPA_SCHEMA,
    uptime_seconds: Math.round((Date.now() - STARTED_AT) / 1000),
    node_version: process.version,
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    db: 'unknown',
  };
  try {
    // Ping DB with lightweight query
    const t0 = Date.now();
    const { error } = await supabase.from('pages').select('id', { count: 'exact', head: true });
    status.db = error ? 'error' : 'ok';
    status.db_latency_ms = Date.now() - t0;
    if (error) status.db_error = error.message?.slice(0, 100);
  } catch (e) { status.db = 'error'; status.db_error = e.message?.slice(0, 100); }
  res.json(status);
});

// ── Channels (pages) ──
app.post('/api/channel/register', auth, async (req, res) => {
  try {
    const { page_id, page_name, channel } = req.body || {};
    if (!page_id) return res.status(400).json({ error: 'page_id required' });
    if (typeof page_id !== 'string' || page_id.length > 200) return res.status(400).json({ error: 'invalid page_id' });
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

// ── Input validation ──
function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') return 'invalid message object';
  const content = msg.content || msg.tin_nhan;
  if (!content || typeof content !== 'string') return 'content required';
  if (content.length > 5000) return 'content too long (max 5000)';
  if (msg.sender_type && !['customer', 'agent', 'system', 'bot'].includes(msg.sender_type)) return 'invalid sender_type';
  return null;
}

async function processOneMessage(msg, ctx) {
  const { page_name, channel, ten_khach, url } = ctx;
  const threadId = msg.thread_id || extractThreadId(url) || ctx.thread_id;
  if (!threadId) throw new Error('No thread_id derived');

  const content = msg.content || msg.tin_nhan || '';
  if (!content || content.trim().length === 0) throw new Error('Empty content');

  const senderType = msg.sender_type || 'customer';
  const senderName = (msg.sender_name || ten_khach || 'unknown').slice(0, 200);
  const ts = msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString();

  const channelType = parseThreadType(threadId, channel);
  const pageId = (page_name || channelType || 'unknown').toString().slice(0, 200);

  function slugify(s) {
    return (s || 'unknown').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  }
  const customerSlug = slugify(ten_khach);
  const conversationId = customerSlug && customerSlug !== 'unknown'
    ? `${pageId}__${customerSlug}`
    : threadId;

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

// ── Main /api/sync (rate-limited) ──
app.post('/api/sync', syncLimiter, auth, async (req, res) => {
  try {
    const p = req.body || {};

    // BATCH format
    if (Array.isArray(p.messages) && p.messages.length > 0) {
      if (p.messages.length > 200) return res.status(400).json({ error: 'batch too large (max 200)' });

      const ctx = {
        page_name: p.page_name, channel: p.channel,
        ten_khach: p.ten_khach, url: p.url, thread_id: p.thread_id,
      };
      let inserted = 0, deduped = 0, failed = 0;
      const errors = [];
      for (const msg of p.messages) {
        const valErr = validateMessage(msg);
        if (valErr) { failed++; errors.push({ error: valErr }); continue; }
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

    // SINGLE format
    if (p.tin_nhan || p.content) {
      const valErr = validateMessage(p);
      if (valErr) return res.status(400).json({ error: valErr });
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

// ── Prometheus-compatible /metrics ──
let _metricsCache = { ts: 0, data: null };
app.get('/metrics', async (req, res) => {
  // Cache 30s to avoid hammering DB
  if (Date.now() - _metricsCache.ts < 30000 && _metricsCache.data) {
    res.set('Content-Type', 'text/plain').send(_metricsCache.data);
    return;
  }
  try {
    const [{ count: cMsg }, { count: cCust }, { count: cConv }, { count: cPage }] = await Promise.all([
      supabase.from('messages').select('*', { count: 'exact', head: true }),
      supabase.from('customers').select('*', { count: 'exact', head: true }),
      supabase.from('conversations').select('*', { count: 'exact', head: true }),
      supabase.from('pages').select('*', { count: 'exact', head: true }),
    ]);
    const mem = process.memoryUsage();
    const out = `# HELP aiecos_total_messages Total messages in DB
# TYPE aiecos_total_messages gauge
aiecos_total_messages ${cMsg || 0}
# HELP aiecos_total_customers Total customers
# TYPE aiecos_total_customers gauge
aiecos_total_customers ${cCust || 0}
# HELP aiecos_total_conversations Total conversations
# TYPE aiecos_total_conversations gauge
aiecos_total_conversations ${cConv || 0}
# HELP aiecos_total_pages Total pages
# TYPE aiecos_total_pages gauge
aiecos_total_pages ${cPage || 0}
# HELP aiecos_uptime_seconds Service uptime
# TYPE aiecos_uptime_seconds counter
aiecos_uptime_seconds ${Math.round((Date.now() - STARTED_AT) / 1000)}
# HELP aiecos_memory_bytes RSS memory bytes
# TYPE aiecos_memory_bytes gauge
aiecos_memory_bytes ${mem.rss}
`;
    _metricsCache = { ts: Date.now(), data: out };
    res.set('Content-Type', 'text/plain').send(out);
  } catch (err) {
    res.status(500).send(`# error: ${err.message}`);
  }
});

// ── 404 ──
app.use((req, res) => {
  console.log(`[UNHANDLED] ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Not found', path: req.path, hint: 'see /api/status' });
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error', request_id: crypto.randomBytes(8).toString('hex') });
});

// ── Periodic aggregate refresh (60s) ──
const aggInterval = setInterval(async () => {
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

// ── Boot ──
const server = app.listen(PORT, () => {
  console.log(`[AIECOS-SYNC v${VERSION}] Listening on :${PORT}`);
  console.log(`[AIECOS-SYNC] Supabase: ${SUPA_URL} schema=${SUPA_SCHEMA}`);
  console.log(`[AIECOS-SYNC] Rate limit: ${RATE_MAX} req / ${RATE_WINDOW_MS}ms per IP+token`);
  console.log(`[AIECOS-SYNC] API token: ${API_TOKEN.substring(0, 6)}...${API_TOKEN.slice(-4)}`);
});

// ── Graceful shutdown ──
function shutdown(signal) {
  console.log(`[SHUTDOWN] Received ${signal}, draining...`);
  clearInterval(aggInterval);
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10s if connections hang
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced exit after 10s timeout');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED REJECTION]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  process.exit(1);
});
