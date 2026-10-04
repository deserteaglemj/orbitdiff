import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier

import pytest

from orbitdiff.models import Account, Collection

NOW = datetime(2026, 10, 1, 8, tzinfo=UTC)


def setup(tmp_path, target='atlas_studio'):
    from orbitdiff.alert_outbox import OutboxStore

    store = OutboxStore(tmp_path/'orbitdiff.sqlite3')
    store.apply_collection(Collection(target, 0, (), True, NOW-timedelta(days=1)))
    job = store.configure(target, login='orbit_demo', runtime=Path('/usr/bin/true'),
                          time='09:00', timezone='UTC', now=NOW)
    store.bind(job['id'], 'host-'+target)
    store.enable(job['id'], now=NOW)
    return store, job['id']


def observe(store, names, day, target='atlas_studio'):
    accounts = tuple(Account(str(i), name) for i, name in names.items())
    return store.apply_collection(Collection(target, len(accounts), accounts, True,
                                              NOW+timedelta(days=day)))


def confirmed(store, names=None, day=1, target='atlas_studio'):
    names = {1: 'pixel_forge'} if names is None else names
    observe(store, names, day, target)
    return observe(store, names, day+1, target)


def test_committed_events_recover_once_without_recollecting(tmp_path):
    store, job = setup(tmp_path)
    assert store.reconcile_notifications(job, now=NOW) == 0
    observe(store, {1:'pixel_forge'}, 1)
    assert store.reconcile_notifications(job, now=NOW+timedelta(days=1)) == 0
    observe(store, {1:'pixel_forge'}, 2)
    assert store.reconcile_notifications(job, now=NOW+timedelta(days=2)) == 1
    assert store.reconcile_notifications(job, now=NOW+timedelta(days=3)) == 0
    notices = store.notices(job)
    assert len(notices) == 1
    assert 'pixel_forge' in notices[0]['payload']
    assert '2026-10-02' in notices[0]['payload']
    assert '2026-10-03' in notices[0]['payload']


def test_activation_cutoff_and_refollow_have_distinct_delivery_identity(tmp_path):
    store, job = setup(tmp_path)
    confirmed(store)
    store.reconcile_notifications(job, now=NOW+timedelta(days=2))
    first = store.notices(job)[0]['key']
    confirmed(store, {}, 3)
    confirmed(store, day=5)
    store.reconcile_notifications(job, now=NOW+timedelta(days=6))
    assert len(store.notices(job)) == 2
    assert store.notices(job)[1]['key'] != first
    store.remove(job)
    new_job = store.configure('atlas_studio', login='orbit_demo', runtime=Path('/usr/bin/true'),
                              time='09:00', timezone='UTC', now=NOW+timedelta(days=7))
    store.bind(new_job['id'], 'host-new')
    store.enable(new_job['id'], now=NOW+timedelta(days=7))
    assert store.reconcile_notifications(new_job['id'], now=NOW+timedelta(days=8)) == 0


def test_frozen_large_digests_preserve_all_events_and_new_arrivals(tmp_path):
    store, job = setup(tmp_path)
    names = {i:f'pixel_{i}' for i in range(40)}
    confirmed(store, names)
    assert store.reconcile_notifications(job, now=NOW+timedelta(days=2)) == 40
    before = store.notices(job)
    assert len(before) > 1
    assert all(len(n['payload'].encode()) <= 2000 for n in before)
    assert sum(n['event_count'] for n in before) == 40
    claimed = store.claim_notice(job, now=NOW+timedelta(days=2), idempotent=False)
    names[40] = 'new_arrival'
    confirmed(store, names, 3)
    store.reconcile_notifications(job, now=NOW+timedelta(days=4))
    after = store.notices(job)
    assert [(n['id'],n['payload'],n['key']) for n in after[:len(before)]] == [
        (n['id'],n['payload'],n['key']) for n in before]
    assert sum(n['event_count'] for n in after) == 41
    assert claimed['payload'] == before[0]['payload']


