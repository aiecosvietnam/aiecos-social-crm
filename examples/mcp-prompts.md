# MCP Example Prompts

Real-world prompts to use with Claude after registering the MCP server. See [docs/MCP_USAGE.md](../docs/MCP_USAGE.md) for the full tool reference.

## 1 — Health check / sanity

> *Use MCP aiecos-social-crm: show me the summary*

Returns: total pages, partners, messages, sender ratio, latest activity timestamp. Run this first to confirm wiring.

---

## 2 — Daily standup

> *aiecos-social-crm: cho tôi xem 20 tin nhắn gần nhất + breakdown sender_type customer vs agent trong 24h qua*

Combines `recent_activity` + `summary`. Useful for "what happened overnight?"

---

## 3 — Find revenue at risk

> *aiecos-social-crm: list partners that went silent for 7-21 days, sorted by days silent ascending. For top 3, also fetch their last 5 messages.*

Combines `get_at_risk_partners` (min_days=7 max_days=21) + `get_partner_messages` for each. Surfaces partners just slipping into At-Risk — highest revival chance.

---

## 4 — Weekly competitor / topic monitor

> *aiecos-social-crm: search messages containing the word "competitor" or "khuyến mãi" in the last 14 days. Group by partner.*

Uses `search_messages` twice. Use this to detect when partners mention rivals or ask about promos.

---

## 5 — Pipeline health check

> *aiecos-social-crm: give me pipeline_stats. Then for the dormant + churned segments, identify which 3 partners I should prioritize re-engaging based on past message volume.*

Combines `pipeline_stats` + `top_partners_by_volume` filtered to dormant/churned.

---

## 6 — Demo data / first-time exploration

> *aiecos-social-crm: walk me through what's in the system right now — list all partners with their stages, then show recent activity for the most active one.*

Good prompt for new users to explore.

---

## 7 — Lead qualification (with AI reasoning)

> *aiecos-social-crm: for the top 5 partners by msg volume this week, fetch their last 10 messages each. Then tell me which 2 seem most likely to be ready for an upsell call based on tone and topics.*

LLM does qualitative analysis on raw conversation history. The MCP supplies the data; Claude does the reasoning.

---

## 8 — Drafting a re-engagement campaign

> *aiecos-social-crm: list 10 dormant partners. For each, draft a personalized Vietnamese WhatsApp message to win them back. Use info from their last 3 messages.*

Multi-step: pull data → personalize per partner → write copy.

---

## Tips

- **Be specific about thresholds.** Default tool args may not match your use case. Say "7 days" not "recent".
- **Chain tools.** Claude is allowed to call multiple MCP tools in one turn — let it.
- **Ask for analysis, not just dumps.** "Tell me X" produces better output than "list X".
- **Reference the schema.** When debugging, ask *"what fields does the customer record have?"* — Claude will show you.

## Anti-patterns (what to avoid)

- ❌ "Show me everything" — too vague, will hit limits
- ❌ "Insert this lead" — MCP is read-only by design
- ❌ "Update partner X status" — write operations go through sync receiver, not MCP
