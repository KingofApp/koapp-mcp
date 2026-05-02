# Tools Reference

Complete parameter reference for all 20 King of App MCP tools.

> **Token:** All tools accept an optional `token` parameter. If omitted, the server uses the token cached from the last `koapp_login` call in the same session.

---

## koapp_get_creation_guide

Returns the full conversational flow and rules for building an app. **Always call this first** when a user asks to create or build an app.

**Params:** none

**Returns:** JSON with `conversational_flow`, `building_sequence` (10 steps), `critical_rules`, `edit_loop`, `services_guide`.

---

## koapp_list_menu_types

Returns the 6 available menu module types with descriptions.

**Params:** none

**Returns:**
```json
{
  "menu_types": [
    { "identifier": "bottommenu", "name": "Bottom Tab Bar", "description": "..." },
    { "identifier": "scaffoldingmenu", "name": "Side Drawer", "description": "..." },
    ...
  ],
  "default": "bottommenu"
}
```

---

## koapp_login

Authenticate with King of App. Token is cached server-side.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | ✅ | Account email |
| `password` | string | ✅ | Account password (hashed with SHA-1 before sending) |

**Returns:** `{ token, userId, note }`

---

## koapp_list_apps

List apps for the authenticated user, 20 per page.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | Optional if already logged in |
| `page` | number | — | Page number, default 1 (20 apps/page) |

**Returns:** `{ page, totalPages, totalItems, apps: [{ id, name, type, platforms, updatedAt }] }`

> The account may have 200+ apps. Use `koapp_get_app` with a known ID instead of paginating.

---

## koapp_create_app

Create a new app from a template.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `name` | string | ✅ | Display name |
| `templateId` | string | — | Template `_id`. Defaults to Starter Blank (`5a3ba7b7fb42884fdf30c154`) |

**Returns:** `{ appId, message, note }`

---

## koapp_get_app

Fetch the full raw app object.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |

**Returns:** Full app object including `modules`, `config`, `metadata`, `services`.

---

## koapp_get_app_structure

Simplified view of the module tree with internal navigation URLs.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |

**Returns:**
```json
{
  "appName": "My App",
  "configIndex": "/bottommenu-ABC/superhtml-XYZ",
  "totalModules": 5,
  "structure": [
    {
      "name": "Menu", "path": "/bottommenu-ABC", "internalUrl": "#/bottommenu-ABC",
      "type": "container", "identifier": "bottommenu",
      "children": [
        { "name": "Home", "path": "/bottommenu-ABC/superhtml-XYZ", "internalUrl": "#/bottommenu-ABC/superhtml-XYZ" }
      ]
    }
  ]
}
```

---

## koapp_list_modules

List all 269 modules available in the King of App market.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `filter` | string | — | Substring filter on identifier or name (case-insensitive) |

**Returns:** `{ count, total, modules: [{ id, identifier, name, price }] }`

**Useful identifiers:** `superhtml`, `html`, `wpembed`, `bottommenu`, `scaffoldingmenu`, `lateralboxps`

---

## koapp_list_templates

List available app templates from the market.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |

**Returns:** `{ count, templates: [{ id, name, type }] }`

---

## koapp_add_screen

Add a new screen (module) to an app. Automatically attaches it to a menu if `menuPath` is provided.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `name` | string | ✅ | Screen display name |
| `htmlContent` | string | — | HTML for the screen (`scope.code` in superhtml) |
| `menuPath` | string | — | Parent menu path. Omit for root-level modules (e.g. the menu itself) |
| `moduleIdentifier` | string | — | Module type. Default: `superhtml`. Use `koapp_list_modules` to find others |

**Returns:** `{ message, modulePath, internalUrl, moduleIdentifier, attachedToMenu }`

> To add the main menu, call without `menuPath`. Save the returned `modulePath` for subsequent screen additions.

---

## koapp_update_module

Edit the HTML content of an existing superhtml screen.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `modulePath` | string | ✅ | Module path (e.g. `/bottommenu-ABC/superhtml-XYZ`) |
| `htmlContent` | string | ✅ | New complete self-contained HTML |
| `name` | string | — | New screen name (optional) |

**Returns:** `{ message, modulePath, name }`