def test_concurrent_delivery_and_expired_lease_are_not_resent(tmp_path):
    store, job = setup(tmp_path)
    confirmed(store)
    store.reconcile_notifications(job, now=NOW+timedelta(days=2))
    barrier = Barrier(2)

    def claim(_):
        barrier.wait()
        return store.claim_notice(job, now=NOW+timedelta(days=2), idempotent=False)

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(claim, range(2)))
    assert sum(c is not None for c in claims) == 1
    assert store.claim_notice(job, now=NOW+timedelta(days=3), idempotent=False) is None
    notice = store.notices(job)[0]
    assert notice['state'] == 'uncertain'
    assert store.jobs()[0]['delivery_warning'] == 'submission_uncertain'
    store.resolve(notice['id'], action='discard', now=NOW+timedelta(days=3))
    assert store.notices(job)[0]['state'] == 'discarded'


def test_definite_failure_retries_are_bounded_and_pause_stops_delivery(tmp_path):
    from orbitdiff.alert_delivery import DeliveryResult, dispatch

    store, job = setup(tmp_path)
    confirmed(store)
    store.reconcile_notifications(job, now=NOW+timedelta(days=2))

    class Failing:
        idempotent = False
        def send(self, payload, key):
            return DeliveryResult('failed', 'adapter_unavailable')

    store.pause(job)
    assert dispatch(store, job, Failing(), now=NOW+timedelta(days=2)) == []
    store.enable(job, now=NOW+timedelta(days=2))
    for day in (3,4,5):
        assert dispatch(store, job, Failing(), now=NOW+timedelta(days=day))[0]['state'] == 'failed'
    assert dispatch(store, job, Failing(), now=NOW+timedelta(days=6)) == []
    assert store.notices(job)[0]['attempts'] == 3
    assert len(store.delivery_attempts(job)) == 3


def test_idempotent_retry_reuses_frozen_key_and_ignores_stale_owner(tmp_path):
    store, job = setup(tmp_path)
    confirmed(store)
    store.reconcile_notifications(job, now=NOW+timedelta(days=2))
    first = store.claim_notice(job, now=NOW+timedelta(days=2), idempotent=True)
    later = store.claim_notice(job, now=NOW+timedelta(days=3), idempotent=True)
    assert first['key'] == later['key']
    store.finish_notice(first['id'], first['lease_token'], state='accepted', detail='submitted', now=NOW)
    assert store.notices(job)[0]['state'] == 'sending'
    store.finish_notice(later['id'], later['lease_token'], state='accepted', detail='submitted', now=NOW)
    assert store.notices(job)[0]['state'] == 'accepted'


def test_jobs_and_subscriptions_do_not_mix_targets(tmp_path):
    store, a = setup(tmp_path)
    _, b = setup(tmp_path, 'nova_labs')
    confirmed(store, {1:'pixel_forge'})
    confirmed(store, {2:'ember_lab'}, target='nova_labs')
    store.reconcile_notifications(a, now=NOW)
    store.reconcile_notifications(b, now=NOW)
    assert 'ember_lab' not in store.notices(a)[0]['payload']
    assert 'pixel_forge' not in store.notices(b)[0]['payload']
    assert store.notices(a)[0]['key'] != store.notices(b)[0]['key']


def test_macos_adapter_uses_constant_program_and_argv(monkeypatch):
    from orbitdiff.alert_delivery import MacOSSender

    monkeypatch.setattr('orbitdiff.alert_delivery.sys.platform', 'darwin')
    observed = []
    payload = 'Data " & do shell script "unexpected\nnot code'

    def run(args, **kwargs):
        observed.append((args,kwargs))
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr('orbitdiff.alert_delivery.subprocess.run', run)
    result = MacOSSender().send(payload,'stable-key')
    args,kwargs = observed[0]
    assert args[-1] == payload
    assert payload not in kwargs['input']
    assert kwargs['shell'] is False
    assert kwargs['timeout'] == 10
    assert result.state == 'accepted'
    assert result.detail == 'submitted_to_macos'


