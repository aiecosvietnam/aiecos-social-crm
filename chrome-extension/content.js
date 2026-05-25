// AIECOS v4.6.0 Content Script — Multi-Channel Pancake Sync
// Supports: Zalo OA, Zalo User, Messenger, Facebook
// [v4.6] PANCAKE-SPECIFIC fixes confirmed from real DOM:
//   - Scanner: chỉ scan [id^="message_pzl_m_"] (outer wrapper) → fix duplicate
//   - Sender: class "media-current-customer" → customer, else agent → fix sender_type
//   - Date: parse từ <div class="system-msg-sticky"> (e.g. "19 Thg 05 2026")
//   - Dedup: dùng pancake msg ID làm primary key
//   - Tin nhắn được scan theo thứ tự DOM (oldest top, newest bottom)

const MIN_INTERVAL = 500;
const SCAN_DELAY = 1500;
const MAX_SCAN_MESSAGES = 5000;     // tăng từ 200 → 5000 để scan hết tin
const MAX_MSG_LENGTH = 2000;
const BATCH_SEND_DELAY = 1500;
const MAX_BATCH_SIZE = 50;          // [PATCH v4.3] Force flush khi batch đầy
const MAX_FLUSH_INTERVAL = 5000;    // [PATCH v4.3] Hard timeout 5s, không reset
const SCROLL_LOAD_DELAY = 1200;     // chậm hơn để đợi Pancake load
const MAX_SCROLL_ATTEMPTS = 200;    // tăng từ 30 → 200 cho conv dài
const SIDEBAR_SCROLL_DELAY = 1500;
const MAX_SIDEBAR_SCROLLS = 50;     // scroll sidebar để load thêm conv
const WALK_DELAY_MS = 3500;         // delay chuyển conv (đủ để load tin)

// ── Deduplication (persist cache qua reload) ────────────────────────────
const _sentHashes = new Set();
const MAX_SENT_CACHE = 50000;  // tăng lên 50K để support sync 20K+ messages

// Load cache từ chrome.storage khi khởi động
try {
  chrome.storage.local.get(['sentHashes'], (r) => {
    if (r.sentHashes && Array.isArray(r.sentHashes)) {
      r.sentHashes.forEach(h => _sentHashes.add(h));
      console.log(`[AIECOS] Loaded ${_sentHashes.size} cached hashes from storage`);
    }
  });
} catch {}

// Persist hash cache mỗi 30s
setInterval(() => {
  try {
    const arr = Array.from(_sentHashes).slice(-MAX_SENT_CACHE);
    chrome.storage.local.set({ sentHashes: arr });
  } catch {}
}, 30000);

function msgHash(customer, text, timestamp) {
  const raw = customer + '|||' + text.substring(0, 200) + '|||' + (timestamp || '');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return hash.toString(36);
}

function alreadySent(hash) {
  return _sentHashes.has(hash);
}

function markSent(hash) {
  _sentHashes.add(hash);
  if (_sentHashes.size > MAX_SENT_CACHE) {
    const first = _sentHashes.values().next().value;
    _sentHashes.delete(first);
  }
}

// ── Text quality checks ────────────────────────────────────────────────
function looksLikeCSS(text) {
  if (/\{[^}]*:[^}]*\}/.test(text)) return true;
  if (/[{};]/.test(text) && /(?:padding|margin|display|background|color|border|font|width|height|flex|position|overflow|box-shadow|webkit)/i.test(text)) return true;
  if (text.includes('-webkit-') || text.includes('-ms-flex')) return true;
  return false;
}

function looksLikeCode(text) {
  if (/^[\[{].*[\]}]$/.test(text.trim())) return true;
  if (/<\/?[a-z]+[^>]*>/i.test(text) && text.length > 100) return true;
  return false;
}

function isValidMessage(text) {
  if (!text || text.length < 1) return false;
  if (text.length > MAX_MSG_LENGTH) return false;
  if (looksLikeCSS(text)) return false;
  if (looksLikeCode(text)) return false;
  if (/^(http|https):\/\/\S+$/i.test(text.trim()) && text.length > 200) return false;
  // Filter common UI text
  if (/^(Đang nhập|Typing|Seen|Đã xem|Online|Offline|\d+ phút trước)$/i.test(text.trim())) return false;
  return true;
}

// ── Channel type detection ──────────────────────────────────────────────
function detectChannelType() {
  const url = window.location.href;

  // Zalo OA: URL contains pzl_ or zalo indicators
  if (url.includes('pzl_') || url.includes('/zalo/') || url.includes('zalo_oa')) {
    return 'zalo_oa';
  }

  // Zalo User: Different URL pattern for personal Zalo
  if (url.includes('zalo_user') || url.includes('/zalo-user/')) {
    return 'zalo_user';
  }

  // Facebook page/comments
  if (url.includes('/facebook/') || url.includes('fb_') || url.includes('facebook_comment')) {
    return 'facebook';
  }

  // Check DOM for Zalo markers
  const zaloMarkers = document.querySelectorAll('[class*="zalo"], [data-channel="zalo"], [class*="zl-"]');
  if (zaloMarkers.length > 0) {
    // Check if it's user or OA based on additional markers
    const oaMarkers = document.querySelectorAll('[class*="oa-"], [data-type="oa"]');
    return oaMarkers.length > 0 ? 'zalo_oa' : 'zalo_user';
  }

  // Check for Facebook markers
  const fbMarkers = document.querySelectorAll('[class*="facebook"], [data-channel="facebook"], [class*="fb-"]');
  if (fbMarkers.length > 0) return 'facebook';

  // Default: Messenger (most common on Pancake)
  return 'messenger';
}

