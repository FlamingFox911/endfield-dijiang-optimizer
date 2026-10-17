/** Shared identity for official wiki costs and calculator inventory names. */
export function materialIdFromName(name: string): string {
  return name
    // Preserve compatibility characters such as Roman numerals Ⅰ/Ⅱ as I/II.
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
