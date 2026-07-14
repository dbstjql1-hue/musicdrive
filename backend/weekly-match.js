const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function getKstWeekWindow(value = new Date()) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error('유효한 날짜가 필요합니다.');

  const kstClock = new Date(instant.getTime() + KST_OFFSET_MS);
  const daysSinceMonday = (kstClock.getUTCDay() + 6) % 7;
  const kstMidnightAsUtc = Date.UTC(
    kstClock.getUTCFullYear(),
    kstClock.getUTCMonth(),
    kstClock.getUTCDate()
  );
  const startAtMs = kstMidnightAsUtc - (daysSinceMonday * DAY_MS) - KST_OFFSET_MS;
  const endAtMs = startAtMs + WEEK_MS;

  return {
    startAt: new Date(startAtMs).toISOString(),
    endAt: new Date(endAtMs).toISOString(),
    weekOrdinal: Math.floor((startAtMs + KST_OFFSET_MS) / WEEK_MS)
  };
}

function selectWeeklyMatch(matches, value = new Date()) {
  const window = getKstWeekWindow(value);
  const sortedMatches = [...(matches || [])].sort((left, right) => {
    const createdDifference = new Date(left.created_at || 0) - new Date(right.created_at || 0);
    return createdDifference || String(left.id).localeCompare(String(right.id));
  });

  if (sortedMatches.length === 0) return { ...window, matchId: null };

  const weekStartMs = new Date(window.startAt).getTime();
  const eligibleMatches = sortedMatches.filter(match => {
    const createdAtMs = new Date(match.created_at || 0).getTime();
    return Number.isFinite(createdAtMs) && createdAtMs <= weekStartMs;
  });
  const rotationPool = eligibleMatches.length > 0 ? eligibleMatches : sortedMatches;
  const index = ((window.weekOrdinal % rotationPool.length) + rotationPool.length) % rotationPool.length;

  return { ...window, matchId: rotationPool[index].id };
}

module.exports = { getKstWeekWindow, selectWeeklyMatch };