// ── Page & Channel detection ────────────────────────────────────────────
function detectPageName() {
  try {
    let pageName = null;

    // Try specific Pancake selectors
    const selectors = ['.page-name', '[class*="page-selector"]', '[class*="page-title"]', '.shop-name', '[class*="shop-name"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 1) {
        pageName = el.textContent.trim();
        break;
      }
    }

    // Fallback: URL-based
    if (!pageName) {
      const url = window.location.href;
      const match = url.match(/pancake\.vn\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        pageName = match[1].replace(/-/g, ' ');
      }
    }

    const type = detectChannelType();

    if (!pageName || pageName.length === 0) {
      pageName = 'Page_' + Date.now().toString().slice(-6);
    }

    return { name: pageName.substring(0, 100), type };
  } catch (err) {
    console.error('[AIECOS] detectPageName error:', err);
    return { name: 'Unknown', type: 'messenger' };
  }
}

// ── Customer name detection ─────────────────────────────────────────────
function getCustomerName() {
  try {
    const selectors = [
      '.contact-name',
      '[class*="contact-name"]',
      '[class*="customer-name"]',
      '.conversation-header .name',
      '.chat-header .name',
      '.header-name',
      '[data-name]',
      '.current-contact-name',
      '[class*="user-name"]',
      '[class*="chat-name"]',
      '[class*="conv-name"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent) {
        const text = el.textContent.trim();
        if (text.length > 1 && text.length < 100 && !looksLikeCSS(text)) return text;
      }
    }

    // Data attributes
    const elWithData = document.querySelector('[data-contact-name], [data-customer-name], [data-user-name]');
    if (elWithData) {
      const name = elWithData.getAttribute('data-contact-name') ||
                   elWithData.getAttribute('data-customer-name') ||
                   elWithData.getAttribute('data-user-name');
      if (name && name.length > 1 && name.length < 100) return name;
    }

    return 'Unknown Customer';
  } catch (err) {
    return 'Unknown Customer';
  }
}

// ── Sender type detection [v4.6 Pancake-specific] ─────────────────────
// DOM evidence from Pancake (Zalo OA channel):
//   Outer wrapper: <div id="message_pzl_m_..." class="media inbox-message-ele media-current-customer">
//   Inner body:    <div class="media-body-text media-message-from-customer">
//   Inner text:    <div class="message-text-ele client-message">
//   ALL 3 above appear ONLY for messages from the OTHER PARTY (= customer from page's POV).
//   For page-side replies, "current-customer" / "from-customer" / "client-message" do NOT appear.
function detectSenderType(el) {
  try {
    // Lấy class của bản thân el + parent + outerHTML để detect
    const selfClass = (el.className || '').toString();
    const parentClass = (el.parentElement?.className || '').toString();
    const wrapperEl = el.closest('[id^="message_pzl_m_"], [class*="inbox-message-ele"]');
    const wrapperClass = (wrapperEl?.className || '').toString();
    const combined = selfClass + ' ' + parentClass + ' ' + wrapperClass;

    // System/notification
    if (/system-msg|notification|system-message/i.test(combined)) return 'system';

    // Customer markers (Pancake confirmed)
    if (/media-current-customer|media-message-from-customer|client-message/i.test(combined)) {
      return 'customer';
    }

    // Agent markers — Pancake typically uses:
    //   media-current-page / media-message-from-page / page-message / agent-message
    //   or absence of customer markers in inbox-message-ele
    if (/media-current-page|media-message-from-page|page-message|agent-message|from-staff|from-admin/i.test(combined)) {
      return 'agent';
    }

    // Generic fallback patterns
    if (/(?:agent|admin|staff|reply|outgoing|sent|self|right)/i.test(combined)) return 'agent';
    if (/(?:incoming|received|left)/i.test(combined)) return 'customer';

    // Nếu el là 1 inbox-message-ele nhưng KHÔNG có customer marker → mặc định là agent
    // (vì Pancake gắn "current-customer" chỉ cho msg KH; msg page không có marker này)
    if (/inbox-message-ele/i.test(wrapperClass) && !/current-customer|from-customer|client-message/i.test(combined)) {
      return 'agent';
    }

    return 'customer'; // Default
  } catch {
    return 'customer';
  }
}

// ── Sender name extraction ──────────────────────────────────────────────
function detectSenderName(el, senderType, customerName) {
  try {
    // Look for sender name near the message bubble
    const parent = el.parentElement;
    if (!parent) return senderType === 'customer' ? customerName : 'Agent';

    const nameEl = parent.querySelector('[class*="sender"], [class*="name"]:not([class*="page"])');
    if (nameEl) {
      const name = nameEl.textContent.trim();
      if (name.length > 0 && name.length < 50 && !looksLikeCSS(name)) return name;
    }

    // Look at previous sibling for grouped messages
    const prev = el.previousElementSibling;
    if (prev) {
      const prevName = prev.querySelector('[class*="sender"], [class*="name"]');
      if (prevName) {
        const name = prevName.textContent.trim();
        if (name.length > 0 && name.length < 50) return name;
      }
    }

    return senderType === 'customer' ? customerName : 'Agent';
  } catch {
    return senderType === 'customer' ? customerName : 'Agent';
  }
}

// ── Timestamp extraction [v4.5 — robust multi-format parser] ────────────
const VN_MONTHS = { 'thg': null, 'tháng': null }; // we just rely on number parsing
const VN_DOW = { 'thứ 2':1,'thứ 3':2,'thứ 4':3,'thứ 5':4,'thứ 6':5,'thứ 7':6,'cn':0,'chủ nhật':0,'t2':1,'t3':2,'t4':3,'t5':4,'t6':5,'t7':6 };

