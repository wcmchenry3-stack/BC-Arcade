/**
 * Whether "Delete my data" is running (#3802 review). Set before its network delete starts and
 * cleared when the flow ends, so a `/stats/me` response that lands meanwhile is neither
 * remembered nor used to seed the personal best: the generation bump in `clearMyStatsCache` only
 * comes after the server delete, too late for a response already in flight.
 */
let deleting = false;

export function setDeletingMyData(value: boolean): void {
  deleting = value;
}

export function isDeletingMyData(): boolean {
  return deleting;
}
