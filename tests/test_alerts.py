from datetime import UTC, datetime, timedelta
from pathlib import Path
from shutil import copy2

import pytest

from orbitdiff.alert_delivery import DeliveryResult
from orbitdiff.alert_outbox import OutboxStore
from orbitdiff.models import Account, Collection
from orbitdiff.providers.base import ProviderError

NOW = datetime(2026, 10, 1, 8, tzinfo=UTC)


def job(tmp_path):
    store = OutboxStore(tmp_path/'orbitdiff.sqlite3')
    store.apply_collection(Collection('atlas_studio', 0, (), True, NOW-timedelta(days=1)))
    row = store.configure('atlas_studio', login='orbit_demo', runtime=Path('/usr/bin/true'),
                          time='09:00', timezone='UTC', now=NOW)
    store.bind(row['id'], 'host-123')
    store.enable(row['id'], now=NOW)
    return store,row['id']


class RecordingSender:
    idempotent = False
    def __init__(self):
        self.payloads = []
    def send(self,payload,key):
        self.payloads.append(payload)
        return DeliveryResult('accepted','submitted_to_macos')


def provider_at(now):
    class Provider:
        def collect(self,target):
            return Collection(target,1,(Account('1','pixel_forge'),),True,now)
    return Provider


def test_three_fixture_days_collect_once_and_notify_only_confirmation(tmp_path):
    from orbitdiff.alerts import run_job

    store,ident = job(tmp_path)
    sender = RecordingSender()
    for day in (0,1,2):
        now = NOW+timedelta(days=day,hours=1)
        result = run_job(store,ident,now=now,provider_factory=provider_at(now),sender=sender)
        assert result['collection']['state'] == 'success'
        again = run_job(store,ident,now=now,provider_factory=lambda: (_ for _ in ()).throw(AssertionError()),sender=sender)
        assert again['collection'] is None
    assert len(sender.payloads) == 1
    assert 'pixel_forge' in sender.payloads[0]
    assert len(store.jobs()[0]['runs']) == 3
    assert store.events('atlas_studio')[0].first_seen_at == '2026-10-01T09:00:00+00:00'


def test_manual_contention_consumes_window_without_blocking(tmp_path):
    from orbitdiff.alerts import run_job

    store,ident = job(tmp_path)
    store.reserve_live_attempt('atlas_studio',now=NOW+timedelta(minutes=50))
    result = run_job(store,ident,now=NOW+timedelta(hours=1),
                      provider_factory=lambda: (_ for _ in ()).throw(AssertionError()),sender=RecordingSender())
    assert result['collection']['reason'] == 'cooldown'
    assert store.jobs()[0]['state'] == 'enabled'
    assert store.jobs()[0]['runs'][0]['state'] == 'skipped'


def test_failure_blocks_repetition_and_resume_reports_real_recovery(tmp_path):
    from orbitdiff.alerts import run_job

    store,ident = job(tmp_path)
    sender = RecordingSender()
    class Failing:
        def collect(self,target):
            raise ProviderError('secret content')
    now = NOW+timedelta(hours=1)
    first = run_job(store,ident,now=now,provider_factory=Failing,sender=sender)
    assert first['outcome'] == 'partial'
    assert store.jobs()[0]['state'] == 'blocked'
    later = run_job(store,ident,now=now+timedelta(days=1),provider_factory=lambda: (_ for _ in ()).throw(AssertionError()),sender=sender)
    assert later['collection'] is None
    assert len(sender.payloads) == 1
    assert 'secret content' not in sender.payloads[0]
    store.enable(ident,now=NOW+timedelta(days=2))
    now = NOW+timedelta(days=2,hours=1)
    run_job(store,ident,now=now,provider_factory=provider_at(now),sender=sender)
    assert len(sender.payloads) == 2
    assert 'complete' in sender.payloads[-1]


def test_delivery_only_does_not_create_collection_attempt(tmp_path):
    from orbitdiff.alerts import deliver_job

    store,ident = job(tmp_path)
    for day in (1,2):
        store.apply_collection(provider_at(NOW+timedelta(days=day))().collect('atlas_studio'))
    before = store.status('atlas_studio')
    assert deliver_job(store,ident,now=NOW+timedelta(days=2),sender=RecordingSender())['deliveries']
    assert store.status('atlas_studio') == before
    assert store.jobs()[0]['runs'] == []


def test_runtime_mismatch_stops_before_provider_creation(tmp_path):
    from orbitdiff.alerts import run_job

    store,ident = job(tmp_path)
    result = run_job(store,ident,now=NOW+timedelta(hours=1),runtime=Path('/usr/bin/false'),
                      provider_factory=lambda: (_ for _ in ()).throw(AssertionError()),sender=RecordingSender())
    assert result['outcome'] == 'blocked'
    assert result['reason'] == 'runtime_mismatch'
    assert store.jobs()[0]['runs'] == []


