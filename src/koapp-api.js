/**
 * King of App API Client
 * Wraps all HTTP calls to the Builder internal API
 */

import axios from 'axios';
import sha1 from 'sha1';

const BASE_URL = process.env.KOAPP_API_URL || 'https://api.kingofapp.com';

/**
 * Generate a random 5-char alphanumeric code for uniqueIds
 * Matches the pattern used by the Builder: e.g. "wpembed-t9sRf"
 */
function generateUid() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * Create an axios instance with auth token
 */
function createClient(token) {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    timeout: 30000
  });
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

/**
 * Login with email + password → returns JWT token
 */
export async function login(email, password) {
  const client = createClient();
  const hashedPassword = sha1(password);
  const res = await client.post('/login', { email, password: hashedPassword });

  const token = res.data.token || res.data.access_token || res.data.jwt;
  if (!token) throw new Error('Login failed: no token returned');

  return {
    token,
    userId: res.data.user?._id || res.data._id || res.data.userId
  };
}

// ─────────────────────────────────────────────
// APPS
// ─────────────────────────────────────────────

/**
 * Get all apps for the authenticated user
 */
export async function getApps(token) {
  const client = createClient(token);
  const res = await client.get('/apps');
  return res.data;
}

/**
 * Get a single app by ID (full object including modules)
 */
export async function getApp(token, appId) {
  const client = createClient(token);
  const res = await client.get(`/apps/${appId}`);
  return res.data;
}

/**
 * Create a new app from a template
 * templateId: _id of the template from the market
 * name: app display name
 */
export async function createApp(token, templateId, name) {
  const client = createClient(token);
  const res = await client.post(
    `/apps/${templateId}?path=/`,
    { name, type: 'app' }
  );
  // Response can be { ops: [{ _id }] } or { _id }
  const appId = res.data.ops ? res.data.ops[0]._id : res.data._id;
  if (!appId) throw new Error('Create app failed: no _id returned');
  return { appId, app: res.data };
}

/**
 * Patch app — sends the full app object
 * IMPORTANT: the API expects the complete object, not a partial
 */
export async function patchApp(token, appId, appData) {
  const client = createClient(token);
  const res = await client.patch(`/apps/${appId}`, appData);
  return res.data;
}

/**
 * List available templates from the market
 */
export async function getTemplates(token) {
  const client = createClient(token);
  const res = await client.get('/apps?fields=_id,name,type,config.images');
  // Filter only templates
  return (res.data || []).filter(a => a.type === 'template');
}

// ─────────────────────────────────────────────
// MARKET — Modules & Services
// ─────────────────────────────────────────────

/**
 * Get all available modules from the market
 */
export async function getModules(token) {
  const client = createClient(token);
  const res = await client.get('/modules');
  return res.data;
}

/**
 * Get a specific module by ID
 */
export async function getModule(token, moduleId) {
  const client = createClient(token);
  const res = await client.get(`/modules/${moduleId}`);
  return res.data;
}

/**
 * Get all available services from the market
 */
export async function getServices(token) {
  const client = createClient(token);
  const res = await client.get('/services');
  return res.data;
}

// ─────────────────────────────────────────────
// WORDPRESS IMPORT
// ─────────────────────────────────────────────

/**
 * Fetch WordPress menus directly from the WP REST API
 * Requires the wp-api-menus plugin installed on the WP site
 * Returns array of menu objects: [{ term_id, name, count, items_url }]
 */
export async function fetchWPMenuList(wpUrl) {
  const url = `${wpUrl.replace(/\/$/, '')}/wp-json/wp-api-menus/v2/menus`;
  const res = await axios.get(url, { timeout: 15000 });
  return res.data;
}

/**
 * Fetch items for a specific WordPress menu by term_id
 * Returns menu items with title, url, children[]
 */
export async function fetchWPMenuItems(wpUrl, termId, queryParam = '') {
  let url = `${wpUrl.replace(/\/$/, '')}/wp-json/wp-api-menus/v2/menu-locations/${termId}`;
  if (queryParam) url += `?${queryParam}`;
  const res = await axios.get(url, { timeout: 15000 });
  return res.data;
}

// ─────────────────────────────────────────────
// MODULE STRUCTURE BUILDERS
// ─────────────────────────────────────────────

