const encoder = new TextEncoder();

export function byteSize(value: unknown) {
  return encoder.encode(JSON.stringify(value)).length;
}

// Serialized array = "[" + items joined by "," + "]", so each item costs its size + 1.
export function chunkBySize<T>(items: readonly T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2;
  for (const item of items) {
    const size = byteSize(item) + 1;
    if (current.length > 0 && currentBytes + size > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
