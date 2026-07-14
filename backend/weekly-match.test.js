const test = require('node:test');
const assert = require('node:assert/strict');
const { getKstWeekWindow, selectWeeklyMatch } = require('./weekly-match');

test('KST week starts Monday at midnight and ends the next Monday', () => {
  const window = getKstWeekWindow('2026-07-14T06:00:00.000Z');
  assert.equal(window.startAt, '2026-07-12T15:00:00.000Z');
  assert.equal(window.endAt, '2026-07-19T15:00:00.000Z');
});

test('weekly selection stays stable during a week and rotates next week', () => {
  const matches = [
    { id: 'match-a', created_at: '2026-06-01T00:00:00.000Z' },
    { id: 'match-b', created_at: '2026-06-02T00:00:00.000Z' }
  ];
  const tuesday = selectWeeklyMatch(matches, '2026-07-14T06:00:00.000Z');
  const sunday = selectWeeklyMatch(matches, '2026-07-19T14:59:00.000Z');
  const nextMonday = selectWeeklyMatch(matches, '2026-07-19T15:01:00.000Z');

  assert.equal(tuesday.matchId, sunday.matchId);
  assert.notEqual(tuesday.matchId, nextMonday.matchId);
});

test('a match created during the current week joins rotation next week', () => {
  const matches = [
    { id: 'existing', created_at: '2026-06-01T00:00:00.000Z' },
    { id: 'new-this-week', created_at: '2026-07-14T00:00:00.000Z' }
  ];
  const currentWeek = selectWeeklyMatch(matches, '2026-07-15T00:00:00.000Z');
  assert.equal(currentWeek.matchId, 'existing');
});
