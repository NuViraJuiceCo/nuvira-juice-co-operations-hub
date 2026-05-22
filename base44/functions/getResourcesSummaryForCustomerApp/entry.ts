import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const QUERY_LIMIT = MAX_LIMIT + 1;
const SAFE_TEXT_LIMIT = 120;

const TEAM_CATEGORY = 'team member';
const EQUIPMENT_CATEGORY = 'equipment';
const TEAM_STATUSES = new Set(['active', 'on leave', 'inactive']);
const EQUIPMENT_STATUSES = new Set(['operational', 'maintenance', 'broken']);
const EQUIPMENT_STATUS_SEVERITY = {
  broken: 0,
  maintenance: 1,
  operational: 2,
};

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function parseLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function truncate(value, maxLength = SAFE_TEXT_LIMIT) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function redactSensitiveText(value) {
  return normalizeText(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]')
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[redacted token]');
}

function safeInline(value, maxLength = SAFE_TEXT_LIMIT) {
  const redacted = redactSensitiveText(value).replace(/\s+/g, ' ');
  return truncate(redacted, maxLength) || null;
}

function normalizeCategory(value) {
  return normalizeLower(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function isTeamResource(resource) {
  return normalizeCategory(resource.category) === TEAM_CATEGORY;
}

function isEquipmentResource(resource) {
  return normalizeCategory(resource.category) === EQUIPMENT_CATEGORY;
}

function safeTags(resource) {
  return Array.isArray(resource.tags) ? resource.tags.map(normalizeText).filter(Boolean) : [];
}

function firstSafeTeamShift(resource) {
  const tags = safeTags(resource);
  const statusTags = new Set([...TEAM_STATUSES, ...EQUIPMENT_STATUSES]);
  const shift = tags.find(tag => {
    const lower = normalizeLower(tag);
    return !statusTags.has(lower) && !lower.startsWith('lastservice:') && !lower.startsWith('last service:');
  });
  return safeInline(shift, 80);
}

function lastServiceDate(resource) {
  const tag = safeTags(resource).find(value => /^last\s*service:/i.test(value) || /^lastservice:/i.test(value));
  if (!tag) return null;

  const value = tag.replace(/^last\s*service:/i, '').replace(/^lastservice:/i, '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? value : null;
}

function teamStatus(resource) {
  const version = normalizeLower(resource.version);
  if (TEAM_STATUSES.has(version)) return resource.version;

  const tag = safeTags(resource).find(value => TEAM_STATUSES.has(normalizeLower(value)));
  if (tag) return tag;

  const status = normalizeLower(resource.status);
  if (TEAM_STATUSES.has(status)) return resource.status;

  return 'Active';
}

function equipmentStatus(resource) {
  const version = normalizeLower(resource.version);
  if (EQUIPMENT_STATUSES.has(version)) return resource.version;

  const tag = safeTags(resource).find(value => EQUIPMENT_STATUSES.has(normalizeLower(value)));
  if (tag) return tag;

  return 'Operational';
}

function sanitizeTeamResource(resource) {
  return {
    resource_id: resource.id || null,
    display_name: safeInline(resource.title),
    role: safeInline(resource.description),
    shift_label: firstSafeTeamShift(resource),
    status: safeInline(teamStatus(resource), 40),
    updated_date: resource.updated_date || null,
  };
}

function sanitizeEquipmentResource(resource) {
  return {
    resource_id: resource.id || null,
    equipment_name: safeInline(resource.title),
    equipment_type: safeInline(resource.description),
    equipment_status: safeInline(equipmentStatus(resource), 40),
    last_service_date: lastServiceDate(resource),
    updated_date: resource.updated_date || null,
  };
}

function buildSummary(team, equipment) {
  return {
    team_count: team.length,
    equipment_count: equipment.length,
    active_team: team.filter(item => normalizeLower(item.status) === 'active').length,
    operational_equipment: equipment.filter(item => normalizeLower(item.equipment_status) === 'operational').length,
    maintenance_equipment: equipment.filter(item => normalizeLower(item.equipment_status) === 'maintenance').length,
    broken_equipment: equipment.filter(item => normalizeLower(item.equipment_status) === 'broken').length,
  };
}

function teamSort(a, b) {
  return (a.display_name || '').localeCompare(b.display_name || '');
}

function equipmentSort(a, b) {
  const statusA = normalizeLower(a.equipment_status);
  const statusB = normalizeLower(b.equipment_status);
  const byStatus = (EQUIPMENT_STATUS_SEVERITY[statusA] ?? 9) - (EQUIPMENT_STATUS_SEVERITY[statusB] ?? 9);
  if (byStatus !== 0) return byStatus;
  return (a.equipment_name || '').localeCompare(b.equipment_name || '');
}

function itemMatchesCategory(itemType, category) {
  if (!category) return true;
  const normalized = normalizeCategory(category);
  return normalized === itemType;
}

function itemMatchesStatus(item, status) {
  if (!status) return true;
  const normalized = normalizeLower(status);
  if (item.type === TEAM_CATEGORY) {
    return normalizeLower(item.status) === normalized;
  }
  return normalizeLower(item.equipment_status) === normalized;
}

function itemMatchesSearch(item, search) {
  if (!search) return true;
  const values = item.type === TEAM_CATEGORY
    ? [item.display_name, item.role, item.shift_label, item.status, 'Team Member']
    : [item.equipment_name, item.equipment_type, item.equipment_status, item.last_service_date, 'Equipment'];

  return values.some(value => normalizeLower(value).includes(search));
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    if (!SYNC_SECRET || token !== SYNC_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (req.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const url = new URL(req.url);
    const category = normalizeText(url.searchParams.get('category'));
    const status = normalizeText(url.searchParams.get('status'));
    const search = normalizeLower(url.searchParams.get('search'));
    const limit = parseLimit(url.searchParams.get('limit'));

    const base44 = createClientFromRequest(req);
    const resources = await base44.asServiceRole.entities.Resource.list('-created_date', QUERY_LIMIT);

    const team = [];
    const equipment = [];

    for (const resource of resources || []) {
      if (isTeamResource(resource)) {
        team.push(sanitizeTeamResource(resource));
      } else if (isEquipmentResource(resource)) {
        equipment.push(sanitizeEquipmentResource(resource));
      }
    }

    team.sort(teamSort);
    equipment.sort(equipmentSort);

    const summary = buildSummary(team, equipment);
    const typedItems = [
      ...team.map(item => ({ ...item, type: TEAM_CATEGORY })),
      ...equipment.map(item => ({ ...item, type: EQUIPMENT_CATEGORY })),
    ].filter(item => {
      if (!itemMatchesCategory(item.type, category)) return false;
      if (!itemMatchesStatus(item, status)) return false;
      return itemMatchesSearch(item, search);
    });

    const limitedItems = typedItems.slice(0, limit);
    const responseTeam = limitedItems
      .filter(item => item.type === TEAM_CATEGORY)
      .map(({ type, ...item }) => item);
    const responseEquipment = limitedItems
      .filter(item => item.type === EQUIPMENT_CATEGORY)
      .map(({ type, ...item }) => item);
    const truncated = typedItems.length > limit || (resources || []).length > MAX_LIMIT;

    console.log(`[RESOURCES-SUMMARY] count=${limitedItems.length} truncated=${truncated}`);

    return Response.json({
      success: true,
      summary,
      count: limitedItems.length,
      truncated,
      sections: {
        team: responseTeam,
        equipment: responseEquipment,
      },
    });
  } catch (error) {
    console.error('[RESOURCES-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load resources summary' }, { status: 500 });
  }
});
