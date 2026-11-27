export function clampToHour(date: Date): Date {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}