// Parse Vietnamese / Pancake time strings → ISO string (or null if not parseable)
function parseVietnameseTime(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const now = new Date();

  // ISO-8601 hoặc RFC format → trả về trực tiếp
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/.test(s)) {
    const d = new Date(raw);
    if (!isNaN(d)) return d.toISOString();
  }

  // Unix ms hoặc s
  if (/^\d{10}$/.test(s)) return new Date(parseInt(s, 10) * 1000).toISOString();
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s, 10)).toISOString();

  // "DD/MM/YYYY HH:MM" hoặc "DD/MM/YYYY, HH:MM" hoặc "DD/MM/YYYY HH:MM:SS"
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    let yr = parseInt(m[3], 10); if (yr < 100) yr += 2000;
    const d = new Date(yr, parseInt(m[2],10)-1, parseInt(m[1],10), parseInt(m[4],10), parseInt(m[5],10), parseInt(m[6]||'0',10));
    if (!isNaN(d)) return d.toISOString();
  }

  // "HH:MM DD/MM/YYYY" (ngược thứ tự)
  m = s.match(/(\d{1,2}):(\d{2})[,\s]+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let yr = parseInt(m[5], 10); if (yr < 100) yr += 2000;
    const d = new Date(yr, parseInt(m[4],10)-1, parseInt(m[3],10), parseInt(m[1],10), parseInt(m[2],10));
    if (!isNaN(d)) return d.toISOString();
  }

  // "DD/MM HH:MM" (no year — assume current year)
  m = s.match(/(\d{1,2})\/(\d{1,2})[\s,]+(\d{1,2}):(\d{2})/);
  if (m) {
    const d = new Date(now.getFullYear(), parseInt(m[2],10)-1, parseInt(m[1],10), parseInt(m[3],10), parseInt(m[4],10));
    if (!isNaN(d)) {
      // Nếu rơi vào tương lai > 1 ngày, lùi về năm trước
      if (d.getTime() > now.getTime() + 86400000) d.setFullYear(now.getFullYear() - 1);
      return d.toISOString();
    }
  }

  // "Hôm qua HH:MM"
  m = s.match(/h[ôo]m qua[\s,]+(\d{1,2}):(\d{2})/);
  if (m) {
    const d = new Date(now); d.setDate(d.getDate() - 1);
    d.setHours(parseInt(m[1],10), parseInt(m[2],10), 0, 0);
    return d.toISOString();
  }

  // "Hôm nay HH:MM" hoặc "Today HH:MM"
  m = s.match(/(?:h[ôo]m nay|today)[\s,]+(\d{1,2}):(\d{2})/);
  if (m) {
    const d = new Date(now); d.setHours(parseInt(m[1],10), parseInt(m[2],10), 0, 0);
    return d.toISOString();
  }

  // "Thứ N HH:MM" hoặc "T3 HH:MM" — day of week trong tuần này
  for (const [key, dow] of Object.entries(VN_DOW)) {
    const re = new RegExp(key + '[\\s,]+(\\d{1,2}):(\\d{2})');
    const mm = s.match(re);
    if (mm) {
      const d = new Date(now);
      const cur = d.getDay();
      const diff = (cur - dow + 7) % 7 || 7; // nếu cùng day → tuần trước
      d.setDate(d.getDate() - diff);
      d.setHours(parseInt(mm[1],10), parseInt(mm[2],10), 0, 0);
      return d.toISOString();
    }
  }

  // "N phút trước" / "N giờ trước" / "N ngày trước"
  m = s.match(/(\d+)\s*(gi[âa]y|ph[uú]t|gi[ờo]|ng[àa]y|tu[âầ]n|th[áa]ng|n[ăa]m)\s*(?:tr[ưu][ơớ]c|ago)/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    let ms = 0;
    if (/gi[âa]y/.test(unit)) ms = n * 1000;
    else if (/ph[uú]t/.test(unit)) ms = n * 60000;
    else if (/gi[ờo]/.test(unit)) ms = n * 3600000;
    else if (/ng[àa]y/.test(unit)) ms = n * 86400000;
    else if (/tu[âầ]n/.test(unit)) ms = n * 7 * 86400000;
    else if (/th[áa]ng/.test(unit)) ms = n * 30 * 86400000;
    else if (/n[ăa]m/.test(unit)) ms = n * 365 * 86400000;
    return new Date(now.getTime() - ms).toISOString();
  }

  // "Vừa xong" / "Just now"
  if (/v[ưừ]a xong|just now/.test(s)) return now.toISOString();

  // "HH:MM" → assume today
  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (m) {
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = parseInt(m[3] || '0', 10);
    const ap = m[4];
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    const d = new Date(now); d.setHours(hh, mm, ss, 0);
    // Nếu giờ này lớn hơn now → là ngày hôm qua
    if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
    return d.toISOString();
  }

  // Generic Date.parse fallback
  const fallback = Date.parse(raw);
  if (!isNaN(fallback)) return new Date(fallback).toISOString();

  return null;
}

// Diagnostic counter — chỉ log 5 lần đầu mỗi scan để tránh spam console
let _tsLogCount = 0;
function _resetTsLogCount() { _tsLogCount = 0; }