def test_delivery_lease_starts_after_slow_collection_finishes(tmp_path, monkeypatch):
    from orbitdiff.alerts import run_job

    store, ident = job(tmp_path)
    elapsed = [0.0]
    monkeypatch.setattr('time.monotonic', lambda: elapsed[0])
    store.status_notice(ident, identity='synthetic', payload='Synthetic status', now=NOW)

    class SlowProvider:
        def collect(self, target):
            elapsed[0] += 180
            return Collection(target, 0, (), True, NOW+timedelta(hours=1, minutes=3))

    run_job(store, ident, now=NOW+timedelta(hours=1), provider_factory=SlowProvider, sender=RecordingSender())
    assert store.delivery_attempts(ident)[0]['started_at'] == '2026-10-01T09:03:00+00:00'
    assert store.jobs()[0]['runs'][0]['finished_at'] == '2026-10-01T09:03:00+00:00'


def test_committed_blocking_window_already_has_durable_notice(tmp_path):
    store, ident = job(tmp_path)
    now = NOW+timedelta(hours=1)
    window = store.claim_window(ident, now=now)
    store.finish_window(window['id'], state='failed', reason='provider_failed', now=now, block=True)
    restarted = OutboxStore(store.path)
    assert restarted.job(ident)['state'] == 'blocked'
    assert len(restarted.notices(ident)) == 1
    assert 'could not complete' in restarted.notices(ident)[0]['payload']


def test_notice_failure_rolls_back_window_transition(tmp_path, monkeypatch):
    store, ident = job(tmp_path)
    now = NOW+timedelta(hours=1)
    window = store.claim_window(ident, now=now)

    def interrupted(*args, **kwargs):
        raise OSError('synthetic interruption')

    with monkeypatch.context() as patch:
        patch.setattr(store, '_insert_notice', interrupted)
        with pytest.raises(OSError):
            store.finish_window(window['id'], state='failed', reason='provider_failed', now=now, block=True)
    assert store.job(ident)['state'] == 'enabled'
    assert store.jobs()[0]['runs'][0]['state'] == 'running'
    store.finish_window(window['id'], state='failed', reason='provider_failed', now=now, block=True)
    assert len(store.notices(ident)) == 1


def test_committed_auth_failure_blocks_even_if_orchestration_crashes(tmp_path, monkeypatch):
    from orbitdiff.alerts import run_job
    from orbitdiff.providers.base import SessionUnavailableError

    store, ident = job(tmp_path)
    calls = []

    class Rejected:
        def collect(self, target):
            calls.append(target)
            raise SessionUnavailableError('synthetic rejected session')

    def interrupted(*args, **kwargs):
        raise OSError('crash after persisted collection result')

    with monkeypatch.context() as patch:
        patch.setattr(store, 'finish_window', interrupted)
        with pytest.raises(OSError):
            run_job(store, ident, now=NOW+timedelta(hours=1), provider_factory=Rejected, sender=RecordingSender())
    restarted = OutboxStore(store.path)
    assert restarted.job(ident)['state'] == 'blocked'
    run_job(restarted, ident, now=NOW+timedelta(days=1, hours=1), provider_factory=Rejected, sender=RecordingSender())
    assert len(calls) == 1
    assert len(restarted.notices(ident)) == 1


def test_copied_workspace_cannot_deliver_original_subscription(tmp_path):
    from orbitdiff.alerts import deliver_job

    store, ident = job(tmp_path/'original')
    for day in (1,2):
        store.apply_collection(provider_at(NOW+timedelta(days=day))().collect('atlas_studio'))
    store.reconcile_notifications(ident, now=NOW+timedelta(days=2))
    duplicate = tmp_path/'inspection-copy'
    duplicate.mkdir()
    copy2(store.path, duplicate/'orbitdiff.sqlite3')
    sender = RecordingSender()
    result = deliver_job(OutboxStore(duplicate/'orbitdiff.sqlite3'), ident,
                         now=NOW+timedelta(days=3), sender=sender)
    assert result['outcome'] == 'blocked'
    assert result['reason'] == 'workspace_mismatch'
    assert sender.payloads == []
    assert store.notices(ident)[0]['state'] == 'pending'


