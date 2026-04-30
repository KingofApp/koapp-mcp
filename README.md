# @kingofapp/mcp

Model Context Protocol (MCP) server for [King of App](https://kingofapp.com). Gives Claude and other MCP-compatible AI assistants full control over your King of App projects: create apps, import WordPress menus, configure modules, services and metadata — all from a single conversation.

## Installation for Claude Desktop

Add this block to your `claude_desktop_config.json` (usually at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "koapp": {
      "command": "npx",
      "args": ["-y", "@kingofapp/mcp"],
      "env": {
        "KOAPP_API_URL": "https://api.kingofapp.com"
      }
    }
  }
}
```

Restart Claude Desktop after saving the file. No global install required — `npx` fetches the package automatically.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `KOAPP_API_URL` | `https://api.kingofapp.com` | King of App API base URL. Override only if you run a private instance. |

## Tools

The server exposes 15 tools:

| # | Tool | Description |
|---|---|---|
| 1 | `koapp_login` | Authenticate with King of App and obtain a JWT token required by all other tools. |
| 2 | `koapp_list_apps` | List all apps belonging to the authenticated user. |
| 3 | `koapp_list_templates` | List available app templates from the King of App market. |
| 4 | `koapp_create_app` | Create a new app from a template. |
| 5 | `koapp_get_app` | Fetch the full raw JSON of an app (modules, config, themes, services). |
| 6 | `koapp_get_app_structure` | Get a simplified module-tree view with names and internal `#/path` URLs. |
| 7 | `koapp_fetch_wp_menus` | List the menus available in a WordPress site (requires wp-api-menus or koapp-suite plugin). |
| 8 | `koapp_import_wp_menu` | Import a WordPress menu into an app: creates a menu container + one `wpembed` module per item, then sets it as the entry point. |
| 9 | `koapp_update_module_scope` | Update the configuration (scope) of any module in an app. |
| 10 | `koapp_update_menu_items` | Reorder or relink the items of a menu module. |
| 11 | `koapp_update_app_config` | Update app-level settings: entry point, language, theme colors, spinner. |
| 12 | `koapp_update_metadata` | Update store metadata: name, description, category, keywords (per locale). |
| 13 | `koapp_list_services` | List all available services in the market (push notifications, analytics, etc.). |
| 14 | `koapp_add_service` | Add a service to an app. |
| 15 | `koapp_configure_service` | Set credentials/settings for a service already added to an app. |

## Typical workflow

```
1. koapp_login            → get token
2. koapp_list_templates   → pick a template id
3. koapp_create_app       → get appId
4. koapp_fetch_wp_menus   → pick a menuTermId
5. koapp_import_wp_menu   → import menu + create modules
6. koapp_update_app_config → set colors, language, entry point
7. koapp_update_metadata  → set store name and description
8. koapp_add_service      → add push notifications
9. koapp_configure_service → set push credentials
```

## License

MIT
