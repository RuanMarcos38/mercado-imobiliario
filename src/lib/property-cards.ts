/** Deduplicate presentation only; keep source records and server pagination intact. */
export function uniquePropertyCards<T extends { id: string; source_url?: string | null }>(
  rows: readonly T[],
): T[] {
  const ids = new Set<string>();
  const urls = new Set<string>();
  return rows.filter((row) => {
    const url = row.source_url?.trim();
    const duplicate = ids.has(row.id) || Boolean(url && urls.has(url));
    ids.add(row.id);
    if (url) urls.add(url);
    return !duplicate;
  });
}
