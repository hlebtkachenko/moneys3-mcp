# Authentication Setup

## 1. Get credentials from Money S3

1. Open your Money S3 desktop application
2. Go to **S3Api settings** (or the administration portal at money.cz)
3. Register a new application to get your **AppId**
4. Create an **API Key** for the application — this gives you a `client_id` and `client_secret`
5. Note your Money S3 **domain** (the subdomain used for the API, e.g. `yourcompany`)

### About the AppId

The AppId you get from the money.cz portal is already URL-encoded. It contains characters like `%3D`, `%2B`, `%2F`. Store it exactly as provided — do not decode or re-encode it. The code passes it directly into the token URL.

## 2. Auth flow

The server uses **OAuth2 client_credentials** grant. On startup it requests a bearer token from:

```
https://{domain}.api.moneys3.eu/connect/token?AppId={appId}
```

with `client_id` and `client_secret` as form-encoded body parameters. The token is refreshed automatically before expiry.

## 3. Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONEYS3_DOMAIN` | Yes | Your S3 API subdomain (e.g. `yourcompany`) |
| `MONEYS3_APP_ID` | Yes | AppId from money.cz portal — keep URL-encoding intact |
| `MONEYS3_CLIENT_ID` | Yes | Client ID from the API Key |
| `MONEYS3_CLIENT_SECRET` | Yes | Client secret from the API Key |
| `MONEYS3_AGENDA_GUID` | No | Lock the server to a specific agenda (GUID) |
| `MONEYS3_CACHE_TTL` | No | Cache TTL in seconds (default: 120) |

## 4. Configure in Claude Code (`~/.claude.json`)

Add to the `mcpServers` section:

```json
{
  "mcpServers": {
    "moneys3": {
      "command": "node",
      "args": ["/path/to/moneys3-mcp/dist/index.js"],
      "env": {
        "MONEYS3_DOMAIN": "YOUR_DOMAIN",
        "MONEYS3_APP_ID": "YOUR_APP_ID",
        "MONEYS3_CLIENT_ID": "YOUR_CLIENT_ID",
        "MONEYS3_CLIENT_SECRET": "YOUR_CLIENT_SECRET"
      }
    }
  }
}
```

## 5. Configure in Cursor

Go to **Settings > MCP Servers** and add a new server with the same structure, or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "moneys3": {
      "command": "node",
      "args": ["/path/to/moneys3-mcp/dist/index.js"],
      "env": {
        "MONEYS3_DOMAIN": "YOUR_DOMAIN",
        "MONEYS3_APP_ID": "YOUR_APP_ID",
        "MONEYS3_CLIENT_ID": "YOUR_CLIENT_ID",
        "MONEYS3_CLIENT_SECRET": "YOUR_CLIENT_SECRET"
      }
    }
  }
}
```

## 6. Troubleshooting

**"AppId is not valid"** — The most common cause is that the AppId was decoded or re-encoded. The value from money.cz already contains URL-encoded characters (`%3D`, `%2B`, `%2F`). Store it as-is in the environment variable. Do not wrap it in quotes that might trigger shell interpolation.

**401 Unauthorized** — Verify `MONEYS3_CLIENT_ID` and `MONEYS3_CLIENT_SECRET` are correct. Check that the API Key is active in Money S3.

**404 Not Found** — Verify `MONEYS3_DOMAIN` is correct and the S3Api service is running on the server.
