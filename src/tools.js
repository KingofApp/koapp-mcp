/**
 * King of App MCP Tools
 * All 15 tools registered on any McpServer instance passed in.
 * Shared between stdio (dev) and HTTP+SSE (production) transports.
 */

import { z } from 'zod';
import {
  login, getApps, getApp, createApp, patchApp, getTemplates,
  getModules, getServices, fetchWPMenuList, fetchWPMenuItems,
  buildModulesFromWPMenu, mergeModulesIntoApp, extractAppStructure
} from './koapp-api.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(data) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
  };
}
function err(message) {
  return { content: [{ type: 'text', text: `❌ Error: ${message}` }], isError: true };
}
async function safe(fn) {
  try { return ok(await fn()); }
catch (e) { return err(e.response?.data?.message || JSON.stringify(e.response?.data) || e.message || String(e)); }}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerTools(server) {

  // ── 1. koapp_login ──────────────────────────────────────────────────────────
  server.tool('koapp_login',
    'Authenticate with King of App using email and password. Returns a JWT token required for all other tools. Call this first.',
    {
      email:    z.string().email().describe('King of App account email'),
      password: z.string().describe('King of App account password')
    },
    async ({ email, password }) => safe(async () => {
      const result = await login(email, password);
      return { message: '✅ Login successful', token: result.token, userId: result.userId,
               note: 'Save the token — you will need it for all subsequent calls' };
    })
  );

  // ── 2. koapp_list_apps ──────────────────────────────────────────────────────
  server.tool('koapp_list_apps',
    'List all apps belonging to the authenticated user.',
    { token: z.string().describe('JWT token from koapp_login') },
    async ({ token }) => safe(async () => {
      const apps = await getApps(token);
      return {
        count: apps.length,
        apps: apps.map(a => ({
          id: a._id?.$oid || a._id,
          name: a.config?.images?.name || a.metadata?.common?.localised?.en_US?.name || '(no name)',
          type: a.type,
          platforms: a.platforms,
          updatedAt: a.updatedAt?.$date || a.updatedAt
        }))
      };
    })
  );

  // ── 3. koapp_list_templates ─────────────────────────────────────────────────
  server.tool('koapp_list_templates',
    'List available app templates from the King of App market. Use template _id when calling koapp_create_app.',
    { token: z.string().describe('JWT token from koapp_login') },
    async ({ token }) => safe(async () => {
      const templates = await getTemplates(token);
      return { count: templates.length,
               templates: templates.map(t => ({ id: t._id?.$oid || t._id, name: t.name || '(no name)', type: t.type })) };
    })
  );

  // ── 4. koapp_create_app ─────────────────────────────────────────────────────
  server.tool('koapp_create_app',
    'Create a new app in King of App from a template. Returns the new app ID needed for subsequent operations.',
    {
      token:      z.string().describe('JWT token from koapp_login'),
      templateId: z.string().describe('_id of the template to use (get from koapp_list_templates)'),
      name:       z.string().describe('Display name for the new app')
    },
    async ({ token, templateId, name }) => safe(async () => {
      const result = await createApp(token, templateId, name);
      return { message: '✅ App created successfully', appId: result.appId,
               note: 'Use this appId in all subsequent calls' };
    })
  );

  // ── 5. koapp_get_app ────────────────────────────────────────────────────────
  server.tool('koapp_get_app',
    'Get the full raw data of an app including modules, config, themes and services.',
    {
      token: z.string().describe('JWT token from koapp_login'),
      appId: z.string().describe('App ID')
    },
    async ({ token, appId }) => safe(async () => getApp(token, appId))
  );

  // ── 6. koapp_get_app_structure ──────────────────────────────────────────────
  server.tool('koapp_get_app_structure',
    'Get a simplified view of the app module structure: names, internal #/path URLs and hierarchy.',
    {
      token: z.string().describe('JWT token from koapp_login'),
      appId: z.string().describe('App ID')
    },
    async ({ token, appId }) => safe(async () => {
      const app = await getApp(token, appId);
      return {
        appName: app.metadata?.common?.localised?.en_US?.name || '(no name)',
        configIndex: app.config?.index,
        totalModules: Object.keys(app.modules || {}).length,
        structure: extractAppStructure(app.modules)
      };
    })
  );

  // ── 7. koapp_fetch_wp_menus ─────────────────────────────────────────────────
  server.tool('koapp_fetch_wp_menus',
    'Fetch the list of menus available in a WordPress site. Requires wp-api-menus or koapp-suite plugin on the WP.',
    { wpUrl: z.string().url().describe('Base URL of the WordPress site (e.g. https://myclient.com)') },
    async ({ wpUrl }) => safe(async () => {
      const menus = await fetchWPMenuList(wpUrl);
      return {
        wpUrl, count: menus.length,
        menus: menus.map(m => ({ term_id: m.term_id, name: m.name, count: m.count, itemsUrl: m.items_url })),
        note: 'Use term_id in koapp_import_wp_menu'
      };
    })
  );

  // ── 8. koapp_import_wp_menu ─────────────────────────────────────────────────
  server.tool('koapp_import_wp_menu',
    `Import a WordPress menu into a King of App app. This tool:
1. Fetches menu items from the WordPress REST API
2. Creates a menu container module in the app
3. Creates a wpembed module for each menu item pointing to its WordPress URL
4. Updates the app via PATCH /apps/:id
5. Sets the imported menu as the app entry point (config.index)
Returns the updated module structure with internal URLs for each screen.`,
    {
      token:      z.string().describe('JWT token from koapp_login'),
      appId:      z.string().describe('App ID to import the menu into'),
      wpUrl:      z.string().url().describe('Base URL of the WordPress site'),
      menuTermId: z.number().describe('term_id of the WordPress menu to import (from koapp_fetch_wp_menus)'),
      menuType:   z.enum(['bottommenu','scaffoldingmenu','polymermenu','slidemenu'])
                   .default('bottommenu').describe('King of App menu module type to use as container'),
      queryParam: z.string().optional().describe('Optional query param for koa embed plugin (e.g. koaembed=1)')
    },
    async ({ token, appId, wpUrl, menuTermId, menuType, queryParam }) => safe(async () => {
      const [appData, menuItems, allModules] = await Promise.all([
        getApp(token, appId),
        fetchWPMenuItems(wpUrl, menuTermId, queryParam),
        getModules(token)
      ]);

      if (!menuItems?.length) throw new Error(`No menu items found for term_id ${menuTermId} in ${wpUrl}`);

      const menuTemplate   = allModules.find(m => m.identifier === menuType);
      const embedTemplate  = allModules.find(m => m.identifier === 'wpembed');
      if (!menuTemplate)  throw new Error(`Menu module "${menuType}" not found in market`);
      if (!embedTemplate) throw new Error('wpembed module not found in market');

      const { modules: newModules, menuPath } = buildModulesFromWPMenu(menuTemplate, embedTemplate, menuItems, wpUrl);
      const updatedApp = mergeModulesIntoApp(appData, newModules, menuPath);
      await patchApp(token, appId, updatedApp);

      return {
        message: '✅ WordPress menu imported successfully',
        appId, menuPath,
        internalMenuUrl: '#' + menuPath,
        itemsImported: menuItems.length,
        structure: extractAppStructure(updatedApp.modules),
        note: 'Each item has an internalUrl you can use for HTML linking.'
      };
    })
  );

  // ── 9. koapp_update_module_scope ────────────────────────────────────────────
  server.tool('koapp_update_module_scope',
    'Update the scope (configuration) of a specific module. Use to change the URL of a wpembed, update menu items, or any module setting.',
    {
      token:       z.string().describe('JWT token from koapp_login'),
      appId:       z.string().describe('App ID'),
      modulePath:  z.string().describe('Module path key (e.g. /bottommenu-MYGs2/wpembed-t9sRf)'),
      scope:       z.record(z.any()).describe('Scope fields to merge into the module')
    },
    async ({ token, appId, modulePath, scope }) => safe(async () => {
      const appData = await getApp(token, appId);
      if (!appData.modules?.[modulePath]) throw new Error(`Module "${modulePath}" not found`);
      appData.modules[modulePath].scope = { ...appData.modules[modulePath].scope, ...scope };
      await patchApp(token, appId, appData);
      return { message: `✅ Module ${modulePath} updated`, updatedScope: appData.modules[modulePath].scope };
    })
  );

  // ── 10. koapp_update_menu_items ─────────────────────────────────────────────
  server.tool('koapp_update_menu_items',
    'Update the items of a menu module. Use to add, remove, reorder or relink menu entries to internal app URLs.',
    {
      token:     z.string().describe('JWT token from koapp_login'),
      appId:     z.string().describe('App ID'),
      menuPath:  z.string().describe('Path of the menu module (e.g. /bottommenu-MYGs2)'),
      menuItems: z.array(z.object({
        path: z.string().describe('Internal app path of the target module')
      })).describe('Ordered array of menu items')
    },
    async ({ token, appId, menuPath, menuItems }) => safe(async () => {
      const appData = await getApp(token, appId);
      if (!appData.modules?.[menuPath]) throw new Error(`Menu "${menuPath}" not found`);
      appData.modules[menuPath].scope = { ...appData.modules[menuPath].scope, menuItems };
      await patchApp(token, appId, appData);
      return { message: `✅ Menu ${menuPath} updated with ${menuItems.length} items`, menuItems };
    })
  );

  // ── 11. koapp_update_app_config ─────────────────────────────────────────────
  server.tool('koapp_update_app_config',
    'Update app-level config: colors, language, spinner, entry point module.',
    {
      token:  z.string().describe('JWT token from koapp_login'),
      appId:  z.string().describe('App ID'),
      config: z.object({
        index:   z.string().optional().describe('Path of the module to use as app entry point'),
        lang:    z.array(z.string()).optional().describe('Language codes e.g. ["es_ES","en_US"]'),
        colors:  z.object({
          primaryColor:     z.string().optional(),
          accentColor:      z.string().optional(),
          backgroundColor:  z.string().optional(),
          primaryTextColor: z.string().optional()
        }).optional(),
        spinner: z.object({ identifier: z.string(), path: z.string(), name: z.string() }).optional()
      })
    },
    async ({ token, appId, config }) => safe(async () => {
      const appData = await getApp(token, appId);
      appData.config = {
        ...appData.config, ...config,
        colors: config.colors ? { ...appData.config?.colors, ...config.colors } : appData.config?.colors
      };
      await patchApp(token, appId, appData);
      return { message: '✅ App config updated', config: appData.config };
    })
  );

  // ── 12. koapp_update_metadata ───────────────────────────────────────────────
  server.tool('koapp_update_metadata',
    'Update app metadata: name, description, category, keywords shown in the stores.',
    {
      token:            z.string().describe('JWT token from koapp_login'),
      appId:            z.string().describe('App ID'),
      locale:           z.string().default('en_US').describe('Locale code e.g. en_US, es_ES'),
      name:             z.string().optional(),
      nameMarket:       z.string().optional().describe('Name shown in the store'),
      description:      z.string().optional(),
      descriptionShort: z.string().optional(),
      category:         z.string().optional(),
      keywords:         z.array(z.string()).optional()
    },
    async ({ token, appId, locale, name, nameMarket, description, descriptionShort, category, keywords }) => safe(async () => {
      const appData = await getApp(token, appId);
      if (!appData.metadata) appData.metadata = { common: { localised: {} } };
      if (!appData.metadata.common.localised[locale]) appData.metadata.common.localised[locale] = {};
      const loc = appData.metadata.common.localised[locale];
      if (name !== undefined)             loc.name             = name;
      if (nameMarket !== undefined)       loc.nameMarket       = nameMarket;
      if (description !== undefined)      loc.description      = description;
      if (descriptionShort !== undefined) loc.descriptionShort = descriptionShort;
      if (keywords !== undefined)         loc.keywords         = keywords.map(k => ({ text: k }));
      if (category !== undefined)         appData.metadata.common.category = category;
      await patchApp(token, appId, appData);
      return { message: '✅ Metadata updated', locale, metadata: appData.metadata.common };
    })
  );

  // ── 13. koapp_list_services ─────────────────────────────────────────────────
  server.tool('koapp_list_services',
    'List all available services in the King of App market with identifiers and config fields.',
    { token: z.string().describe('JWT token from koapp_login') },
    async ({ token }) => safe(async () => {
      const services = await getServices(token);
      return { count: services.length,
               services: services.map(s => ({ identifier: s.identifier, name: s.name, price: s.price,
                                              configFields: s.config?.map(c => c.key) || [] })) };
    })
  );

  // ── 14. koapp_add_service ───────────────────────────────────────────────────
  server.tool('koapp_add_service',
    'Add a service to the app (push notifications, analytics, etc.).',
    {
      token:             z.string().describe('JWT token from koapp_login'),
      appId:             z.string().describe('App ID'),
      serviceIdentifier: z.string().describe('Service identifier e.g. koapushnotifications, googleanalytics')
    },
    async ({ token, appId, serviceIdentifier }) => safe(async () => {
      const [appData, allServices] = await Promise.all([getApp(token, appId), getServices(token)]);
      const svc = allServices.find(s => s.identifier === serviceIdentifier);
      if (!svc) throw new Error(`Service "${serviceIdentifier}" not found. Available: ${allServices.map(s => s.identifier).join(', ')}`);
      if (!appData.services) appData.services = {};
      appData.services[serviceIdentifier] = {
        ...svc, uniqueId: `${serviceIdentifier}-${Math.random().toString(36).slice(2, 7)}`, isService: true
      };
      await patchApp(token, appId, appData);
      return {
        message: `✅ Service "${serviceIdentifier}" added`,
        configFields: svc.config?.map(c => ({ key: c.key, label: c.templateOptions?.label, type: c.type })) || [],
        note: 'Use koapp_configure_service to set credentials'
      };
    })
  );

  // ── 15. koapp_configure_service ─────────────────────────────────────────────
  server.tool('koapp_configure_service',
    'Configure the credentials/settings of an existing service in the app.',
    {
      token:             z.string().describe('JWT token from koapp_login'),
      appId:             z.string().describe('App ID'),
      serviceIdentifier: z.string().describe('Service identifier (must already be added)'),
      scope:             z.record(z.any()).describe('Key-value pairs to merge into the service scope')
    },
    async ({ token, appId, serviceIdentifier, scope }) => safe(async () => {
      const appData = await getApp(token, appId);
      if (!appData.services?.[serviceIdentifier])
        throw new Error(`Service "${serviceIdentifier}" not in app. Add it first with koapp_add_service.`);
      appData.services[serviceIdentifier].scope = { ...appData.services[serviceIdentifier].scope, ...scope };
      await patchApp(token, appId, appData);
      return { message: `✅ Service "${serviceIdentifier}" configured`,
               scope: appData.services[serviceIdentifier].scope };
    })
  );
}
