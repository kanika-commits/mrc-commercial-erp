export type RevisionPo = { id: string; revision_family_id?: string | null; revision_no?: number | null; status?: string | null; superseded_by_revision_id?: string | null; created_at?: string | null };

export function latestEffectiveRevision(rows: RevisionPo[], sourceId?: string) {
  const source = sourceId ? rows.find((row) => row.id === sourceId) : rows[0];
  if (!source) return null;
  const family = source.revision_family_id;
  const candidates = rows.filter((row) =>
    family ? row.revision_family_id === family : row.id === source.id,
  ).filter((row) => ["approved", "issued"].includes(String(row.status)) && !row.superseded_by_revision_id);
  return candidates.sort((a, b) => Number(b.revision_no || 0) - Number(a.revision_no || 0) || String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || source;
}

export function latestEffectiveByFamily(rows: RevisionPo[]) {
  const groups = new Map<string, RevisionPo[]>();
  for (const row of rows) groups.set(row.revision_family_id || row.id, [...(groups.get(row.revision_family_id || row.id) || []), row]);
  return [...groups.values()].map((group) => latestEffectiveRevision(group));
}

export function effectiveRevisionIds(rows: RevisionPo[]) {
  return new Set(latestEffectiveByFamily(rows).filter(Boolean).map((row) => row!.id));
}
