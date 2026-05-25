#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  AIECOS Social CRM — MCP Server v1.0
//  Query data from AIECOS Social CRM schema (Supabase)
//  Tools: list_partners, get_partner_messages, pipeline_stats,
//         search_messages, get_at_risk, summary
// ═══════════════════════════════════════════════════════════════════

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ── Config ──
const SUPA_URL = process.env.AIECOS_SUPABASE_URL || 'http://localhost:8000';
const SUPA_KEY = process.env.AIECOS_SUPABASE_KEY || '';
const SCHEMA = process.env.AIECOS_SCHEMA || 'aiecos_social';

if (!SUPA_KEY) {
  console.error('[AIECOS-MCP] ERROR: AIECOS_SUPABASE_KEY not set');
  process.exit(1);
}

const HEADERS = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  'Accept-Profile': SCHEMA,
};

// ── REST helper ──
async function rest(path, opts = {}) {
  const url = `${SUPA_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: { ...HEADERS, ...(opts.headers || {}) },
    method: opts.method || 'GET',
    body: opts.body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST ${res.status}: ${text.slice(0, 200)}`);
  }
  // 204 = no content
  if (res.status === 204) return null;
  return res.json();
}

// ── Classification helpers ──
function classifyPartnerStage(daysSinceLastSeen) {
  if (daysSinceLastSeen > 90) return 'churned';
  if (daysSinceLastSeen > 30) return 'dormant';
  if (daysSinceLastSeen > 7) return 'at_risk';
  if (daysSinceLastSeen >= 3) return 'sleeping';
  return 'active';
}

