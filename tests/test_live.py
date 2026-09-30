from datetime import UTC, datetime, timedelta

from orbitdiff.models import Account, Collection
from orbitdiff.providers.base import ProviderError
from orbitdiff.store import GraphStore

NOW = datetime(2026, 10, 1, 9, tzinfo=UTC)


class Provider:
    def collect(self, target):
        return Collection(target, 1, (Account('1', 'nova_labs'),), True, NOW)


def test_shared_runner_keeps_baseline_silent_and_reserves_every_attempt(tmp_path):
    from orbitdiff.live import collect_live

    store = GraphStore(tmp_path/'orbitdiff.sqlite3')
    result = collect_live(store, 'atlas_studio', Provider, now=NOW, baseline=True)
    assert result.state == 'success'
    assert result.events == ()
    assert store.status('atlas_studio')['confirmed_count'] == 1
    later = collect_live(store, 'atlas_studio', lambda: (_ for _ in ()).throw(AssertionError()),
                         now=NOW+timedelta(minutes=29))
    assert later.state == 'skipped'
    assert later.reason == 'cooldown'
    assert store.status('atlas_studio')['failed_runs'] == 0


def test_stale_collector_cannot_commit_after_newer_admission(tmp_path):
    from orbitdiff.live import collect_live

    store = GraphStore(tmp_path/'orbitdiff.sqlite3')

    class Suspended(Provider):
        def collect(self, target):
            assert store.reserve_live_attempt(target, now=NOW+timedelta(hours=1))
            return super().collect(target)

    result = collect_live(store, 'atlas_studio', Suspended, now=NOW)
    assert result.state == 'skipped'
    assert result.reason == 'stale_attempt'
    assert store.status('atlas_studio')['initialized'] is False


def test_provider_failure_is_redacted_and_preserves_good_state(tmp_path):
    from orbitdiff.live import collect_live

    store = GraphStore(tmp_path/'orbitdiff.sqlite3')
    store.apply_collection(Collection('atlas_studio', 0, (), True, NOW-timedelta(days=1)))

    class Failing:
        def collect(self, target):
            raise ProviderError('private session contents must not leak')

    result = collect_live(store, 'atlas_studio', Failing, now=NOW)
    assert result.state == 'failed'
    assert result.reason == 'provider_failed'
    assert store.status('atlas_studio')['confirmed_count'] == 0
    with store._read_connection() as conn:
        assert 'private session' not in str([tuple(r) for r in conn.execute('SELECT error FROM runs')])
