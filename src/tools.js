/**
 * King of App MCP Tools
 * All 15 tools registered on any McpServer instance passed in.
 * Shared between stdio (dev) and HTTP+SSE (production) transports.
 */

import { z } from 'zod';
import {
  login, getApps, getApp, createApp, patchApp, getTemplates,
  getModules, getServices, fetchWPMenuList, fetchWPMenuItems,
  buildModulesFromWPMenu, mergeModulesIntoApp, extractAppStructure, generateUid
} from './koapp-api.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Token cached server-side after koapp_login — claude.ai does not need to pass
// it in every subsequent call.
let cachedToken = null;

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
  catch (e) { return err(e.response?.data?.message || JSON.stringify(e.response?.data) || e.message || String(e)); }
}

// Resolves the effective token: uses the provided value if non-empty,
// otherwise falls back to the server-side cached token from koapp_login.
// Passes the resolved token as the first argument to fn.
async function withToken(token, fn) {
  const t = (token && token.trim()) ? token : cachedToken;
  if (!t) return err('No token — call koapp_login first.');
  if (token && token.trim()) cachedToken = token; // keep cache fresh
  return safe(() => fn(t));
}

const TOKEN_DESC = 'JWT token from koapp_login (optional if already logged in this session)';

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerTools(server) {

  // ── 0. koapp_get_creation_guide ─────────────────────────────────────────────
  server.tool('koapp_get_creation_guide',
    'Returns the complete conversational flow and rules for building a King of App application. ALWAYS call this first when a user asks to create, build or set up an app.',
    {},
    async () => ok({
      title: 'King of App — Complete App Creation Guide',

      critical_rules: [
        'ALWAYS use superhtml module for custom screens — never any other module.',
        'Each screen = 1 independent superhtml module.',
        'HTML must be self-contained: all styles in <style>, all scripts in <script>, single HTML file.',
        'HTML must be responsive and designed for mobile (max-width: 430px).',
        'The superhtml scope field for HTML content is "code" (not "html" or "value").',
        'Token is cached server-side after login — never ask the user to pass it again.',
        'Default templateId: 5a3ba7b7fb42884fdf30c154 (Starter Blank).'
      ],

      conversational_flow: {
        description: 'Follow this decision tree with the user before calling any tool.',
        step_A: {
          action: 'Ask for the app name',
          then: 'step_B'
        },
        step_B: {
          action: 'Ask: what type of app?',
          options: {
            'A — Web to App': 'step_B1',
            'B — Custom App': 'step_B2'
          }
        },
        step_B1: {
          type: 'Web to App',
          action: 'Ask for the website URL and whether it uses WordPress',
          if_wordpress: 'Use koapp_fetch_wp_menus then koapp_import_wp_menu to import structure',
          if_other_web: 'Use koapp_add_screen with superhtml wrapping the URL in an iframe',
          then: 'step_C'
        },
        step_B2: {
          type: 'Custom App',
          action: 'Ask user for a design brief / prompt describing the app',
          then_ask: 'Does the app need a database or user login?',
          if_yes_db: 'Note: integrate Firebase MCP — create project, get firebaseConfig, inject into screen HTML',
          ai_task: 'Generate N complete HTML screens based on the brief. Each screen: full HTML, inline CSS, mobile-first (max-width:430px), coherent visual style.',
          then: 'step_C'
        },
        step_C: {
          action: 'Ask: what type of navigation menu?',
          tool: 'koapp_list_menu_types',
          options_note: 'Show the list and let user choose, or default to bottommenu',
          also_option: 'Custom HTML menu — generate a superhtml module as the menu itself',
          then: 'start_building'
        }
      },

      building_sequence: {
        description: 'Execute these tools IN ORDER once the conversational flow is complete.',
        steps: [
          {
            step: 1,
            tool: 'koapp_login',
            params: { email: 'user email', password: 'user password' },
            note: 'Skip if already logged in this session.'
          },
          {
            step: 2,
            tool: 'koapp_create_app',
            params: { name: 'app name' },
            saves: 'appId — required for all subsequent steps'
          },
          {
            step: 3,
            tool: 'koapp_update_metadata',
            params: {
              appId: '<step2.appId>',
              name: 'app name',
              description: 'AI-generated full description',
              descriptionShort: 'subtitle max 80 chars',
              keywords: ['keyword1', 'keyword2'],
              category: 'Reference | Social | Games | etc.',
              locale: 'en_US',
              ios: { primary_category: 'e.g. Reference' },
              android: { primary_category: 'e.g. Books & Reference', content_rating: 'Everyone' }
            },
            note: 'Generate metadata automatically based on the app description — do not ask the user.'
          },
          {
            step: '3b',
            tool: 'koapp_generate_icon',
            params: {
              appId: '<step2.appId>',
              iconPrompt: 'describe icon: style, colors, concept — infer from app name and category',
              setSplash: true
            },
            note: 'Generate icon + splash automatically. Craft a detailed visual prompt based on the app concept and color scheme. No API key needed.'
          },
          {
            step: 4,
            tool: 'koapp_update_app_config',
            params: {
              appId: '<step2.appId>',
              lang: ['en_US'],
              colors: { primaryColor: '#HEX', accentColor: '#HEX', backgroundColor: '#HEX', primaryTextColor: '#HEX' }
            },
            note: 'Infer colors from the design brief. Skip colors if user gave no design info.'
          },
          {
            step: 5,
            tool: 'koapp_add_screen',
            params: {
              appId: '<step2.appId>',
              name: 'Menu name',
              moduleIdentifier: 'bottommenu | scaffoldingmenu | lateralboxps | polymermenu | slidemenu | superhtml'
            },
            note: 'NO menuPath — this is the root menu. For custom HTML menu use superhtml with htmlContent.',
            saves: 'menuPath — the modulePath returned (e.g. /bottommenu-ABC12)'
          },
          {
            step: 6,
            tool: 'koapp_update_app_config',
            params: { appId: '<step2.appId>', config: { index: '<step5.modulePath>' } },
            note: 'Set the menu as the app entry point.'
          },
          {
            step: 7,
            tool: 'koapp_add_screen',
            repeat: 'once per screen',
            params: {
              appId: '<step2.appId>',
              name: 'Screen name',
              menuPath: '<step5.modulePath>',
              htmlContent: 'complete self-contained HTML for this screen'
            },
            note: 'Use superhtml (default). HTML goes in scope.code. Each call auto-attaches the screen to the menu.'
          },
          {
            step: 8,
            optional: true,
            tool: 'koapp_add_service',
            when: 'User wants push notifications or analytics',
            params: { appId: '<step2.appId>', serviceIdentifier: 'koapushnotifications | googleanalytics' },
            note: 'Use koapp_list_services to show available options.'
          },
          {
            step: 9,
            optional: true,
            tool: 'koapp_configure_service',
            params: { appId: '<step2.appId>', serviceIdentifier: '<step8>', scope: { key: 'credential' } },
            note: 'configFields are returned by koapp_add_service.'
          },
          {
            step: 10,
            tool: 'koapp_get_app_structure',
            params: { appId: '<step2.appId>' },
            note: 'Verify structure. Show internalUrls to user. Enter edit loop.'
          }
        ]
      },

      edit_loop: {
        description: 'After building, stay available for changes.',
        update_screen_html: { tool: 'koapp_update_module', params: { appId: '<appId>', modulePath: '<modulePath>', htmlContent: 'new full HTML' } },
        add_screen: { tool: 'koapp_add_screen', params: { appId: '<appId>', name: '<name>', menuPath: '<menuPath>', htmlContent: '<html>' } },
        update_menu: { tool: 'koapp_update_menu_items', params: { appId: '<appId>', menuPath: '<menuPath>', menuItems: [{ path: '<modulePath>' }] } },
        check_structure: { tool: 'koapp_get_app_structure', params: { appId: '<appId>' } }
      },

      services_guide: {
        push_notifications: 'serviceIdentifier: koapushnotifications — requires FCM server key from Firebase project',
        analytics: 'serviceIdentifier: googleanalytics — requires GA tracking ID',
        apple_store: 'serviceIdentifier: apple — requires Apple developer credentials'
      },

      compile_note: 'App compilation and icon upload are done through the King of App web builder at kingofapp.com — not available via API. Inform the user to go there once the structure is ready.'
    })
  );

  // ── 0b. koapp_list_menu_types ────────────────────────────────────────────────
  server.tool('koapp_list_menu_types',
    'Returns all available menu module types with descriptions. Call this when the user needs to choose a navigation style.',
    {},
    async () => ok({
      menu_types: [
        { identifier: 'bottommenu',      name: 'Bottom Tab Bar',     description: 'Fixed tabs at the bottom of the screen. Most common for mobile apps.' },
        { identifier: 'scaffoldingmenu', name: 'Side Drawer',        description: 'Hamburger menu that slides in from the left.' },
        { identifier: 'lateralboxps',    name: 'Lateral Box',        description: 'Lateral menu with a fixed header panel.' },
        { identifier: 'polymermenu',     name: 'Material Design Menu', description: 'Google Material Design navigation drawer.' },
        { identifier: 'slidemenu',       name: 'Slide Menu',         description: 'Full-screen slide-out menu.' },
        { identifier: 'superhtml',       name: 'Custom HTML Menu',   description: 'Build the menu entirely in HTML/CSS/JS using a superhtml module.' }
      ],
      default: 'bottommenu',
      note: 'Pass the identifier as moduleIdentifier in koapp_add_screen (step 5).'
    })
  );

  // ── 0c. koapp_generate_icon ─────────────────────────────────────────────────
  server.tool('koapp_generate_icon',
    'Generate an app icon using AI (pollinations.ai, free, no API key) and set it on the app. Also sets the splash screen image. Call this during app creation after metadata is set.',
    {
      token:        z.string().optional().describe(TOKEN_DESC),
      appId:        z.string().describe('App ID'),
      iconPrompt:   z.string().describe('Describe the icon: style, colors, concept. E.g. "minimalist fitness app icon, orange and white, running shoe silhouette, flat design"'),
      splashPrompt: z.string().optional().describe('Describe the splash screen image (optional — defaults to a variation of iconPrompt)'),
      setSplash:    z.boolean().optional().default(true).describe('Also set the splash screen image (default true)')
    },
    async ({ token, appId, iconPrompt, splashPrompt, setSplash }) => withToken(token, async (t) => {
      const base = 'https://image.pollinations.ai/prompt/';
      const iconUrl   = `${base}${encodeURIComponent(iconPrompt + ', app icon, no text, high quality')}&width=1024&height=1024&nologo=true&model=flux`;
      const splashUrl = setSplash
        ? `${base}${encodeURIComponent((splashPrompt || iconPrompt) + ', mobile app splash screen, centered, no text')}&width=1242&height=2688&nologo=true&model=flux`
        : null;

      const appData = await getApp(t, appId);
      appData.config = {
        ...appData.config,
        images: {
          ...appData.config?.images,
          icon: iconUrl,
          ...(splashUrl ? { splash: splashUrl } : {})
        }
      };
      await patchApp(t, appId, appData);
      return {
        message: '✅ Icon generated and saved',
        iconUrl,
        splashUrl: splashUrl || 'not set',
        note: 'The icon is generated on-demand by pollinations.ai each time it is loaded. The image is 1024x1024px.'
      };
    })
  );

  // ── 0d. koapp_update_module ──────────────────────────────────────────────────
  server.tool('koapp_update_module',
    'Update the HTML content of an existing superhtml screen. Use this to edit a screen after it has been created.',
    {
      token:       z.string().optional().describe(TOKEN_DESC),
      appId:       z.string().describe('App ID'),
      modulePath:  z.string().describe('Module path (e.g. /bottommenu-ABC12/superhtml-XYZ99)'),
      htmlContent: z.string().describe('New complete self-contained HTML for the screen'),
      name:        z.string().optional().describe('New screen name (optional)')
    },
    async ({ token, appId, modulePath, htmlContent, name }) => withToken(token, async (t) => {
      const appData = await getApp(t, appId);
      if (!appData.modules?.[modulePath]) throw new Error(`Module "${modulePath}" not found`);
      const mod = appData.modules[modulePath];
      if (mod.identifier !== 'superhtml') throw new Error(`Module "${modulePath}" is not a superhtml module (it is "${mod.identifier}")`);
      mod.scope = { ...mod.scope, code: htmlContent };
      if (name) { mod.name = name; mod['name-lang'] = { 'es-ES': name, 'en-US': name }; }
      await patchApp(t, appId, appData);
      return { message: `✅ Module ${modulePath} updated`, modulePath, name: mod.name };
    })
  );

  // ── 1. koapp_login ──────────────────────────────────────────────────────────
  server.tool('koapp_login',
    'Authenticate with King of App using email and password. The token is saved server-side — subsequent tools do not need it passed explicitly.',
    {
      email:    z.string().email().describe('King of App account email'),
      password: z.string().describe('King of App account password')
    },
    async ({ email, password }) => safe(async () => {
      const result = await login(email, password);
      cachedToken = result.token;
      console.log('[koapp_login] token cached, length:', result.token?.length);
      return { message: '✅ Login successful', token: result.token, userId: result.userId,
               note: 'Token saved server-side. You do not need to pass it to subsequent calls.' };
    })
  );

  // ── 2. koapp_list_apps ──────────────────────────────────────────────────────
  server.tool('koapp_list_apps',
    'List apps belonging to the authenticated user. Returns 20 per page. If you know the appId use koapp_get_app directly.',
    {
      token: z.string().optional().describe(TOKEN_DESC),
      page:  z.number().int().min(1).default(1).describe('Page number (20 apps per page)')
    },
    async ({ token, page }) => withToken(token, async (t) => {
      const { apps, totalItems } = await getApps(t, { page });
      const totalPages = totalItems ? Math.ceil(totalItems / 20) : null;
      return {
        page,
        totalPages,
        totalItems,
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

  // ── 3. koapp_list_modules ──────────────────────────────────────────────────
  server.tool('koapp_list_modules',
    'List all available modules in the King of App market (269 total). Use the identifier when calling koapp_add_screen.',
    {
      token:  z.string().optional().describe(TOKEN_DESC),
      filter: z.string().optional().describe('Filter by identifier or name (case-insensitive substring)')
    },
    async ({ token, filter }) => withToken(token, async (t) => {
      const all = await getModules(t);
      const mods = filter
        ? all.filter(m => m.identifier?.toLowerCase().includes(filter.toLowerCase()) || m.name?.toLowerCase().includes(filter.toLowerCase()))
        : all;
      return {
        count: mods.length,
        total: all.length,
        modules: mods.map(m => ({
          id: m._id?.$oid || m._id,
          identifier: m.identifier,
          name: m.name,
          price: m.price
        }))
      };
    })
  );

  // ── 4. koapp_list_templates ─────────────────────────────────────────────────
  server.tool('koapp_list_templates',
    'List available app templates from the King of App market. Use template _id when calling koapp_create_app.',
    { token: z.string().optional().describe(TOKEN_DESC) },
    async ({ token }) => withToken(token, async (t) => {
      console.log('[list_templates] using token len:', t?.length);
      const templates = await getTemplates(t);
      return { count: templates.length,
               templates: templates.map(tmpl => ({ id: tmpl._id?.$oid || tmpl._id, name: tmpl.name || '(no name)', type: tmpl.type })) };
    })
  );

  // ── 4. koapp_create_app ─────────────────────────────────────────────────────
  server.tool('koapp_create_app',
    'Create a new app in King of App from a template. Returns the new app ID needed for subsequent operations.',
    {
      token:      z.string().optional().describe(TOKEN_DESC),
      templateId: z.string().optional().describe('_id of the template (optional — defaults to Starter Blank)'),
      name:       z.string().describe('Display name for the new app')
    },
    async ({ token, templateId, name }) => withToken(token, async (t) => {
      const result = await createApp(t, templateId || '5a3ba7b7fb42884fdf30c154', name);
      return { message: '✅ App created successfully', appId: result.appId,
               note: 'Use this appId in all subsequent calls' };
    })
  );

  // ── 5. koapp_get_app ────────────────────────────────────────────────────────
  server.tool('koapp_get_app',
    'Get the full raw data of an app including modules, config, themes and services.',
    {
      token: z.string().optional().describe(TOKEN_DESC),
      appId: z.string().describe('App ID')
    },
    async ({ token, appId }) => withToken(token, async (t) => getApp(t, appId))
  );

  // ── 6. koapp_get_app_structure ──────────────────────────────────────────────
  server.tool('koapp_get_app_structure',
    'Get a simplified view of the app module structure: names, internal #/path URLs and hierarchy.',
    {
      token: z.string().optional().describe(TOKEN_DESC),
      appId: z.string().describe('App ID')
    },
    async ({ token, appId }) => withToken(token, async (t) => {
      const app = await getApp(t, appId);
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
      token:      z.string().optional().describe(TOKEN_DESC),
      appId:      z.string().describe('App ID to import the menu into'),
      wpUrl:      z.string().url().describe('Base URL of the WordPress site'),
      menuTermId: z.number().describe('term_id of the WordPress menu to import (from koapp_fetch_wp_menus)'),
      menuType:   z.enum(['bottommenu','scaffoldingmenu','polymermenu','slidemenu'])
                   .default('bottommenu').describe('King of App menu module type to use as container'),
      queryParam: z.string().optional().describe('Optional query param for koa embed plugin (e.g. koaembed=1)')
    },
    async ({ token, appId, wpUrl, menuTermId, menuType, queryParam }) => withToken(token, async (t) => {
      const [appData, menuItems, allModules] = await Promise.all([
        getApp(t, appId),
        fetchWPMenuItems(wpUrl, menuTermId, queryParam),
        getModules(t)
      ]);

      if (!menuItems?.length) throw new Error(`No menu items found for term_id ${menuTermId} in ${wpUrl}`);

      const menuTemplate   = allModules.find(m => m.identifier === menuType);
      const embedTemplate  = allModules.find(m => m.identifier === 'wpembed');
      if (!menuTemplate)  throw new Error(`Menu module "${menuType}" not found in market`);
      if (!embedTemplate) throw new Error('wpembed module not found in market');

      const { modules: newModules, menuPath } = buildModulesFromWPMenu(menuTemplate, embedTemplate, menuItems, wpUrl);
      const updatedApp = mergeModulesIntoApp(appData, newModules, menuPath);
      await patchApp(t, appId, updatedApp);

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

  // ── 9. koapp_add_screen ─────────────────────────────────────────────────────
  server.tool('koapp_add_screen',
    'Add a new screen (module) to an app. Defaults to Super Html Site (superhtml). Optionally attaches it to a menu.',
    {
      token:      z.string().optional().describe(TOKEN_DESC),
      appId:      z.string().describe('App ID'),
      name:       z.string().describe('Screen display name'),
      htmlContent: z.string().optional().describe('HTML content for the screen (superhtml scope.value)'),
      menuPath:   z.string().optional().describe('Path of the parent menu to attach this screen to (e.g. /bottommenu-ABC12)'),
      moduleIdentifier: z.string().optional().describe('Module identifier to use (default: superhtml)')
    },
    async ({ token, appId, name, htmlContent, menuPath, moduleIdentifier }) => withToken(token, async (t) => {
      const [appData, allModules] = await Promise.all([getApp(t, appId), getModules(t)]);

      const identifier = moduleIdentifier || 'superhtml';
      const template = allModules.find(m => m.identifier === identifier);
      if (!template) throw new Error(`Module "${identifier}" not found in market`);

      const uid = `${identifier}-${generateUid()}`;
      const parentPath = menuPath || '';
      const modulePath = parentPath ? `${parentPath}/${uid}` : `/${uid}`;
      const pose = Object.keys(appData.modules || {}).length;

      const newModule = {
        ...template,
        uniqueId: uid,
        name,
        'name-lang': { 'es-ES': name, 'en-US': name },
        path: modulePath,
        pose,
        level: parentPath ? 2 : 1,
        itemType: 'item',
        selected: false,
        nodes: [],
        scope: {
          ...template.scope,
          ...(htmlContent !== undefined ? { code: htmlContent } : {})
        }
      };

      if (!appData.modules) appData.modules = {};
      appData.modules[modulePath] = newModule;

      if (menuPath && appData.modules[menuPath]) {
        const menu = appData.modules[menuPath];
        if (!menu.childrenPaths) menu.childrenPaths = [];
        menu.childrenPaths.push(modulePath);
        if (!menu.scope) menu.scope = {};
        if (!menu.scope.menuItems) menu.scope.menuItems = [];
        menu.scope.menuItems.push({ path: modulePath });
      }

      await patchApp(t, appId, appData);
      return {
        message: `✅ Screen "${name}" added`,
        modulePath,
        internalUrl: '#' + modulePath,
        moduleIdentifier: identifier,
        attachedToMenu: menuPath || null
      };
    })
  );

  // ── 10. koapp_update_module_scope ───────────────────────────────────────────
  server.tool('koapp_update_module_scope',
    'Update the scope (configuration) of a specific module. Use to change the URL of a wpembed, update menu items, or any module setting.',
    {
      token:       z.string().optional().describe(TOKEN_DESC),
      appId:       z.string().describe('App ID'),
      modulePath:  z.string().describe('Module path key (e.g. /bottommenu-MYGs2/wpembed-t9sRf)'),
      scope:       z.record(z.any()).describe('Scope fields to merge into the module')
    },
    async ({ token, appId, modulePath, scope }) => withToken(token, async (t) => {
      const appData = await getApp(t, appId);
      if (!appData.modules?.[modulePath]) throw new Error(`Module "${modulePath}" not found`);
      appData.modules[modulePath].scope = { ...appData.modules[modulePath].scope, ...scope };
      await patchApp(t, appId, appData);
      return { message: `✅ Module ${modulePath} updated`, updatedScope: appData.modules[modulePath].scope };
    })
  );

  // ── 10. koapp_update_menu_items ─────────────────────────────────────────────
  server.tool('koapp_update_menu_items',
    'Update the items of a menu module. Use to add, remove, reorder or relink menu entries to internal app URLs.',
    {
      token:     z.string().optional().describe(TOKEN_DESC),
      appId:     z.string().describe('App ID'),
      menuPath:  z.string().describe('Path of the menu module (e.g. /bottommenu-MYGs2)'),
      menuItems: z.array(z.object({
        path: z.string().describe('Internal app path of the target module')
      })).describe('Ordered array of menu items')
    },
    async ({ token, appId, menuPath, menuItems }) => withToken(token, async (t) => {
      const appData = await getApp(t, appId);
      if (!appData.modules?.[menuPath]) throw new Error(`Menu "${menuPath}" not found`);
      appData.modules[menuPath].scope = { ...appData.modules[menuPath].scope, menuItems };
      await patchApp(t, appId, appData);
      return { message: `✅ Menu ${menuPath} updated with ${menuItems.length} items`, menuItems };
    })
  );

  // ── 11. koapp_update_app_config ─────────────────────────────────────────────
  server.tool('koapp_update_app_config',
    'Update app-level config: colors, language, spinner, entry point module.',
    {
      token:  z.string().optional().describe(TOKEN_DESC),
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
    async ({ token, appId, config }) => withToken(token, async (t) => {
      const appData = await getApp(t, appId);
      appData.config = {
        ...appData.config, ...config,
        colors: config.colors ? { ...appData.config?.colors, ...config.colors } : appData.config?.colors
      };
      await patchApp(t, appId, appData);
      return { message: '✅ App config updated', config: appData.config };
    })
  );

  // ── 12. koapp_update_metadata ───────────────────────────────────────────────
  server.tool('koapp_update_metadata',
    'Update app metadata: name, description, category, keywords (common/localised), plus iOS and Android store-specific fields.',
    {
      token:            z.string().optional().describe(TOKEN_DESC),
      appId:            z.string().describe('App ID'),
      locale:           z.string().default('en_US').describe('Locale code e.g. en_US, es_ES'),
      name:             z.string().optional().describe('App name'),
      nameMarket:       z.string().optional().describe('Name shown in the store (max 30 chars for iOS)'),
      description:      z.string().optional().describe('Full description'),
      descriptionShort: z.string().optional().describe('Short description / subtitle'),
      category:         z.string().optional().describe('Common category e.g. Reference, Social, Games'),
      keywords:         z.array(z.string()).optional().describe('Store keywords list'),
      ios: z.object({
        primary_category:   z.string().optional().describe('iOS App Store primary category e.g. Reference, Books, Social Networking'),
        secondary_category: z.string().optional().describe('iOS App Store secondary category (optional)')
      }).optional().describe('iOS-specific store metadata'),
      android: z.object({
        primary_category:  z.string().optional().describe('Google Play primary category e.g. Books & Reference, Social, Games'),
        content_rating:    z.string().optional().describe('Content rating e.g. Everyone, Teen, Mature 17+')
      }).optional().describe('Android-specific store metadata')
    },
    async ({ token, appId, locale, name, nameMarket, description, descriptionShort, category, keywords, ios, android }) => withToken(token, async (t) => {
      const appData = await getApp(t, appId);
      if (!appData.metadata) appData.metadata = { common: { localised: {} }, ios: {}, android: {} };
      if (!appData.metadata.common) appData.metadata.common = { localised: {} };
      if (!appData.metadata.common.localised) appData.metadata.common.localised = {};
      if (!appData.metadata.common.localised[locale]) appData.metadata.common.localised[locale] = {};

      const loc = appData.metadata.common.localised[locale];
      if (name !== undefined)             loc.name             = name;
      if (nameMarket !== undefined)       loc.nameMarket       = nameMarket;
      if (description !== undefined)      loc.description      = description;
      if (descriptionShort !== undefined) loc.descriptionShort = descriptionShort;
      if (keywords !== undefined)         loc.keywords         = keywords.map(k => ({ text: k }));
      if (category !== undefined)         appData.metadata.common.category = category;

      if (ios) {
        if (!appData.metadata.ios) appData.metadata.ios = {};
        Object.assign(appData.metadata.ios, ios);
      }
      if (android) {
        if (!appData.metadata.android) appData.metadata.android = {};
        Object.assign(appData.metadata.android, android);
      }

      await patchApp(t, appId, appData);
      return {
        message: '✅ Metadata updated',
        locale,
        common: appData.metadata.common,
        ios: appData.metadata.ios,
        android: appData.metadata.android
      };
    })
  );

  // ── 13. koapp_list_services ─────────────────────────────────────────────────
  server.tool('koapp_list_services',
    'List all available services in the King of App market with identifiers and config fields.',
    { token: z.string().optional().describe(TOKEN_DESC) },
    async ({ token }) => withToken(token, async (t) => {
      const services = await getServices(t);
      return { count: services.length,
               services: services.map(s => ({ identifier: s.identifier, name: s.name, price: s.price,
                                              configFields: s.config?.map(c => c.key) || [] })) };
    })
  );

  // ── 14. koapp_add_service ───────────────────────────────────────────────────
  server.tool('koapp_add_service',
    'Add a service to the app (push notifications, analytics, etc.).',
    {
      token:             z.string().optional().describe(TOKEN_DESC),
      appId:             z.string().describe('App ID'),
      serviceIdentifier: z.string().describe('Service identifier e.g. koapushnotifications, googleanalytics')
    },
    async ({ token, appId, serviceIdentifier }) => withToken(token, async (t) => {
      const [appData, allServices] = await Promise.all([getApp(t, appId), getServices(t)]);
      const svc = allServices.find(s => s.identifier === serviceIdentifier);
      if (!svc) throw new Error(`Service "${serviceIdentifier}" not found. Available: ${allServices.map(s => s.identifier).join(', ')}`);
      if (!appData.services) appData.services = {};
      appData.services[serviceIdentifier] = {
        ...svc, uniqueId: `${serviceIdentifier}-${Math.random().toString(36).slice(2, 7)}`, isService: true
      };
      await patchApp(t, appId, appData);
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
      token:             z.string().optional().describe(TOKEN_DESC),
      appId:             z.string().describe('App ID'),
      serviceIdentifier: z.string().describe('Service identifier (must already be added)'),
      scope:             z.record(z.any()).describe('Key-value pairs to merge into the service scope')
    },
    async ({ token, appId, serviceIdentifier, scope }) => withToken(token, async (t) => {
      const appData = await getApp(t, appId);
      if (!appData.services?.[serviceIdentifier])
        throw new Error(`Service "${serviceIdentifier}" not in app. Add it first with koapp_add_service.`);
      appData.services[serviceIdentifier].scope = { ...appData.services[serviceIdentifier].scope, ...scope };
      await patchApp(t, appId, appData);
      return { message: `✅ Service "${serviceIdentifier}" configured`,
               scope: appData.services[serviceIdentifier].scope };
    })
  );
}
