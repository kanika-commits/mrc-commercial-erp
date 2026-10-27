import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const route = fs.readFileSync('app/api/reports/labour-audit/route.ts', 'utf8');
const page = fs.readFileSync('app/reports/page.tsx', 'utf8');
const source = route.slice(route.indexOf('async function loadAuthorizedActors('), route.indexOf('function organizationIdForRequest('));
const assignmentCoversScope = (assignment, scope) =>
  (!scope.companyId || assignment.company_id === null || assignment.company_id === scope.companyId) &&
  (!scope.siteId || assignment.site_id === null || assignment.site_id === scope.siteId);
const loadActors = new Function("assignmentCoversScope", `${ts.transpile(source, { target: ts.ScriptTarget.ES2020 })}; return loadAuthorizedActors;`)(assignmentCoversScope);
const permission = { module_code: 'labour_workers', action_code: 'view', allowed: true };
const fixtures = {
  profiles: [], user_access_assignments: [], user_roles: [], user_permissions: [],
  roles: [{ id: 'r1', status: 'active' }, { id: 'r2', status: 'active' }, { id: 'inactive', status: 'inactive' }],
  role_permissions: ['r1', 'r2', 'inactive'].map(role_id => ({ role_id, ...permission })),
  // Deliberately no company_id: the same sites can be selected with either company.
  sites: ['s1', 's2'].map(id => ({ id, site_name: id, organization_id: 'org' })),
};
function actor(id, pairs, { organization = 'org', status = 'active', roles = ['r1'], direct = false } = {}) {
  fixtures.profiles.push({ id, full_name: id, email: `${id}@example.test`, status });
  fixtures.user_access_assignments.push(...pairs.map(([company_id, site_id]) => ({ user_id: id, organization_id: organization, company_id, site_id })));
  fixtures.user_roles.push(...roles.map(role_id => ({ user_id: id, role_id })));
  if (direct) fixtures.user_permissions.push({ user_id: id, ...permission });
}
actor('org-wide', [[null, null]]);
actor('company-a', [['a', null]]);
actor('company-b', [['b', null]]);
actor('site-one', [['a', 's1']]);
actor('site-two', [['a', 's2']]);
actor('neutral-site', [[null, 's1']]);
actor('multi', [['a', 's1'], ['b', 's2'], ['a', null]], { roles: ['r1', 'r2'] });
actor('foreign', [[null, null]], { organization: 'foreign-org' });
actor('inactive-user', [[null, null]], { status: 'inactive' });
actor('inactive-role', [[null, null]], { roles: ['inactive'] });
actor('no-permission', [[null, null]], { roles: [] });
actor('direct', [[null, null]], { roles: [], direct: true });
const admin = { from(table) {
  let rows = fixtures[table];
  assert.ok(rows, `Unexpected table ${table}`);
  const query = {
    select() { return query; },
    eq(key, value) { rows = rows.filter(row => row[key] === value); return query; },
    in(key, values) { rows = rows.filter(row => values.includes(row[key])); return query; },
    range(start, end) { rows = rows.slice(start, end + 1); return query; },
    then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
  };
  return query;
} };
const broad = { companyIds: null, siteIds: null };
const get = (company = null, site = null, viewer = broad) => loadActors(admin, 'org', viewer, company, site);
const ids = rows => rows.map(row => row.id).sort();
const expected = ['org-wide', 'company-a', 'company-b', 'site-one', 'site-two', 'neutral-site', 'multi', 'direct'];
assert.deepEqual(ids(await get()), expected.sort(), 'All scopes, permissions, active status, organization isolation');
assert.deepEqual(ids(await get('a')), expected.filter(id => id !== 'company-b').sort(), 'Company includes matching site-restricted assignments');
assert.deepEqual(ids(await get('a', 's1')), ['company-a', 'direct', 'multi', 'neutral-site', 'org-wide', 'site-one'].sort());
assert.deepEqual(ids(await get('a', 's2')), ['company-a', 'direct', 'multi', 'org-wide', 'site-two'].sort());
assert.deepEqual(ids(await get('b', 's1')), ['company-b', 'direct', 'neutral-site', 'org-wide'].sort(), 'Assignments must match both dimensions on the same row');
assert.deepEqual(ids(await get(null, 's1')), expected.filter(id => id !== 'site-two').sort(), 'Company-wide actors remain with All Companies and a selected site');
assert.equal((await get('a', 's1')).filter(row => row.id === 'multi').length, 1, 'Multiple roles and assignments deduplicate');
assert.ok(!(await get(null, null, { companyIds: ['a'], siteIds: ['s1'] })).some(row => row.id === 'company-b'), 'Viewer scope excludes unrelated company-wide actors');
assert.deepEqual(await get('a', 's1'), await get('a', 's1'), 'Sorting remains deterministic');
assert.match(route, /left\.group\.localeCompare.*left\.name\.localeCompare.*left\.email/s);