function extractTimestamp(el) {
  try {
    const debug = _tsLogCount < 5;

    // 1. data-* attributes trực tiếp trên element
    const directAttrs = ['data-time', 'data-timestamp', 'data-created-at', 'data-sent-at', 'datetime'];
    for (const a of directAttrs) {
      const v = el.getAttribute(a);
      if (v) {
        const parsed = parseVietnameseTime(v);
        if (parsed) {
          if (debug) { console.log(`[AIECOS-TS] direct attr ${a}="${v}" → ${parsed}`); _tsLogCount++; }
          return { ts: parsed, source: 'attr:' + a };
        }
      }
    }

    // 2. title/aria-label trên element hoặc parent (tooltip)
    const titleChain = [el, el.parentElement, el.parentElement?.parentElement, el.closest('[title]'), el.closest('[aria-label]')];
    for (const node of titleChain) {
      if (!node) continue;
      const t = node.getAttribute?.('title') || node.getAttribute?.('aria-label');
      if (t && /\d{1,2}[:/]\d{2}/.test(t)) {
        const parsed = parseVietnameseTime(t);
        if (parsed) {
          if (debug) { console.log(`[AIECOS-TS] title="${t}" → ${parsed}`); _tsLogCount++; }
          return { ts: parsed, source: 'title' };
        }
      }
    }

    // 3. <time> hoặc element con có timestamp class
    const timeSelectors = ['time', '[datetime]', '[data-time]', '[data-timestamp]', '[class*="timestamp"]', '[class*="msg-time"]', '[class*="message-time"]', '[class*="send-time"]', '[class*="sent-time"]'];
    const parent = el.closest('[class*="message-group"], [class*="msg-wrapper"], [class*="msg-item"], [class*="message-item"]') || el.parentElement;
    if (parent) {
      for (const sel of timeSelectors) {
        const timeEls = parent.querySelectorAll(sel);
        for (const timeEl of timeEls) {
          const candidates = [
            timeEl.getAttribute('datetime'),
            timeEl.getAttribute('data-time'),
            timeEl.getAttribute('data-timestamp'),
            timeEl.getAttribute('title'),
            timeEl.textContent?.trim(),
          ];
          for (const c of candidates) {
            if (!c) continue;
            const parsed = parseVietnameseTime(c);
            if (parsed) {
              if (debug) { console.log(`[AIECOS-TS] ${sel} "${c}" → ${parsed}`); _tsLogCount++; }
              return { ts: parsed, source: 'el:' + sel };
            }
          }
        }
      }
    }

    // 4. Walk up vài level tìm bất cứ text node nào trông như time
    let walker = el.parentElement;
    for (let i = 0; i < 4 && walker; i++) {
      const text = (walker.innerText || '').trim();
      if (text && text.length < 200) {
        // Tìm pattern "HH:MM" hoặc "DD/MM..."
        const m = text.match(/\b(\d{1,2}):(\d{2})(?:\s*(?:am|pm))?\b/i) ||
                  text.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/);
        if (m) {
          const parsed = parseVietnameseTime(m[0]);
          if (parsed) {
            if (debug) { console.log(`[AIECOS-TS] walk-up L${i} "${m[0]}" → ${parsed}`); _tsLogCount++; }
            return { ts: parsed, source: 'walkup:L' + i };
          }
        }
      }
      walker = walker.parentElement;
    }

    if (debug) { console.log('[AIECOS-TS] no timestamp found for el', el.className?.substring(0,80)); _tsLogCount++; }
    return { ts: null, source: 'none' };
  } catch (err) {
    return { ts: null, source: 'error' };
  }
}

// ── [v4.6] Parse "19 Thg 05 2026" from system-msg-sticky ───────────────
const VN_MONTH_SHORT = { 'thg 1':1,'thg 2':2,'thg 3':3,'thg 4':4,'thg 5':5,'thg 6':6,'thg 7':7,'thg 8':8,'thg 9':9,'thg 10':10,'thg 11':11,'thg 12':12,
                          'thg 01':1,'thg 02':2,'thg 03':3,'thg 04':4,'thg 05':5,'thg 06':6,'thg 07':7,'thg 08':8,'thg 09':9 };

function parsePancakeStickyDate(text) {
  if (!text) return null;
  const s = text.trim().toLowerCase();
  // "19 Thg 05 2026" or "Hôm nay" or "Hôm qua"
  if (/h[ôo]m nay/.test(s)) {
    const d = new Date(); d.setHours(0,0,0,0); return d;
  }
  if (/h[ôo]m qua/.test(s)) {
    const d = new Date(); d.setDate(d.getDate()-1); d.setHours(0,0,0,0); return d;
  }
  // "19 Thg 05 2026"
  let m = s.match(/^(\d{1,2})\s+(thg\s*\d{1,2})\s+(\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = VN_MONTH_SHORT[m[2].replace(/\s+/g,' ')];
    const year = parseInt(m[3], 10);
    if (month) return new Date(year, month - 1, day, 0, 0, 0, 0);
  }
  // "19/05/2026" or "19/5/2026"
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3],10), parseInt(m[2],10)-1, parseInt(m[1],10));
  return null;
}