---

## koapp_update_module_scope

Update any field in a module's scope (general-purpose).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `modulePath` | string | ✅ | Module path |
| `scope` | object | ✅ | Fields to merge into the module's scope |

---

## koapp_update_menu_items

Update the ordered list of items in a menu module.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `menuPath` | string | ✅ | Path of the menu module |
| `menuItems` | array | ✅ | `[{ path: "/bottommenu-ABC/superhtml-XYZ" }, ...]` |

---

## koapp_update_app_config

Update app-level configuration.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `config.index` | string | — | Entry point module path |
| `config.lang` | string[] | — | Language codes, e.g. `["en_US", "es_ES"]` |
| `config.colors.primaryColor` | string | — | Hex color |
| `config.colors.accentColor` | string | — | Hex color |
| `config.colors.backgroundColor` | string | — | Hex color |
| `config.colors.primaryTextColor` | string | — | Hex color |
| `config.spinner` | object | — | `{ identifier, path, name }` |

---

## koapp_update_metadata

Update store metadata. Can be called multiple times with different locales.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `locale` | string | — | Locale code, default `en_US` |
| `name` | string | — | App name |
| `nameMarket` | string | — | Store name (max 30 chars for iOS) |
| `description` | string | — | Full description |
| `descriptionShort` | string | — | Subtitle / short description |
| `category` | string | — | Common category |
| `keywords` | string[] | — | Store keywords |
| `ios.primary_category` | string | — | iOS App Store category (e.g. `Games`, `Reference`) |
| `ios.secondary_category` | string | — | iOS secondary category |
| `android.primary_category` | string | — | Google Play category (e.g. `Games`) |
| `android.content_rating` | string | — | e.g. `Everyone`, `Teen`, `Mature 17+` |

---

## koapp_generate_icon

Generate app icon and splash screen using AI (pollinations.ai, free, no API key).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `iconPrompt` | string | ✅ | Describe the icon: style, colors, concept |
| `splashPrompt` | string | — | Describe the splash screen (defaults to iconPrompt variant) |
| `setSplash` | boolean | — | Also set splash screen image, default `true` |

**Returns:** `{ message, iconUrl, splashUrl }`

**How it works:** Constructs a `https://image.pollinations.ai/prompt/...` URL and saves it to `config.images.icon` via PATCH. The image is generated on-demand at render time (1024×1024 for icon, 1242×2688 for splash).

---

## koapp_list_services

List all available services in the King of App market.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |

**Returns:** `{ count, services: [{ identifier, name, price, configFields }] }`

**Common identifiers:** `koapushnotifications`, `googleanalytics`, `simpleregisterlogin`, `apple`

---

## koapp_add_service

Add a service to an app.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `serviceIdentifier` | string | ✅ | Service identifier from `koapp_list_services` |

**Returns:** `{ message, configFields: [{ key, label, type }], note }`

> `configFields` tells you which keys to pass to `koapp_configure_service`.

---

## koapp_configure_service

Set credentials or settings for a service already added to an app.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `serviceIdentifier` | string | ✅ | Service identifier |
| `scope` | object | ✅ | Key-value pairs (use `configFields` from `koapp_add_service` as reference) |

---

## koapp_fetch_wp_menus

List menus available on a WordPress site.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `wpUrl` | string | ✅ | Base URL of the WordPress site |

**Requires:** wp-api-menus or koapp-suite plugin installed on the WP site.

**Returns:** `{ count, menus: [{ term_id, name, count, itemsUrl }] }`

---

## koapp_import_wp_menu

Import a WordPress menu into an app — creates menu module + wpembed screens automatically.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | — | |
| `appId` | string | ✅ | App ID |
| `wpUrl` | string | ✅ | WordPress base URL |
| `menuTermId` | number | ✅ | `term_id` from `koapp_fetch_wp_menus` |
| `menuType` | enum | — | `bottommenu` \| `scaffoldingmenu` \| `polymermenu` \| `slidemenu`. Default: `bottommenu` |
| `queryParam` | string | — | Optional query param for koa embed plugin (e.g. `koaembed=1`) |

**Returns:** `{ message, appId, menuPath, internalMenuUrl, itemsImported, structure }`
