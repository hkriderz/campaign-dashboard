/** Calls per clock hour of dialer session time (logged-in seconds), not talk time. */
export function formatCallsPerLoggedInHour(
  callsAnswered: number,
  loggedInSeconds: number
): string {
  if (!loggedInSeconds) return "—";
  return (callsAnswered / (loggedInSeconds / 3600)).toFixed(1);
}
