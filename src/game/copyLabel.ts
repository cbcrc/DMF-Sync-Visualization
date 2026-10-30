const NUMBERED = /^(.*?)\s+(\d+)$/;

function split(label: string): { base: string; num: number | null } {
  const m = NUMBERED.exec(label.trim());
  return m ? { base: m[1], num: Number(m[2]) } : { base: label.trim(), num: null };
}

/**
 * Label for a pasted copy: keeps the source's name and takes the next free
 * number. A source without a number counts as number 1, so its first copy is 2.
 */
export function nextCopyLabel(sourceLabel: string, existingLabels: readonly string[]): string {
  const { base } = split(sourceLabel);
  let highest = 1;
  for (const label of existingLabels) {
    const s = split(label);
    if (s.base === base) highest = Math.max(highest, s.num ?? 1);
  }
  return `${base} ${highest + 1}`;
}
