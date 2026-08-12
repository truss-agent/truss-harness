export function compareModelIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortedModelIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    compareModelIds,
  );
}

export function sortedModelEntries<T extends { readonly id: string }>(
  values: readonly T[],
): T[] {
  return [...values].sort((left, right) => compareModelIds(left.id, right.id));
}
