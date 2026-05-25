-- ═══════════════════════════════════════════════════════════════════
--  AIECOS Social CRM — Database schema
--  Run on your Supabase Postgres (self-host or cloud)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Create schema
CREATE SCHEMA IF NOT EXISTS aiecos_social;
SET search_path TO aiecos_social;

-- 2. Pages (channels: Facebook page, Zalo OA, Instagram, etc.)
CREATE TABLE IF NOT EXISTS pages (
  id                    text PRIMARY KEY,
  name                  text,
  type                  text DEFAULT 'facebook',
  is_active             boolean DEFAULT true,
  total_conversations   integer DEFAULT 0,
  total_messages        integer DEFAULT 0,
  last_sync_at          timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- 3. Customers (end users / partners)
CREATE TABLE IF NOT EXISTS customers (
  id                    text PRIMARY KEY,
  name                  text,
  page_id               text REFERENCES pages(id),
  phone_numbers         jsonb DEFAULT '[]'::jsonb,
  emails                jsonb DEFAULT '[]'::jsonb,
  tags                  jsonb DEFAULT '[]'::jsonb,
  order_count           integer DEFAULT 0,
  purchased_amount      numeric DEFAULT 0,
  first_seen_at         timestamptz,
  last_seen_at          timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- 4. Conversations (1 conv per customer per page)
CREATE TABLE IF NOT EXISTS conversations (
  id                    text PRIMARY KEY,
  page_id               text REFERENCES pages(id),
  customer_id           text REFERENCES customers(id),
  customer_name         text,
  snippet               text,
  message_count         integer DEFAULT 0,
  has_phone             boolean DEFAULT false,
  is_replied            boolean DEFAULT false,
  tags                  jsonb DEFAULT '[]'::jsonb,
  inserted_at           timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  synced_at             timestamptz DEFAULT now()
);

-- 5. Messages (individual chat messages)
CREATE TABLE IF NOT EXISTS messages (
  id                    text PRIMARY KEY,
  conversation_id       text REFERENCES conversations(id),
  page_id               text REFERENCES pages(id),
  sender_id             text,
  sender_name           text,
  sender_type           text,  -- 'customer' | 'agent' | 'system'
  content               text,
  content_html          text,
  message_type          text DEFAULT 'text',
  attachments           jsonb DEFAULT '[]'::jsonb,
  reactions             jsonb DEFAULT '[]'::jsonb,
  is_unsent             boolean DEFAULT false,
  created_time          timestamptz,
  synced_at             timestamptz DEFAULT now(),
  created_at            timestamptz DEFAULT now()
);

-- 6. Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_msgs_conv_time ON messages(conversation_id, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_msgs_page_time ON messages(page_id, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_msgs_sender ON messages(sender_type);
CREATE INDEX IF NOT EXISTS idx_convs_page ON conversations(page_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_custs_lastseen ON customers(last_seen_at DESC NULLS LAST);

-- 7. (Optional) Add 'aiecos_social' to PostgREST exposed schemas
-- In Supabase: edit Kong env DB_SCHEMAS to include 'aiecos_social'
-- Example: DB_SCHEMAS=public,storage,graphql_public,aiecos_social
-- Then restart Kong + postgrest containers.
