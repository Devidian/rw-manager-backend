function toIsoOrPassthrough(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

export function mapDateTimeString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return toIsoOrPassthrough(value);
}
