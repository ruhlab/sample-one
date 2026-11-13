/** Read an uncompressed SAMPLE/ONE ZIP archive. */
export function readStoredZip(
  bytes: Uint8Array,
): { name: string; data: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: { name: string; data: Uint8Array }[] = [];
  let offset = 0;
  while (
    offset + 4 <= bytes.length &&
    view.getUint32(offset, true) === 0x04034b50
  ) {
    if (offset + 30 > bytes.length) throw new Error("Invalid ZIP header.");
    const flags = view.getUint16(offset + 6, true),
      method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true),
      nameLength = view.getUint16(offset + 26, true),
      extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength,
      end = start + size;
    if (flags & 9 || method !== 0)
      throw new Error(
        "Use a ZIP exported by the sampler (uncompressed WAV files).",
      );
    if (end > bytes.length || start > bytes.length)
      throw new Error("The ZIP is incomplete.");
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 30, offset + 30 + nameLength),
    );
    if (entries.some((entry) => entry.name === name))
      throw new Error("Duplicate ZIP entry.");
    entries.push({ name, data: bytes.slice(start, end) });
    offset = end;
  }
  if (
    offset + 4 > bytes.length ||
    view.getUint32(offset, true) !== 0x02014b50 ||
    !entries.length
  )
    throw new Error("No files found in a valid ZIP.");
  return entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export function readSampleZip(
  bytes: Uint8Array,
): { name: string; data: Uint8Array }[] {
  const entries = readStoredZip(bytes).filter(
    (entry) => /\.wav$/i.test(entry.name) && !entry.name.includes("/"),
  );
  if (!entries.length)
    throw new Error("No WAV files found in the sampler ZIP.");
  return entries;
}

/** A project archive is identified by its root project.json manifest. */
export function isProjectZip(bytes: Uint8Array): boolean {
  return readStoredZip(bytes).some((entry) => entry.name === "project.json");
}