// Execute the actual metadata and invalidation effects with controlled responses.
const effectStart = page.indexOf('    let cancelled = false;');
const effectEnd = page.indexOf('  }, [organizationId, companyId, siteId]);', effectStart);
const effect = ts.transpile(`function effect() {${page.slice(effectStart, effectEnd)}}`);
const invalidation = page.match(/useEffect\(\(\) => \{ (if \(performedBy[^\n]+) \}, \[actors, performedBy\]\);/)[1];
const pending = [];
let actors = await get('a', 's1');
let performedBy = 'site-one';
const state = {
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } },
  accessToken: 'token', organizationId: 'org', companyId: 'a', siteId: 's1', labourId: '',
  fetch: () => new Promise(resolve => pending.push(resolve)),
  setActors: rows => { actors = rows; new Function('actors', 'performedBy', 'setPerformedBy', invalidation)(actors, performedBy, value => { performedBy = value; }); },
};
for (const name of ['setMetadataError', 'setOrganizationId', 'setAvailable', 'setCompanies', 'setSites', 'setLabour', 'setLabourId']) state[name] = () => {};
const runEffect = () => new Function(...Object.keys(state), `${effect}; return effect();`)(...Object.values(state));
const settle = () => new Promise(resolve => setImmediate(resolve));
const staleCleanup = runEffect();
await settle();
staleCleanup();
state.siteId = 's2';
runEffect();
await settle();
pending[1]({ ok: true, json: async () => ({ actors: await get('a', 's2') }) });
await settle();
assert.equal(performedBy, '', 'Actor losing eligibility resets to All Users');
pending[0]({ ok: true, json: async () => ({ actors: await get('a', 's1') }) });
await settle();
assert.ok(!actors.some(row => row.id === 'site-one'), 'Stale metadata cannot restore old eligibility');
performedBy = 'company-a';
state.setActors(await get('a', 's2'));
assert.equal(performedBy, 'company-a', 'Still-eligible selection is retained');

// Shared request/query paths keep browser, PDF and Excel actor filters identical.
assert.match(page, /params\.set\("performed_by", performedBy\)/);
assert.match(page, /async function exportReport.*new URLSearchParams\(query\)/);
assert.match(route, /if \(performedBy\) query = query\.eq\("created_by", performedBy\)/);
assert.match(route, /loadRows\(request, Boolean\(format\)\).*format === "excel".*format === "pdf"/);
assert.match(route, /companiesQuery\.in\("id", assignments\.companyIds\)/);
assert.match(route, /sitesQuery\.in\("id", assignments\.siteIds\)/);
assert.match(route, /applyCompanySiteScope\(workersQuery, assignments, "current_company_id", "current_site_id"\)/);
assert.doesNotMatch(source, /site\.company_id|\.eq\("company_id"/);
console.log('Labour Audit actor scope regression tests passed.');
