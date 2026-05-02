# King of App MCP Server

MCP (Model Context Protocol) server that lets AI assistants like Claude create, configure and manage mobile apps on the [King of App](https://kingofapp.com) platform — from a single conversation.

**Live server:** `https://mcp.kingofapp.com/mcp`

---

## What it does

Connect this server to Claude and you can say *"create an arcade tic-tac-toe game app"* — Claude will call the tools in sequence to build the complete app: create it, generate the icon with AI, set up screens with HTML/JS, configure the menu and store metadata, all automatically.

---

## Architecture

```
┌─────────────────┐     MCP (HTTP/SSE)     ┌──────────────────────┐
│  Claude / AI    │ ─────────────────────► │  koapp-mcp server    │
│  (claude.ai,    │                        │  (Express + MCP SDK) │
│  Claude Desktop)│ ◄───────────────────── │  mcp.kingofapp.com   │
└─────────────────┘     tool results       └──────────┬───────────┘
                                                       │ REST API
                                                       ▼
                                           ┌──────────────────────┐
                                           │  api.kingofapp.com   │
                                           └──────────────────────┘
```

### Source files

| File | Purpose |
|------|---------|
| `src/server.js` | Express HTTP server, MCP transport (Streamable HTTP + legacy SSE) |
| `src/tools.js` | All 20 tool definitions, handlers, session token cache |
| `src/koapp-api.js` | King of App REST API client (auth, apps, modules, services) |

### MCP transports

| Transport | Endpoint | Used by |
|-----------|----------|---------|
| Streamable HTTP | `POST /mcp` | claude.ai, modern clients |
| Legacy SSE | `GET /sse` + `POST /messages` | Claude Desktop older configs |

Each `initialize` request creates a new `McpServer` instance with its own session ID, stored in memory.

### Token caching

1. Client calls `koapp_login` with email + password
2. Server hashes password with SHA-1, calls King of App `POST /login`
3. JWT is stored in a module-level `cachedToken` variable
4. All subsequent tools read from `cachedToken` — clients never need to pass the token again

---

## Tools

See [docs/TOOLS.md](docs/TOOLS.md) for full parameter reference.

### Workflow guide
| Tool | Description |
|------|-------------|
| `koapp_get_creation_guide` | Full conversational flow + step-by-step build sequence. Call first when creating any app. |
| `koapp_list_menu_types` | Available menu types with descriptions |

### Auth & Apps
| Tool | Description |
|------|-------------|
| `koapp_login` | Authenticate — token cached server-side for the session |
| `koapp_list_apps` | List user apps, 20 per page (use `page` param to navigate) |
| `koapp_create_app` | Create app from a template (default: Starter Blank) |
| `koapp_get_app` | Full raw app object including modules, config, services |
| `koapp_get_app_structure` | Simplified module tree with internal `#/path` URLs |

### Modules & Screens
| Tool | Description |
|------|-------------|
| `koapp_list_modules` | All 269 market modules — use `filter` to search |
| `koapp_add_screen` | Add a superhtml (or any) screen, auto-attached to a menu |
| `koapp_update_module` | Edit the HTML content of an existing superhtml screen |
| `koapp_update_module_scope` | Update any field in a module's scope object |
| `koapp_update_menu_items` | Reorder or relink menu items |

### App Configuration
| Tool | Description |
|------|-------------|
| `koapp_update_app_config` | Colors, language, entry point (`config.index`) |
| `koapp_update_metadata` | Name, description, keywords, iOS/Android store fields |
| `koapp_generate_icon` | AI-generated icon + splash via pollinations.ai (no API key needed) |
| `koapp_list_templates` | Available templates from the market |

### Services
| Tool | Description |
|------|-------------|
| `koapp_list_services` | All available services (push notifications, analytics, etc.) |
| `koapp_add_service` | Add a service to an app |
| `koapp_configure_service` | Set credentials/config for an added service |

### WordPress Import
| Tool | Description |
|------|-------------|
| `koapp_fetch_wp_menus` | List menus from a WordPress site (requires wp-api-menus plugin) |
| `koapp_import_wp_menu` | Import WP menu → creates menu module + one wpembed per item |

---

## App creation flow

When a user asks to build an app, Claude calls `koapp_get_creation_guide` to get the flow, then executes it:

```
1.  koapp_login
2.  koapp_create_app              → appId
3.  koapp_update_metadata         → name, description, keywords, iOS/Android categories
3b. koapp_generate_icon           → AI icon + splash (pollinations.ai)
4.  koapp_update_app_config       → colors, language
5.  koapp_add_screen (menu)       → root menu module → menuPath
6.  koapp_update_app_config       → config.index = menuPath
7.  koapp_add_screen × N          → one superhtml screen per page, attached to menu
8.  koapp_add_service (optional)  → push notifications, analytics
9.  koapp_configure_service       → service credentials
10. koapp_get_app_structure       → verify result
```

### Superhtml screens

All custom screens use the `superhtml` module (`identifier: superhtml`, id `5cb49ba408260f132cec2a2c`).

- HTML goes in `scope.code`
- Must be fully self-contained — styles in `<style>`, scripts in `<script>`
- Mobile-first: `max-width: 430px`
- Scores/state: use `localStorage`

---

## Connect to Claude

### claude.ai

1. Settings → Integrations → Add MCP server
2. URL: `https://mcp.kingofapp.com/mcp`
3. If `MCP_SECRET` is set: add header `x-mcp-secret: <value>`

### Claude Desktop

```json
{
  "mcpServers": {
    "koapp": {
      "url": "https://mcp.kingofapp.com/sse"
    }
  }
}
```

### Via npx (local stdio)

```json
{
  "mcpServers": {
    "koapp": {
      "command": "npx",
      "args": ["-y", "@kingofapp/mcp"],
      "env": { "KOAPP_API_URL": "https://api.kingofapp.com" }
    }
  }
}
```

---

## Deploy

### Requirements

- Node.js 18+
- PM2
- nginx with SSL (reverse proxy to port 3000)

### Install & run

```bash
git clone https://github.com/KingofApp/koapp-mcp.git
cd koapp-mcp
npm install
pm2 start src/server.js --name koapp-mcp
pm2 save
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `KOAPP_API_URL` | `https://api.kingofapp.com` | King of App API base URL |
| `MCP_SECRET` | *(none)* | Optional shared secret — clients send `x-mcp-secret` header |

### Deploy update

```bash
scp -i "key.pem" src/*.js ubuntu@mcp.kingofapp.com:/opt/koapp-mcp/src/
ssh -i "key.pem" ubuntu@mcp.kingofapp.com "pm2 restart koapp-mcp --update-env"
```

---

## API notes

### King of App API quirks

- **Auth header:** `x-access-token: <jwt>` — not `Authorization: Bearer`
- **`GET /apps/:id`** returns an array `[app]`, not a single object
- **`PATCH /apps/:id`** fails if body includes `_id` — stripped before every call
- **Pagination:** all list endpoints return `{ result: [...], totalItems: N }`, 20 items per page
- **Modules:** 269 total, paginated with `?page=N` — fetched sequentially
- **Apps:** 200+ in the account, paginated — use `koapp_get_app` directly with a known ID

### Icon generation

Icons use [pollinations.ai](https://image.pollinations.ai) — free, no auth:

```
https://image.pollinations.ai/prompt/<encoded-prompt>?width=1024&height=1024&nologo=true&model=flux
```

The URL is saved in `config.images.icon` via PATCH. King of App renders it from the URL directly.

---

## Health check

```
GET https://mcp.kingofapp.com/health
→ { "status": "ok", "version": "1.0.1", "activeSessions": 2 }
```

---

## License

MIT
