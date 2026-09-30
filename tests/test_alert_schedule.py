from datetime import UTC, datetime

import pytest


@pytest.mark.parametrize(('now', 'time', 'zone', 'due', 'next_time'), [
    ('2026-10-01T13:59:00+00:00', '09:00', 'America/Chicago',
     '2026-09-30T14:00:00+00:00', '2026-10-01T14:00:00+00:00'),
    ('2026-10-01T14:00:00+00:00', '09:00', 'America/Chicago',
     '2026-10-01T14:00:00+00:00', '2026-10-02T14:00:00+00:00'),
    ('2026-03-08T08:00:00+00:00', '02:30', 'America/Chicago',
     '2026-03-08T08:00:00+00:00', '2026-03-09T07:30:00+00:00'),
    ('2026-11-01T07:30:00+00:00', '01:30', 'America/Chicago',
     '2026-11-01T06:30:00+00:00', '2026-11-02T07:30:00+00:00'),
    ('2028-02-29T09:00:00+00:00', '09:00', 'UTC',
     '2028-02-29T09:00:00+00:00', '2028-03-01T09:00:00+00:00'),
])
def test_daily_windows_handle_calendar_and_dst(now, time, zone, due, next_time):
    from orbitdiff.alert_schedule import daily_due, next_due

    current = datetime.fromisoformat(now)
    assert daily_due(current, time, zone).isoformat() == due
    assert next_due(current, time, zone).isoformat() == next_time


@pytest.mark.parametrize(('time', 'zone'), [('24:00', 'UTC'), ('9:00', 'UTC'),
                                               ('09:00', 'Unknown/Zone')])
def test_bad_schedule_inputs_are_rejected(time, zone):
    from orbitdiff.alert_schedule import daily_due

    with pytest.raises(ValueError):
        daily_due(datetime(2026, 10, 1, tzinfo=UTC), time, zone)


def test_schedule_rejects_naive_time():
    from orbitdiff.alert_schedule import daily_due

    with pytest.raises(ValueError):
        daily_due(datetime(2026, 10, 1), '09:00', 'UTC')
