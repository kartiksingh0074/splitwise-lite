/** RFC 4180 field escaping: quote if it contains a comma, quote, or newline; double up internal quotes. */
export function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function csvRow(fields: string[]): string {
  return fields.map(csvEscape).join(",") + "\r\n";
}