def test_late_auth_failure_blocks_after_window_interruption(tmp_path):
    from orbitdiff.alerts import run_job
    from orbitdiff.providers.base import SessionUnavailableError

    store, ident = job(tmp_path)
    calls = []
    attempted_at = NOW+timedelta(hours=1)

    class Suspended:
        def collect(self, target):
            calls.append(target)
            assert store.claim_window(ident, now=attempted_at+timedelta(minutes=31)) is None
            raise SessionUnavailableError('synthetic rejected session')

    run_job(store, ident, now=attempted_at, provider_factory=Suspended, sender=RecordingSender())
    status = store.jobs()[0]
    assert status['state'] == 'blocked'
    assert status['blocked_reason'] == 'session_unavailable'
    assert status['runs'][0]['state'] == 'interrupted'
    assert len(store.notices(ident)) == 1
    run_job(store, ident, now=attempted_at+timedelta(days=1),
            provider_factory=Suspended, sender=RecordingSender())
    assert calls == ['atlas_studio']
    recovered_at = attempted_at+timedelta(days=2)
    store.enable(ident, now=recovered_at-timedelta(hours=1))
    sender = RecordingSender()
    run_job(store, ident, now=recovered_at, provider_factory=provider_at(recovered_at), sender=sender)
    assert sum('recovered' in notice['payload'] for notice in store.notices(ident)) == 1
    run_job(store, ident, now=recovered_at+timedelta(days=1),
            provider_factory=provider_at(recovered_at+timedelta(days=1)), sender=sender)
    assert sum('recovered' in notice['payload'] for notice in store.notices(ident)) == 1


def test_delayed_interrupted_failure_cannot_block_a_newer_admission(tmp_path):
    store, ident = job(tmp_path)
    attempted_at = NOW+timedelta(hours=1)
    window = store.claim_window(ident, now=attempted_at)
    store.reserve_live_attempt('atlas_studio', now=attempted_at)
    assert store.claim_window(ident, now=attempted_at+timedelta(minutes=31)) is None
    store.finish_window(window['id'], state='failed', reason='session_unavailable',
                        now=attempted_at+timedelta(minutes=31), block=True)
    store.enable(ident, now=attempted_at+timedelta(minutes=32))
    newer_at = attempted_at+timedelta(minutes=33)
    store.reserve_live_attempt('atlas_studio', now=newer_at)
    store.apply_collection(Collection('atlas_studio', 0, (), True, newer_at), attempted_at=newer_at)
    store.finish_window(window['id'], state='failed', reason='session_unavailable',
                        now=newer_at+timedelta(seconds=1), block=True)
    assert store.job(ident)['state'] == 'enabled'
    assert len(store.notices(ident)) == 1


def test_old_auth_result_cannot_block_after_newer_manual_admission(tmp_path):
    from orbitdiff.store import StaleAttemptError

    store, ident = job(tmp_path)
    attempted_at = NOW+timedelta(hours=1)
    store.claim_window(ident, now=attempted_at)
    store.reserve_live_attempt('atlas_studio', now=attempted_at)
    newer_at = attempted_at+timedelta(minutes=31)
    assert store.claim_window(ident, now=newer_at) is None
    store.reserve_live_attempt('atlas_studio', now=newer_at)
    with pytest.raises(StaleAttemptError):
        store.record_failed_run('atlas_studio', attempted_at, reason='session_unavailable',
                                attempted_at=attempted_at)
    assert store.job(ident)['state'] == 'enabled'
    assert store.notices(ident) == []


def test_interrupted_failure_replay_is_idempotent_after_resume(tmp_path):
    store, ident = job(tmp_path)
    attempted_at = NOW+timedelta(hours=1)
    window = store.claim_window(ident, now=attempted_at)
    store.reserve_live_attempt('atlas_studio', now=attempted_at)
    later = attempted_at+timedelta(minutes=31)
    assert store.claim_window(ident, now=later) is None
    store.finish_window(window['id'], state='failed', reason='session_unavailable', now=later, block=True)
    store.enable(ident, now=later)
    store.finish_window(window['id'], state='failed', reason='session_unavailable', now=later, block=True)
    assert store.job(ident)['state'] == 'enabled'
    assert len(store.notices(ident)) == 1


def test_blocked_collection_remains_visible_after_successful_delivery(tmp_path):
    from orbitdiff.alerts import run_job

    store, ident = job(tmp_path)
    attempted_at = NOW+timedelta(hours=1)
    window = store.claim_window(ident, now=attempted_at)
    store.finish_window(window['id'], state='failed', reason='session_unavailable',
                        now=attempted_at, block=True)
    result = run_job(store, ident, now=attempted_at+timedelta(days=1),
                     provider_factory=lambda: (_ for _ in ()).throw(AssertionError()),
                     sender=RecordingSender())
    assert result['outcome'] == 'blocked'
    assert result['reason'] == 'session_unavailable'
    assert result['collection'] is None
    assert result['deliveries'][0]['state'] == 'accepted'
