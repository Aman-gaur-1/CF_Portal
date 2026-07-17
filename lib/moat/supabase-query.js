export function uniqueValues(values) {
  return [...new Set((values || []).filter(Boolean))]
}

export async function selectRowsByIds(supabase, table, columns, ids, { chunkSize = 100 } = {}) {
  const uniqueIds = uniqueValues(ids)
  if (uniqueIds.length === 0) return []

  const rows = []
  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const chunk = uniqueIds.slice(index, index + chunkSize)
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in('id', chunk)

    if (error) throw error
    rows.push(...(data || []))
  }

  return rows
}
