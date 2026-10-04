"""Generated invariants over real evidence and outbox storage, always offline."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from hypothesis import given, settings
from hypothesis import strategies as st

from orbitdiff.alert_outbox import OutboxStore
from orbitdiff.alert_schedule import daily_due, next_due
from orbitdiff.models import Account, Collection

NOW = datetime(2026, 10, 1, 8, tzinfo=UTC)
ROSTERS = st.sets(st.integers(min_value=1, max_value=20), max_size=20)


def observe(store, ids, day, target='atlas_studio'):
    accounts = tuple(Account(str(ident), f'pixel_{ident}') for ident in sorted(ids))
    return store.apply_collection(Collection(target, len(accounts), accounts, True,
                                              NOW+timedelta(days=day)))


@settings(max_examples=100, deadline=None)
@given(initial=ROSTERS, changed=ROSTERS, gaps=st.integers(min_value=0, max_value=3))
def test_confirmation_survives_gaps_and_reversal_has_new_event_identity(initial, changed, gaps):
    with TemporaryDirectory(prefix='orbit-properties-') as temporary:
        store = OutboxStore(Path(temporary).resolve()/'orbitdiff.sqlite3')
        assert observe(store, initial, 0) == []
        assert observe(store, changed, 1) == []
        for day in range(2, 2+gaps):
            store.record_failed_run('atlas_studio', 'synthetic incomplete observation',
                                    now=NOW+timedelta(days=day))
        confirmed_day = 2+gaps
        events = observe(store, changed, confirmed_day)
        expected = {('following_started', str(i)) for i in changed-initial}
        expected |= {('following_stopped', str(i)) for i in initial-changed}
        assert {(e.event_type, e.actor_id) for e in events} == expected
        assert all(e.first_seen_at == (NOW+timedelta(days=1)).isoformat() for e in events)
        assert all(e.confirmed_at == (NOW+timedelta(days=confirmed_day)).isoformat() for e in events)
        assert observe(store, changed, confirmed_day+1) == []
        assert observe(store, initial, confirmed_day+2) == []
        reversed_events = observe(store, initial, confirmed_day+3)
        reverse_expected = {('following_stopped', str(i)) for i in changed-initial}
        reverse_expected |= {('following_started', str(i)) for i in initial-changed}
        assert {(e.event_type, e.actor_id) for e in reversed_events} == reverse_expected
        assert observe(store, changed, confirmed_day+4) == []
        refollowed = observe(store, changed, confirmed_day+5)
        assert {(e.event_type, e.actor_id) for e in refollowed} == expected
        assert {e.run_id for e in events}.isdisjoint(e.run_id for e in refollowed)
        assert len(store.events('atlas_studio')) == 3*len(expected)


@settings(max_examples=50, deadline=None)
@given(ids=st.sets(st.integers(min_value=1, max_value=80), min_size=1, max_size=80))
def test_digest_membership_is_complete_frozen_and_target_isolated(ids):
    with TemporaryDirectory(prefix='orbit-outbox-properties-') as temporary:
        store = OutboxStore(Path(temporary).resolve()/'orbitdiff.sqlite3')
        observe(store, set(), -1)
        observe(store, set(), -1, 'nova_labs')
        job = store.configure('atlas_studio', login='orbit_demo', runtime=Path('/usr/bin/true'),
                              time='09:00', timezone='UTC', now=NOW)
        store.bind(job['id'], 'synthetic-host')
        store.enable(job['id'], now=NOW)
        observe(store, ids, 1)
        observe(store, ids, 2)
        observe(store, {999}, 1, 'nova_labs')
        observe(store, {999}, 2, 'nova_labs')
        assert store.reconcile_notifications(job['id'], now=NOW+timedelta(days=2)) == len(ids)
        notices = store.notices(job['id'])
        frozen = [(n['id'], n['key'], n['payload']) for n in notices]
        assert sum(n['event_count'] for n in notices) == len(ids)
        assert all(len(n['payload'].encode()) <= 2000 for n in notices)
        payload = '\n'.join(n['payload'] for n in notices)
        for ident in ids:
            assert payload.count(f'https://www.instagram.com/pixel_{ident}/') == 1
        assert 'pixel_999' not in payload
        assert store.reconcile_notifications(job['id'], now=NOW+timedelta(days=3)) == 0
        observe(store, ids|{1000}, 3)
        observe(store, ids|{1000}, 4)
        assert store.reconcile_notifications(job['id'], now=NOW+timedelta(days=4)) == 1
        assert [(n['id'], n['key'], n['payload']) for n in store.notices(job['id'])[:len(notices)]] == frozen


@settings(max_examples=100, deadline=None)
@given(now=st.datetimes(min_value=datetime(2026, 1, 1), max_value=datetime(2027, 1, 1),
                       timezones=st.just(UTC)),
       hour=st.integers(min_value=0, max_value=23), minute=st.integers(min_value=0, max_value=59),
       zone=st.sampled_from(['UTC', 'America/Chicago', 'Europe/Berlin', 'Australia/Lord_Howe']))
def test_due_instants_bracket_the_clock_across_supported_timezones(now, hour, minute, zone):
    time = f'{hour:02}:{minute:02}'
    due, following = daily_due(now, time, zone), next_due(now, time, zone)
    assert due <= now < following
    assert due.tzinfo == UTC and following.tzinfo == UTC
