import type { VariantEntry } from "./CustomProviderModelCard"

export function prioritizeVariants(items: VariantEntry[], name: string) {
  const target = name.trim()
  const index = items.findIndex((item) => item.name.trim() === target)
  if (index <= 0) return items

  const variants = items.map((item) => ({ ...item }))
  const [selected] = variants.splice(index, 1)
  return selected ? [selected, ...variants] : variants
}
