from datetime import UTC, datetime, timedelta
from pathlib import Path

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
