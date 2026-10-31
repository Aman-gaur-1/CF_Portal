const batchCollator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
})

export function normalizeBatchSearch(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/\s+/g, "")
}

export function getBatchOption(batch) {
  if (batch && typeof batch === "object") {
    const value = batch.value ?? batch.name ?? batch.batch ?? ""
    const label = batch.label ?? batch.name ?? batch.batch ?? value
    return { value: String(value ?? ""), label: String(label ?? "") }
  }

  const value = String(batch ?? "")
  return { value, label: value }
}

export function sortBatchOptions(batches = []) {
  const seen = new Set()
  const options = []

  for (const batch of batches) {
    const option = getBatchOption(batch)
    if (!option.value || seen.has(option.value)) continue
    seen.add(option.value)
    options.push(option)
  }

  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) => batchCollator.compare(left.option.label, right.option.label) || left.index - right.index)
    .map(({ option }) => option)
}

export function filterBatchOptions(options = [], query = "") {
  const needle = normalizeBatchSearch(query)
  if (!needle) return options
  return options.filter(option => normalizeBatchSearch(`${option.label} ${option.value}`).includes(needle))
}

export function sortBatchNames(names = []) {
  return sortBatchOptions(names).map(option => option.value)
}
