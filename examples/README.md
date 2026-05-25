# Examples

Practical recipes for common tasks. All scripts assume:
- Sync receiver at `http://localhost:3500`
- Supabase REST at `http://localhost:3000` (dev) or `https://<project>.supabase.co/rest/v1` (cloud)
- Environment vars set in your shell:
  ```bash
  export API_TOKEN="dev-token-change-me-in-prod"
  export SUPABASE_URL="http://localhost:3000"
  export SUPABASE_KEY="your-anon-key"
  export SCHEMA="aiecos_social"
  ```

## Files

| File | Purpose |
|---|---|
| `curl-test-sync.sh` | POST a sample message into the sync receiver |
| `curl-query-rest.sh` | Read pages / customers / messages via PostgREST |
| `curl-wipe-data.sh` | TRUNCATE all data (dev only — destructive) |
| `sample-batch-payload.json` | Example BATCH payload that Chrome extension sends |
| `mcp-prompts.md` | Example prompts for Claude using the MCP server |
| `seed-demo-data.sh` | Inject 5 demo partners with synthetic conversation history |

## Quick test loop

```bash
# 1. Boot stack
docker compose up -d

# 2. Verify sync receiver alive
curl http://localhost:3500/api/status

# 3. Inject a test message
bash examples/curl-test-sync.sh

# 4. Query it back
bash examples/curl-query-rest.sh

# 5. (Optional) Seed full demo data
bash examples/seed-demo-data.sh

# 6. Open admin UI
open http://localhost:8080
```
