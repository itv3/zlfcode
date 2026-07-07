import type { VariantEntry } from "./CustomProviderModelCard"

export function prioritizeVariants(items: VariantEntry[], name: string) {
  const variants = items.map((item) => ({ ...item }))
  const target = name.trim()
  const index = variants.findIndex((item) => item.name.trim() === target)
  if (index <= 0) return variants

  const [selected] = variants.splice(index, 1)
  return selected ? [selected, ...variants] : variants
}
