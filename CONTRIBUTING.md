# Contributing to AIECOS Social CRM

Thanks for considering a contribution! This guide explains how to file issues, propose changes, and ship code.

## Quick links

- 🐛 **Bug?** [Open an issue](https://github.com/aiecosvietnam/aiecos-social-crm/issues/new) with: steps to reproduce, expected vs actual, screenshot if UI bug
- 💡 **Feature idea?** [Open a discussion](https://github.com/aiecosvietnam/aiecos-social-crm/discussions) first — saves wasted PR effort
- 🚀 **Ready to code?** Fork → branch → PR (see below)

## Setting up dev environment

```bash
git clone https://github.com/<your-fork>/aiecos-social-crm.git
cd aiecos-social-crm
cp .env.example .env
docker compose up -d                    # boots full stack
bash examples/seed-demo-data.sh         # demo data
open http://localhost:8080              # admin UI
```

## Repo layout

| Folder | What lives here | Stack |
|---|---|---|
| `chrome-extension/` | Pancake DOM scraper | JS (Manifest V3) |
| `sync-receiver/` | Receives messages, writes to DB | Node.js + Express |
| `mcp-server/` | Query DB via MCP for AI agents | Node.js + MCP SDK |
| `admin-ui/` | Single-file HTML dashboard | Vanilla JS + Chart.js + Lucide |
| `examples/` | curl scripts + demo data + MCP prompts | Bash + JSON |
| `docs/` | Architecture, deploy, MCP usage | Markdown |

## Coding standards

- **JS**: ES2022, no transpilation. Run `node --check` before commit.
- **CSS**: Vanilla, no framework. Use CSS variables (`var(--accent)`) not hex codes.
- **Style**: Match surrounding code. We don't enforce Prettier (yet).
- **Commits**: Conventional-ish — `feat:`, `fix:`, `docs:`, `chore:`. Short subject + bullet body.
- **No emoji** in UI code (use Lucide icons via `<i data-lucide="name">`).

## CI checks (must pass)

Every PR runs:
1. **Syntax check** — `node --check` all `.js`, JSON valid, manifest V3 valid
2. **Install + smoke test** — `npm install` sync-receiver + mcp-server, boot check
3. **Docker build** — sync-receiver image builds
4. **Secret scan** — no leaked JWT / passwords / internal identifiers

See `.github/workflows/ci.yml` for exact checks.

## PR workflow

```bash
# 1. Fork on GitHub, then:
git clone https://github.com/<you>/aiecos-social-crm.git
cd aiecos-social-crm
git remote add upstream https://github.com/aiecosvietnam/aiecos-social-crm.git

# 2. Branch
git checkout -b feat/your-change

# 3. Code + test locally
docker compose up -d
# ...make changes...
node --check sync-receiver/server.js
bash examples/curl-test-sync.sh   # smoke test

# 4. Commit
git add .
git commit -m "feat: add X to Y

- Bullet 1
- Bullet 2"

# 5. Push + open PR
git push origin feat/your-change
# → GitHub: open PR against aiecosvietnam/aiecos-social-crm main
```

PRs without:
- Clear description of *why* the change is needed
- Screenshot/GIF for UI changes
- Update to docs if behavior changes

...will get asked for these before review.

## What contributions are welcome

### Hot list (good first PRs)

- **New MCP tools** — e.g. `get_first_message_of(partner)`, `sentiment_score(query)`
- **Admin UI modules** — e.g. Notes, Tags manager, Bulk-action toolbar
- **Channel adapters** — e.g. WhatsApp Web scraper, Telegram bot integration
- **Reports** — e.g. PDF export, weekly email digest
- **i18n** — English / Indonesian / Thai translations

### Higher bar (discuss first)

- Schema changes — breaks existing deploys
- Switching frameworks (Vue/React) — defeats "single-file HTML" philosophy
- Removing demo mode — it's the on-ramp for new users

## What we won't accept

- Bundlers / build tools that require `npm run build`
- Tracking / analytics calls home
- Hard dependencies on paid services
- Features that scrape data outside the user's own Pancake account

## Code of conduct

Be kind. Disagree about ideas, not people. Vietnamese, English, and code-switching all welcome in issues/PRs.

## Maintainers

- **[@aiecosvietnam](https://github.com/aiecosvietnam)** — AIECOS team

Reach: open an issue, or email via [aiecos.ai](https://aiecos.ai).

---

Cảm ơn anh/chị 🙏 — mỗi PR / issue / star đều giúp project tốt hơn.