/**
 * Build the modules dictionary for a WordPress import.
 *
 * Strategy (mirrors the Builder UI logic):
 * 1. Create a menu container module (e.g. bottommenu or scaffoldingmenu)
 * 2. For each top-level menu item → create a wpembed child module
 * 3. If subitems exist → create a submenu container + wpembed grandchildren
 * 4. Return the complete modules dict ready for PATCH /apps/:id
 *
 * menuModuleTemplate: full module object from GET /modules/:id for the menu type
 * wpembedTemplate:    full module object from GET /modules/:id for wpembed
 * menuItems:          array from fetchWPMenuItems
 * wpUrl:              base WordPress URL
 */
export function buildModulesFromWPMenu(menuModuleTemplate, wpembedTemplate, menuItems, wpUrl) {
  const modules = {};
  const menuUid = `${menuModuleTemplate.identifier}-${generateUid()}`;
  const menuPath = `/${menuUid}`;

  const childrenPaths = [];
  const menuScopeItems = [];

  let pose = 0;

  for (const item of menuItems) {
    const embedUid = `${wpembedTemplate.identifier}-${generateUid()}`;
    const embedPath = `${menuPath}/${embedUid}`;

    childrenPaths.push(embedPath);
    menuScopeItems.push({ path: embedPath });

    // Build the wpembed child module
    modules[embedPath] = buildWpembedModule(
      wpembedTemplate,
      embedUid,
      item.title || item.name || 'Page',
      item.url || `${wpUrl}`,
      embedPath,
      pose,
      2
    );

    pose++;

    // Handle one level of submenus
    if (item.children && item.children.length > 0) {
      for (const subItem of item.children) {
        const subUid = `${wpembedTemplate.identifier}-${generateUid()}`;
        const subPath = `${menuPath}/${subUid}`;

        childrenPaths.push(subPath);
        menuScopeItems.push({ path: subPath });

        modules[subPath] = buildWpembedModule(
          wpembedTemplate,
          subUid,
          subItem.title || subItem.name || 'Subpage',
          subItem.url || `${wpUrl}`,
          subPath,
          pose,
          2
        );
        pose++;
      }
    }
  }

  // Build the menu container module
  modules[menuPath] = buildMenuModule(
    menuModuleTemplate,
    menuUid,
    menuPath,
    childrenPaths,
    menuScopeItems,
    1
  );

  return { modules, menuPath, menuUid };
}

/**
 * Build a single wpembed module entry
 */
function buildWpembedModule(template, uniqueId, name, url, path, pose, level) {
  return {
    ...template,
    uniqueId,
    name,
    'name-lang': { 'es-ES': name, 'en-US': name },
    scope: {
      ...template.scope,
      url
    },
    path,
    pose,
    level,
    itemType: 'item',
    selected: false,
    nodes: []
  };
}

/**
 * Build a menu container module entry
 */
function buildMenuModule(template, uniqueId, path, childrenPaths, menuScopeItems, level) {
  return {
    ...template,
    uniqueId,
    path,
    childrenPaths,
    scope: {
      ...template.scope,
      menuItems: menuScopeItems,
      path: `/${template.identifier}`
    },
    pose: '0',
    level,
    itemType: 'container',
    selected: false,
    nodes: []
  };
}

/**
 * Merge new modules into an existing app's modules dict
 * and update config.index to point to the main menu
 */
export function mergeModulesIntoApp(appData, newModules, mainMenuPath) {
  const updatedApp = { ...appData };
  updatedApp.modules = {
    ...(appData.modules || {}),
    ...newModules
  };
  // Set the main entry point to the imported menu
  if (mainMenuPath) {
    updatedApp.config = {
      ...updatedApp.config,
      index: mainMenuPath
    };
  }
  return updatedApp;
}

/**
 * Extract a simplified structure from app modules for display
 * Returns: [{ name, path, children: [{ name, path }] }]
 */
export function extractAppStructure(modules) {
  const structure = [];
  for (const [path, mod] of Object.entries(modules || {})) {
    const depth = (path.match(/\//g) || []).length;
    if (depth === 1) {
      const children = mod.childrenPaths
        ? mod.childrenPaths.map(cp => ({
            name: modules[cp]?.name || cp,
            path: cp,
            internalUrl: '#' + cp
          }))
        : [];

      structure.push({
        name: mod.name,
        path,
        internalUrl: '#' + path,
        type: mod.itemType,
        identifier: mod.identifier,
        children
      });
    }
  }
  return structure;
}
