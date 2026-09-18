/**
 * First names, with a last-initial appended only when two people in the same
 * list share a first name — e.g. ["Alex Smith", "Alex Jones"] -> ["Alex S.", "Alex J."].
 */
export function displayNames(userIds: string[], namesByUserId: Map<string, string>): string[] {
  const fullNames = userIds.map((id) => namesByUserId.get(id) ?? "Someone");
  const firstNames = fullNames.map((n) => n.split(" ")[0]);

  return fullNames.map((full, i) => {
    const first = firstNames[i];
    const hasDuplicate = firstNames.some((f, j) => j !== i && f === first);
    if (!hasDuplicate) return first;

    const parts = full.trim().split(" ");
    const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
    return last && last !== first ? `${first} ${last[0]}.` : first;
  });
}
