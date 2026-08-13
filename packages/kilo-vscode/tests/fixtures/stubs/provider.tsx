export function useProvider() {
  return {
    authStates: () => ({}),
    catalogProviders: () => ({}),
    connect() {},
    custom() {},
  }
}
export type EnrichedModel = Record<string, unknown>