@pytest.mark.parametrize(('error','state'), [(OSError(), 'failed'),
    (subprocess.TimeoutExpired('osascript',10), 'uncertain')])
def test_native_delivery_failures_do_not_claim_display(monkeypatch,error,state):
    from orbitdiff.alert_delivery import MacOSSender

    monkeypatch.setattr('orbitdiff.alert_delivery.sys.platform','darwin')
    def run(*a, **kw):
        raise error
    monkeypatch.setattr('orbitdiff.alert_delivery.subprocess.run',run)
    assert MacOSSender().send('synthetic','key').state == state


def test_unsupported_platform_has_no_submission(monkeypatch):
    from orbitdiff.alert_delivery import MacOSSender

    monkeypatch.setattr('orbitdiff.alert_delivery.sys.platform','linux')
    def run(*a,**kw):
        raise AssertionError('must not run')
    monkeypatch.setattr('orbitdiff.alert_delivery.subprocess.run',run)
    assert MacOSSender().send('synthetic','key').state == 'failed'


def test_delivery_batch_refreshes_leases_as_time_passes(tmp_path,monkeypatch):
    from orbitdiff.alert_delivery import DeliveryResult, dispatch

    store,job=setup(tmp_path)
    for i in range(3):
        store.status_notice(job,identity=str(i),payload='Synthetic status',now=NOW)
    elapsed=[0.0]
    monkeypatch.setattr('time.monotonic',lambda: elapsed[0])
    class SlowSender:
        idempotent=False
        def send(self,payload,key):
            elapsed[0]+=80
            return DeliveryResult('accepted','submitted_to_macos')
    dispatch(store,job,SlowSender(),now=NOW)
    attempts=store.delivery_attempts(job)
    assert attempts[1]['started_at']=='2026-10-01T08:01:20+00:00'
    assert attempts[-1]['finished_at']=='2026-10-01T08:04:00+00:00'


def test_late_sender_cannot_report_success_after_lease_is_lost(tmp_path):
    from orbitdiff.alert_delivery import DeliveryResult, dispatch

    store,job=setup(tmp_path)
    store.status_notice(job,identity='one',payload='Synthetic status',now=NOW)
    class SuspendedSender:
        idempotent=False
        def send(self,payload,key):
            assert store.claim_notice(job,now=NOW+timedelta(minutes=3),idempotent=False) is None
            return DeliveryResult('accepted','submitted_to_macos')
    receipts=dispatch(store,job,SuspendedSender(),now=NOW)
    assert receipts[0]['state']=='uncertain'
    assert store.notices(job)[0]['state']=='uncertain'


@pytest.mark.parametrize('elapsed', [120, 121, 180])
def test_expired_completion_records_uncertainty_without_another_worker(tmp_path, elapsed):
    store, job = setup(tmp_path)
    store.status_notice(job, identity='one', payload='Synthetic status', now=NOW)
    notice = store.claim_notice(job, now=NOW, idempotent=False)
    assert notice is not None
    accepted = store.finish_notice(notice['id'], notice['lease_token'], state='accepted',
                                   detail='submitted_to_macos', now=NOW+timedelta(seconds=elapsed))
    assert accepted is False
    persisted = store.notices(job)[0]
    assert persisted['state'] == 'uncertain'
    assert persisted['payload'] == notice['payload']
    assert persisted['key'] == notice['key']
    assert store.delivery_attempts(job)[0]['state'] == 'uncertain'
    assert store.jobs()[0]['delivery_warning'] == 'submission_uncertain'
    assert store.claim_notice(job, now=NOW+timedelta(days=1), idempotent=False) is None


def test_completion_before_lease_expiry_retains_acceptance(tmp_path):
    store, job = setup(tmp_path)
    store.status_notice(job, identity='one', payload='Synthetic status', now=NOW)
    notice = store.claim_notice(job, now=NOW, idempotent=False)
    assert store.finish_notice(notice['id'], notice['lease_token'], state='accepted',
                               detail='submitted_to_macos', now=NOW+timedelta(seconds=119))
    assert store.notices(job)[0]['state'] == 'accepted'
