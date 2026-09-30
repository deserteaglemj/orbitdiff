from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier

import pytest

from orbitdiff.models import Account, Collection
from orbitdiff.store import GraphStore

START = datetime(2026, 10, 1, 8, tzinfo=UTC)


def configured(tmp_path):
    from orbitdiff.alert_store import AlertStore

    store = AlertStore(tmp_path / 'orbitdiff.sqlite3')
    store.apply_collection(Collection('atlas_studio', 1, (Account('1', 'nova_labs'),),
                                      True, START - timedelta(days=1)))
    job = store.configure('atlas_studio', login='orbit_demo', runtime=Path('/usr/bin/true'),
                          time='09:00', timezone='UTC', now=START)
    store.bind(job['id'], 'host-123')
    store.enable(job['id'], now=START)
    return store, job['id']


def test_status_does_not_create_or_migrate_database(tmp_path):
    from orbitdiff.alert_store import AlertStore

    path = tmp_path / 'missing' / 'orbitdiff.sqlite3'
    assert AlertStore(path).jobs() == []
    assert not path.parent.exists()
    legacy = GraphStore(tmp_path / 'legacy' / 'orbitdiff.sqlite3')
    legacy.initialize()
    before = legacy.path.read_bytes(), legacy.path.stat().st_mtime_ns
    assert AlertStore(legacy.path).jobs() == []
    assert (legacy.path.read_bytes(), legacy.path.stat().st_mtime_ns) == before


def test_setup_is_idempotent_inactive_and_preserves_evidence(tmp_path):
    store, job_id = configured(tmp_path)
    original = store.status('atlas_studio')
    job = store.configure('atlas_studio', login='orbit_demo', runtime=Path('/usr/bin/true'),
                          time='09:00', timezone='UTC', now=START)
    assert job['id'] == job_id
    assert store.status('atlas_studio') == original
    assert len(store.jobs()) == 1
    with pytest.raises(ValueError, match='paused'):
        store.update(job_id, time='10:00', timezone='UTC', now=START)


def test_activation_requires_binding_and_manual_baseline(tmp_path):
    from orbitdiff.alert_store import AlertStore

    store = AlertStore(tmp_path / 'orbitdiff.sqlite3')
    job = store.configure('atlas_studio', login='orbit_demo', runtime=Path('/usr/bin/true'),
                          time='09:00', timezone='UTC', now=START)
    assert job['state'] == 'paused'
    with pytest.raises(ValueError):
        store.enable(job['id'], now=START)
    store.bind(job['id'], 'host-123')
    with pytest.raises(ValueError, match='complete'):
        store.enable(job['id'], now=START)


def test_window_claim_survives_restart_and_concurrent_triggers(tmp_path):
    from orbitdiff.alert_store import AlertStore

    store, job_id = configured(tmp_path)
    gate = Barrier(2)

    def attempt(_):
        gate.wait()
        return AlertStore(store.path).claim_window(job_id, now=START + timedelta(hours=1))

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(attempt, range(2)))
    assert sum(c is not None for c in claims) == 1
    assert store.claim_window(job_id, now=START + timedelta(hours=2)) is None
    assert store.claim_window(job_id, now=START - timedelta(days=1)) is None


def test_missed_windows_are_recorded_without_replaying_them(tmp_path):
    store, job_id = configured(tmp_path)
    claim = store.claim_window(job_id, now=START + timedelta(days=4, hours=1))
    assert claim['due_at'] == '2026-10-05T09:00:00+00:00'
    assert claim['missed_windows'] == 4
    assert store.claim_window(job_id, now=START + timedelta(days=4, hours=2)) is None


def test_pause_resume_update_remove_preserve_history(tmp_path):
    store, job_id = configured(tmp_path)
    store.pause(job_id)
    assert store.claim_window(job_id, now=START + timedelta(hours=1)) is None
    store.update(job_id, time='10:00', timezone='UTC', now=START)
    with pytest.raises(ValueError, match='host'):
        store.enable(job_id, now=START)
    store.bind(job_id, 'host-456')
    store.enable(job_id, now=START + timedelta(days=3))
    claim = store.claim_window(job_id, now=START + timedelta(days=3, hours=2))
    assert claim['missed_windows'] == 0
    store.remove(job_id)
    assert store.claim_window(job_id, now=START + timedelta(days=4)) is None
    assert store.status('atlas_studio')['confirmed_count'] == 1
    assert store.jobs()[0]['state'] == 'removed'


def test_read_output_redacts_session_reference(tmp_path):
    from orbitdiff.alert_store import AlertStore

    store = AlertStore(tmp_path / 'orbitdiff.sqlite3')
    store.configure('atlas_studio', login='orbit_demo', runtime=Path('/usr/bin/true'),
                    session_file=tmp_path / 'private-session', time='09:00', timezone='UTC', now=START)
    text = repr(store.jobs())
    assert 'private-session' not in text
    assert 'orbit_demo' not in text


def test_invalid_runtime_and_protected_reference_are_rejected(tmp_path):
    from orbitdiff.alert_store import AlertStore

    store = AlertStore(tmp_path / 'orbitdiff.sqlite3')
    for runtime, session in [(tmp_path/'absent', None), (Path('/usr/bin/true'), tmp_path/'.env')]:
        with pytest.raises((ValueError, OSError)):
            store.configure('atlas_studio', login='orbit_demo', runtime=runtime,
                            session_file=session, time='09:00', timezone='UTC', now=START)
    assert not store.path.exists()