// Tìm sticky date gần nhất phía TRƯỚC msg el trong DOM (walk previousElementSibling)
function findStickyDateBefore(el) {
  try {
    // Walk lên parent rồi previousSibling
    let cur = el;
    while (cur) {
      // Check chính cur
      const sticky = cur.querySelector?.('.system-msg-sticky .text, [class*="system-msg-sticky"] [class*="text"]');
      if (sticky && cur.contains(el)) {
        // Sticky cùng cấp trên hoặc trong cùng container — vẫn cần check vị trí
      }
      // Walk siblings về trước
      let sib = cur.previousElementSibling;
      while (sib) {
        // Nếu sib chứa sticky → đây là date gần nhất phía trước
        if (sib.classList?.contains('system-msg-sticky') || sib.id === 'sticky') {
          const txt = sib.querySelector?.('.text')?.textContent?.trim() || sib.textContent?.trim();
          const d = parsePancakeStickyDate(txt);
          if (d) return d;
        }
        const inner = sib.querySelector?.('.system-msg-sticky .text, #sticky .text');
        if (inner) {
          const d = parsePancakeStickyDate(inner.textContent?.trim());
          if (d) return d;
        }
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
      if (cur === document.body) break;
    }
  } catch {}
  return null;
}

// ── Attachment detection ────────────────────────────────────────────────
function extractAttachments(el) {
  try {
    const attachments = [];

    // Images
    const imgs = el.querySelectorAll('img:not([class*="avatar"]):not([class*="emoji"]):not([width="16"]):not([width="20"])');
    imgs.forEach(img => {
      const src = img.src || img.getAttribute('data-src');
      if (src && !src.includes('emoji') && !src.includes('avatar') && !src.includes('icon')) {
        attachments.push({ url: src, type: 'image', name: 'image.jpg' });
      }
    });

    // Files/links
    const links = el.querySelectorAll('a[href*="file"], a[href*="download"], a[href*="attachment"]');
    links.forEach(link => {
      attachments.push({ url: link.href, type: 'file', name: link.textContent?.trim() || 'file' });
    });

    // Stickers
    const stickers = el.querySelectorAll('[class*="sticker"] img, [class*="gif"] img');
    stickers.forEach(st => {
      attachments.push({ url: st.src, type: 'sticker', name: 'sticker' });
    });

    return attachments;
  } catch {
    return [];
  }
}

// ── Chat area detection ─────────────────────────────────────────────────
function isDOMInChatArea(node) {
  try {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return rect.x > 350;
  } catch {
    return false;
  }
}

// ── Extract clean text from element ─────────────────────────────────────
function getCleanText(el) {
  try {
    let text = (el.innerText || el.textContent || '').trim();

    if (text.length > MAX_MSG_LENGTH) {
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .filter(t => t.length > 0)
        .join(' ');
      if (directText.length > 0 && directText.length <= MAX_MSG_LENGTH) {
        text = directText;
      } else {
        return '';
      }
    }

    return text;
  } catch {
    return '';
  }
}

// ── Message batch buffer ────────────────────────────────────────────────
let _messageBatch = [];
let _batchTimer = null;

let _batchHardDeadline = null;  // [PATCH v4.3] hard deadline timer

function queueMessage(messageData) {
  _messageBatch.push(messageData);

  // [PATCH v4.3] Force flush khi batch >= MAX_BATCH_SIZE
  if (_messageBatch.length >= MAX_BATCH_SIZE) {
    if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null; }
    if (_batchHardDeadline) { clearTimeout(_batchHardDeadline); _batchHardDeadline = null; }
    console.log('[AIECOS] Batch full (' + _messageBatch.length + '), flush ngay');
    flushBatch();
    return;
  }

  // Soft timer — reset mỗi push (chờ idle 1.5s)
  if (_batchTimer) clearTimeout(_batchTimer);
  _batchTimer = setTimeout(flushBatch, BATCH_SEND_DELAY);

  // [PATCH v4.3] Hard deadline timer — KHÔNG reset, force flush sau MAX_FLUSH_INTERVAL
  if (!_batchHardDeadline) {
    _batchHardDeadline = setTimeout(() => {
      console.log('[AIECOS] Hard deadline reached, force flush batch (' + _messageBatch.length + ' msgs)');
      if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null; }
      _batchHardDeadline = null;
      flushBatch();
    }, MAX_FLUSH_INTERVAL);
  }
}

function flushBatch() {
  if (_messageBatch.length === 0) return;

  const batch = [..._messageBatch];
  _messageBatch = [];
  _batchTimer = null;
  if (_batchHardDeadline) { clearTimeout(_batchHardDeadline); _batchHardDeadline = null; }

  const pageInfo = detectPageName();
  const customerName = getCustomerName();

  const payload = {
    page_name: pageInfo.name,
    channel: pageInfo.type,
    ten_khach: customerName,
    messages: batch,
    url: window.location.href,
    timestamp: new Date().toISOString(),
  };

  const sendWithRetry = (attempt = 1) => {
    chrome.runtime.sendMessage({ action: 'AIECOS_SYNC', payload }, (response) => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message;
        console.warn(`[AIECOS] Batch sync fail (attempt ${attempt}):`, err);
        if (attempt < 3) {
          // Requeue messages lại để hash KHÔNG bị mark_sent (có thể xử lý lại)
          setTimeout(() => sendWithRetry(attempt + 1), 2000 * attempt);
        } else {
          // Sau 3 lần thất bại → un-mark hash để lần scan sau thử lại
          batch.forEach(m => {
            const h = msgHash(m.sender_name || customerName, m.content || '', m.timestamp);
            _sentHashes.delete(h);
          });
          console.error(`[AIECOS] ✗ Batch của ${batch.length} msgs bỏ qua sau 3 retries — sẽ retry lần scan sau`);
        }
      } else if (response && response.error) {
        console.warn('[AIECOS] Server error:', response.error);
        if (attempt < 3) setTimeout(() => sendWithRetry(attempt + 1), 2000 * attempt);
      } else {
        console.log(`[AIECOS] ✓ Batch synced: ${batch.length} messages (inserted: ${(response && response.inserted) || '?'})`);
      }
    });
  };
  sendWithRetry();
}

// ── Main scan function ──────────────────────────────────────────────────
let lastSyncTime = 0;
let isScanning = false;