function daysSince(iso) {
  if (!iso) return 9999;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// ── Tool implementations ──

async function tool_summary() {
  const [pages, customers, conversations, messages] = await Promise.all([
    rest('pages?select=id,name,total_conversations,total_messages,type'),
    rest('customers?select=id,last_seen_at&limit=2000'),
    rest('conversations?select=id,updated_at&order=updated_at.desc&limit=1'),
    rest('messages?select=sender_type&limit=10000'),
  ]);
  const stages = { active: 0, sleeping: 0, at_risk: 0, dormant: 0, churned: 0 };
  customers.forEach(c => {
    stages[classifyPartnerStage(daysSince(c.last_seen_at))]++;
  });
  const senderDist = messages.reduce((acc, m) => {
    acc[m.sender_type] = (acc[m.sender_type] || 0) + 1;
    return acc;
  }, {});
  return {
    pages: pages.length,
    page_breakdown: pages,
    customers_total: customers.length,
    partner_stages: stages,
    messages_total: messages.length,
    sender_distribution: senderDist,
    latest_activity: conversations[0]?.updated_at || null,
  };
}

async function tool_list_partners({ stage, limit = 50 }) {
  const customers = await rest(`customers?select=id,name,page_id,last_seen_at,first_seen_at&order=last_seen_at.desc.nullslast&limit=${limit * 2}`);
  const enriched = customers.map(c => {
    const days = daysSince(c.last_seen_at);
    return {
      id: c.id,
      name: c.name,
      page_id: c.page_id,
      last_seen_at: c.last_seen_at,
      days_since_last_seen: days,
      stage: classifyPartnerStage(days),
    };
  });
  const filtered = stage ? enriched.filter(p => p.stage === stage) : enriched;
  return { total: filtered.length, partners: filtered.slice(0, limit) };
}

async function tool_get_partner_messages({ conversation_id, limit = 30 }) {
  if (!conversation_id) throw new Error('conversation_id required');
  const msgs = await rest(`messages?select=sender_type,sender_name,content,created_time&conversation_id=eq.${encodeURIComponent(conversation_id)}&order=created_time.desc&limit=${limit}`);
  return { conversation_id, total: msgs.length, messages: msgs.reverse() };
}

async function tool_search_messages({ query, limit = 30 }) {
  if (!query) throw new Error('query required');
  const msgs = await rest(`messages?select=conversation_id,sender_type,sender_name,content,created_time&content=ilike.*${encodeURIComponent(query)}*&order=created_time.desc&limit=${limit}`);
  return { query, total: msgs.length, messages: msgs };
}

async function tool_get_at_risk({ min_days = 7, max_days = 30, limit = 50 }) {
  const customers = await rest('customers?select=id,name,page_id,last_seen_at&limit=1000');
  const filtered = customers
    .map(c => ({ ...c, days_silent: daysSince(c.last_seen_at) }))
    .filter(c => c.days_silent >= min_days && c.days_silent <= max_days)
    .sort((a, b) => a.days_silent - b.days_silent)
    .slice(0, limit);
  return { criteria: { min_days, max_days }, total: filtered.length, partners: filtered };
}

async function tool_pipeline_stats() {
  const customers = await rest('customers?select=last_seen_at&limit=2000');
  const stages = { active: 0, sleeping: 0, at_risk: 0, dormant: 0, churned: 0 };
  customers.forEach(c => stages[classifyPartnerStage(daysSince(c.last_seen_at))]++);
  const total = customers.length;
  const percentages = Object.fromEntries(
    Object.entries(stages).map(([k, v]) => [k, total > 0 ? +(v / total * 100).toFixed(1) : 0])
  );
  return { total_partners: total, stages, percentages };
}

async function tool_top_partners_by_volume({ limit = 10, days = 30 }) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const msgs = await rest(`messages?select=conversation_id&created_time=gte.${since}&limit=20000`);
  const counts = {};
  msgs.forEach(m => { counts[m.conversation_id] = (counts[m.conversation_id] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
  // Resolve conv → customer_name
  const convs = await rest('conversations?select=id,customer_name');
  const convMap = Object.fromEntries(convs.map(c => [c.id, c.customer_name || c.id]));
  return {
    period_days: days,
    total_messages: msgs.length,
    top_partners: sorted.map(([cid, n]) => ({ conversation_id: cid, partner: convMap[cid] || cid, msg_count: n })),
  };
}

async function tool_recent_activity({ limit = 20 }) {
  const msgs = await rest(`messages?select=conversation_id,sender_type,sender_name,content,created_time&order=created_time.desc&limit=${limit}`);
  return { total: msgs.length, messages: msgs };
}

// ── MCP Server setup ──
const server = new Server({ name: 'aiecos-social-crm-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

const TOOLS = [
  {
    name: 'summary',
    description: 'Overall stats: pages, customers, messages, partner stage distribution, sender ratio',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_partners',
    description: 'Liệt kê partners (B2B shop), filter theo stage (active/sleeping/at_risk/dormant/churned)',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: ['active', 'sleeping', 'at_risk', 'dormant', 'churned'], description: 'Filter theo stage' },
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'get_partner_messages',
    description: 'Lấy lịch sử tin nhắn của 1 partner theo conversation_id',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string', description: 'Conversation ID (vd: <page_id>__<customer_slug>)' },
        limit: { type: 'number', default: 30 },
      },
      required: ['conversation_id'],
    },
  },
  {
    name: 'search_messages',
    description: 'Search messages bằng substring (case-insensitive)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Từ khoá cần tìm trong content' },
        limit: { type: 'number', default: 30 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_at_risk_partners',
    description: 'Partners có last_seen từ min_days → max_days. Default 7-30d (At-Risk stage)',
    inputSchema: {
      type: 'object',
      properties: {
        min_days: { type: 'number', default: 7 },
        max_days: { type: 'number', default: 30 },
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'pipeline_stats',
    description: 'Phân bố partners theo 5 stages (active/sleeping/at_risk/dormant/churned) + %',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'top_partners_by_volume',
    description: 'Top partners theo số messages trong N ngày gần đây',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 10 },
        days: { type: 'number', default: 30 },
      },
    },
  },
  {
    name: 'recent_activity',
    description: 'N messages mới nhất across toàn workspace',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 20 } },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result;
    switch (name) {
      case 'summary': result = await tool_summary(); break;
      case 'list_partners': result = await tool_list_partners(args); break;
      case 'get_partner_messages': result = await tool_get_partner_messages(args); break;
      case 'search_messages': result = await tool_search_messages(args); break;
      case 'get_at_risk_partners': result = await tool_get_at_risk(args); break;
      case 'pipeline_stats': result = await tool_pipeline_stats(); break;
      case 'top_partners_by_volume': result = await tool_top_partners_by_volume(args); break;
      case 'recent_activity': result = await tool_recent_activity(args); break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Boot ──
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[AIECOS-MCP v1.0] Connected via stdio. Schema=' + SCHEMA);