function scanExistingMessages() {
  try {
    if (isScanning) return;
    isScanning = true;

    const now = Date.now();
    if (now - lastSyncTime < MIN_INTERVAL) {
      isScanning = false;
      return;
    }

    // [v4.6] PANCAKE: chỉ scan outer wrapper `[id^="message_pzl_m_"]`
    //        → eliminates duplicate scan của child elements (bubble, body, text)
    let elements = document.querySelectorAll('[id^="message_pzl_m_"], [id^="message_fb_m_"]');

    // Fallback nếu không tìm thấy outer wrapper (kênh khác Pancake hoặc DOM thay đổi)
    if (elements.length === 0) {
      const specificSelectors = [
        '[class*="inbox-message-ele"]',
        '[class*="bubble"]',
        '[role="article"]',
        '.msg-content',
        '.message-content',
        '.message-text',
        '.chat-message',
        '[class*="msg-bubble"]',
        '[class*="message-bubble"]',
      ];
      elements = document.querySelectorAll(specificSelectors.join(', '));
    }

    if (elements.length === 0) {
      isScanning = false;
      return;
    }

    const customerName = getCustomerName();
    const messageArray = Array.from(elements).slice(-MAX_SCAN_MESSAGES);
    let processedCount = 0;

    // [v4.5] Reset diagnostic counter mỗi scan
    _resetTsLogCount();

    // [v4.6] Pass 1: extract msg_id + text + timestamp source
    // DOM order: oldest-on-top (index 0 = oldest, last = newest)
    let _dbgLog = 0;
    const enriched = messageArray.map((el, idx) => {
      const text = getCleanText(el);
      if (!text || !isValidMessage(text)) return null;
      if (!isDOMInChatArea(el)) return null;

      // Lấy pancake msg ID làm dedup key chính
      const pancakeMsgId = el.id || el.getAttribute('data-id') || el.closest('[id^="message_"]')?.id || null;

      const tsResult = extractTimestamp(el);

      // Sticky date — Pancake show date separator giữa các ngày
      const stickyDate = findStickyDateBefore(el);

      // Debug log: 3 msgs đầu mỗi scan
      if (_dbgLog < 3) {
        const wrapperClass = (el.className || '').toString().substring(0, 80);
        const sType = detectSenderType(el);
        console.log(`[AIECOS-DBG] msg#${idx} id=${pancakeMsgId?.substring(0,40)} sender=${sType} stickyDate=${stickyDate?.toISOString()?.substring(0,10)} class="${wrapperClass}" text="${text.substring(0,40)}"`);
        _dbgLog++;
      }

      return { el, idx, text, tsResult, pancakeMsgId, stickyDate };
    }).filter(x => x !== null);

    // [v4.6] Pass 2: anchor timestamps theo sticky date + DOM index trong ngày
    // Logic:
    //   - Group msgs theo stickyDate (mỗi ngày 1 group)
    //   - Trong mỗi ngày: phân bố msgs đều trong khoảng [stickyDate 08:00, stickyDate+1day 22:00]
    //     hoặc lùi 1s mỗi msg từ stickyDate+23:59:59 (cách an toàn)
    //   - Nếu không có sticky → fallback "now - N*1s" như cũ
    const nowMs = Date.now();
    // Group by sticky date key (YYYY-MM-DD)
    const groups = new Map(); // key → [items]
    for (const item of enriched) {
      const key = item.stickyDate ? item.stickyDate.toISOString().substring(0,10) : '__no_date__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    for (const [dateKey, items] of groups.entries()) {
      if (dateKey === '__no_date__') {
        // Không có sticky → fallback: now lùi 1s/msg
        const total = items.length;
        items.forEach((item, i) => {
          item.finalTs = new Date(nowMs - (total - 1 - i) * 1000).toISOString();
          item.tsResult.source = (item.tsResult.source || 'none') + '+fallback_now';
        });
      } else {
        // Có sticky date — phân bố msgs trong ngày đó
        // Strategy đơn giản: spread đều trong window 12 tiếng (8am→8pm) của ngày đó
        // Nếu là ngày hôm nay → giới hạn until "now" (không cho vượt quá hiện tại)
        const baseDate = new Date(dateKey + 'T08:00:00.000Z');
        const endOfDay = new Date(dateKey + 'T20:00:00.000Z');
        const isToday = dateKey === new Date().toISOString().substring(0,10);
        const upperMs = isToday ? Math.min(endOfDay.getTime(), nowMs) : endOfDay.getTime();
        const lowerMs = baseDate.getTime();
        const span = Math.max(upperMs - lowerMs, 1000);
        const total = items.length;
        const step = total > 1 ? span / (total - 1) : 0;
        items.forEach((item, i) => {
          // Nếu msg có ts từ extractTimestamp parser → ưu tiên nếu hợp lý
          if (item.tsResult.ts) {
            const parsedDate = new Date(item.tsResult.ts).toISOString().substring(0,10);
            if (parsedDate === dateKey) {
              item.finalTs = item.tsResult.ts;
              return;
            }
          }
          // Else: spread đều trong ngày
          item.finalTs = new Date(lowerMs + i * step).toISOString();
          item.tsResult.source = (item.tsResult.source || 'none') + '+sticky_spread';
        });
      }
    }

    // [v4.6] Pass 3: queue — dedup BẰNG pancake msg ID (priority) hoặc content hash
    for (const item of enriched) {
      try {
        const { el, text, finalTs, tsResult, pancakeMsgId } = item;
        // Dedup key: ưu tiên pancake ID (unique từ server)
        const dedupKey = pancakeMsgId
          ? 'pid:' + pancakeMsgId
          : msgHash(customerName, text, finalTs);

        if (alreadySent(dedupKey)) continue;

        const senderType = detectSenderType(el);
        const senderName = detectSenderName(el, senderType, customerName);
        const attachments = extractAttachments(el);

        queueMessage({
          content: text.substring(0, MAX_MSG_LENGTH),
          sender_type: senderType,
          sender_name: senderName,
          timestamp: finalTs,
          timestamp_source: tsResult.source,
          pancake_msg_id: pancakeMsgId,
          message_type: attachments.length > 0 ? attachments[0].type : 'text',
          attachments: attachments,
        });

        markSent(dedupKey);
        processedCount++;
      } catch (err) {
        console.error('[AIECOS] Error processing message:', err);
      }
    }

    lastSyncTime = now;
    isScanning = false;

    if (processedCount > 0) {
      console.log(`[AIECOS] Queued ${processedCount} new messages (from ${messageArray.length} scanned)`);
    }
  } catch (err) {
    console.error('[AIECOS] scanExistingMessages error:', err);
    isScanning = false;
  }
}

// ── Scroll to load all messages ─────────────────────────────────────────
async function scrollToLoadAllMessages() {
  try {
    const chatContainer = document.querySelector(
      '[class*="chat-body"], [class*="message-list"], [class*="conversation-body"], [class*="msg-list"]'
    );

    if (!chatContainer) {
      console.log('[AIECOS] Chat container not found for scroll-load');
      return;
    }

    let attempts = 0;
    let lastScrollHeight = chatContainer.scrollHeight;

    while (attempts < MAX_SCROLL_ATTEMPTS) {
      chatContainer.scrollTop = 0; // Scroll to top to load older messages
      await new Promise(r => setTimeout(r, SCROLL_LOAD_DELAY));

      const newScrollHeight = chatContainer.scrollHeight;
      if (newScrollHeight === lastScrollHeight) {
        break; // No more messages to load
      }

      lastScrollHeight = newScrollHeight;
      attempts++;
    }

    // Scroll back to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
    console.log(`[AIECOS] Scroll-loaded messages (${attempts} scroll attempts)`);

    // Scan all loaded messages
    await new Promise(r => setTimeout(r, 500));
    scanExistingMessages();
  } catch (err) {
    console.error('[AIECOS] scrollToLoadAllMessages error:', err);
  }
}

// ── MutationObserver for realtime sync ──────────────────────────────────
let _observer = null;
let _observerDebounce = null;

function setupMutationObserver() {
  try {
    if (_observer) _observer.disconnect();

    // Find the chat message container
    const chatContainer = document.querySelector(
      '[class*="chat-body"], [class*="message-list"], [class*="conversation-body"], [class*="msg-list"], [class*="chat-content"]'
    );

    const observeTarget = chatContainer || document.body;

    _observer = new MutationObserver((mutations) => {
      let hasNewMessages = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const classes = (node.className || '').toString();
              if (/message|bubble|msg|chat/i.test(classes)) {
                hasNewMessages = true;
                break;
              }
              // Check children
              if (node.querySelector && node.querySelector('[class*="message"], [class*="bubble"], [class*="msg"]')) {
                hasNewMessages = true;
                break;
              }
            }
          }
        }
        if (hasNewMessages) break;
      }

      if (hasNewMessages) {
        // Debounce to avoid scanning too frequently
        if (_observerDebounce) clearTimeout(_observerDebounce);
        _observerDebounce = setTimeout(() => {
          scanExistingMessages();
        }, 300);
      }
    });

    _observer.observe(observeTarget, {
      childList: true,
      subtree: true,
    });

    console.log('[AIECOS] MutationObserver active on:', observeTarget === document.body ? 'body' : 'chat container');
  } catch (err) {
    console.error('[AIECOS] MutationObserver setup error:', err);
  }
}

// ── Find sidebar conversation list container ────────────────────────────
function findSidebarContainer() {
  // Pancake sidebar: div chứa danh sách conversation items
  const candidates = Array.from(document.querySelectorAll('div')).filter(el => {
    try {
      const rect = el.getBoundingClientRect();
      // Sidebar thường ở trái, cao > 500px, rộng 250-500px
      return rect.left < 100 && rect.width > 200 && rect.width < 500 &&
             rect.height > 400 && el.scrollHeight > el.clientHeight;
    } catch { return false; }
  });
  // Chọn container có scrollable content lớn nhất
  return candidates.sort((a,b) => b.scrollHeight - a.scrollHeight)[0] || null;
}

// ── Scroll sidebar để load TẤT CẢ conversations ─────────────────────────
async function loadAllSidebarConversations() {
  const sidebar = findSidebarContainer();
  if (!sidebar) {
    console.log('[AIECOS] ⚠️ Sidebar container not found, skip sidebar scroll');
    return;
  }

  console.log('[AIECOS] 📜 Scrolling sidebar to load all conversations...');
  let lastHeight = sidebar.scrollHeight;
  let lastCount = document.querySelectorAll('[class*="conversation"], [class*="chat-item"]').length;
  let stableCount = 0;

  for (let i = 0; i < MAX_SIDEBAR_SCROLLS; i++) {
    sidebar.scrollTop = sidebar.scrollHeight; // scroll xuống cuối
    await new Promise(r => setTimeout(r, SIDEBAR_SCROLL_DELAY));

    const newHeight = sidebar.scrollHeight;
    const newCount = document.querySelectorAll('[class*="conversation"], [class*="chat-item"]').length;

    if (newHeight === lastHeight && newCount === lastCount) {
      stableCount++;
      if (stableCount >= 3) {
        console.log(`[AIECOS] ✓ Sidebar fully loaded after ${i+1} scrolls — no more items`);
        break;
      }
    } else {
      stableCount = 0;
      console.log(`[AIECOS] ... loaded more: height ${lastHeight}→${newHeight}, items ${lastCount}→${newCount}`);
    }
    lastHeight = newHeight;
    lastCount = newCount;
  }

  // Scroll lại lên đầu để bắt đầu walk
  sidebar.scrollTop = 0;
  await new Promise(r => setTimeout(r, 1000));
}

// ── Auto-walk all conversations (robust version) ────────────────────────
let _walkInProgress = false;

async function autoWalkConversations() {
  if (_walkInProgress) {
    console.log('[AIECOS] ⚠️ Walk already in progress, skip duplicate trigger');
    return;
  }
  _walkInProgress = true;

  try {
    console.log('[AIECOS] 🚶 Starting auto-walk — full sidebar + full history...');

    // BƯỚC 1: Scroll sidebar để load hết conversations
    await loadAllSidebarConversations();

    // BƯỚC 2: Thu thập tất cả conversation items
    const collectItems = () => {
      const allItems = Array.from(document.querySelectorAll('div, li')).filter(el => {
        try {
          const rect = el.getBoundingClientRect();
          if (rect.width < 180 || rect.height < 40 || rect.height > 140) return false;
          if (rect.left < 0 || rect.left > 500) return false;
          return el.querySelector('img') !== null ||
                 el.querySelector('[class*="name"]') !== null ||
                 el.querySelector('[class*="avatar"]') !== null;
        } catch { return false; }
      });
      return allItems.filter(el => !allItems.some(o => o !== el && el.contains(o)));
    };

    const items = collectItems();
    if (items.length === 0) {
      console.log('[AIECOS] ❌ No conversation items found');
      _walkInProgress = false;
      return;
    }

    console.log(`[AIECOS] ✓ Found ${items.length} conversations in sidebar. Walking...`);

    // BƯỚC 3: Walk qua từng conversation, resume được khi lỗi
    let successCount = 0, failCount = 0, totalScanned = 0;
    const startTime = Date.now();

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      try {
        // Scroll item vào view trước khi click (phòng khi item đã rời viewport)
        try { item.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch {}
        await new Promise(r => setTimeout(r, 300));

        item.click();
        await new Promise(r => setTimeout(r, WALK_DELAY_MS));

        // Load full lịch sử của conv này (scroll up)
        await scrollToLoadAllMessages();

        // Force scan after full load
        scanExistingMessages();
        await new Promise(r => setTimeout(r, 500));

        // Flush ngay để không dồn quá nhiều vào batch buffer
        flushBatch();
        await new Promise(r => setTimeout(r, 800));

        successCount++;
        const pct = Math.round(((idx + 1) / items.length) * 100);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`[AIECOS] ✓ ${idx + 1}/${items.length} (${pct}%) done — ${elapsed}s elapsed`);

        // Lưu progress vào storage để user biết tình trạng
        try {
          chrome.storage.local.set({
            walkProgress: { current: idx + 1, total: items.length, success: successCount, fail: failCount, updatedAt: Date.now() }
          });
        } catch {}
      } catch (err) {
        failCount++;
        console.error(`[AIECOS] ✗ Walk error at conv ${idx + 1}:`, err.message || err);
        // Tiếp tục conv kế tiếp, không break
      }
    }

    // Flush cuối
    flushBatch();
    await new Promise(r => setTimeout(r, 2000));

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`[AIECOS] 🎉 Walk completed — ${successCount} success, ${failCount} fail, ${totalTime}s total`);

    try {
      chrome.storage.local.set({
        walkProgress: { current: items.length, total: items.length, success: successCount, fail: failCount, completed: true, updatedAt: Date.now() }
      });
    } catch {}
  } catch (err) {
    console.error('[AIECOS] autoWalkConversations fatal error:', err);
  } finally {
    _walkInProgress = false;
  }
}

window.__AIECOS_WALK = autoWalkConversations;

// ── Detect conversation switch ──────────────────────────────────────────
let _lastConversationKey = '';

function checkConversationSwitch() {
  const customerName = getCustomerName();
  const key = customerName + '|' + window.location.href;

  if (key !== _lastConversationKey) {
    _lastConversationKey = key;
    console.log('[AIECOS] Conversation switched to:', customerName);

    // Re-setup observer and scan
    setTimeout(() => {
      setupMutationObserver();
      scanExistingMessages();
    }, 800);
  }
}

// ── Message listener ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'TRIGGER_SCAN') {
      scanExistingMessages();
      sendResponse({ status: 'scanned' });
    } else if (request.action === 'TRIGGER_WALK') {
      autoWalkConversations();
      sendResponse({ status: 'walking' });
    } else if (request.action === 'TRIGGER_FULL_LOAD') {
      scrollToLoadAllMessages();
      sendResponse({ status: 'loading' });
    }
  } catch (err) {
    console.error('[AIECOS] Message listener error:', err);
  }
  return true;
});

// ── Initialize ──────────────────────────────────────────────────────────
setTimeout(() => {
  setupMutationObserver();
  scanExistingMessages();
}, SCAN_DELAY);

// Periodic scan fallback (every 10s)
setInterval(() => {
  try {
    scanExistingMessages();
    checkConversationSwitch();
  } catch (err) {
    console.error('[AIECOS] Periodic scan error:', err);
  }
}, 10000);

// Flush batch on page unload
window.addEventListener('beforeunload', () => {
  flushBatch();
});

console.log('[AIECOS] Content script v4.6.0 loaded — Pancake-specific (msgID dedup + sender class + sticky date)');
