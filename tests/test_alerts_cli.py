import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from orbit_os.cli import main
from orbitdiff.models import Collection
from orbitdiff.store import GraphStore


def invoke(args, path, capsys):
    code = main(['alerts',*args,'--workspace',str(path)])
    output = capsys.readouterr()
    return code,json.loads(output.out)


def test_missing_alert_status_and_dry_run_preserve_workspace(tmp_path,capsys):
    root = tmp_path/'absent'
    code,result = invoke(['status'],root,capsys)
    assert code == 0 and result['jobs'] == []
    code,result = invoke(['dry-run','unknown'],root,capsys)
    assert code == 2 and result['outcome'] == 'blocked'
    assert not root.exists()


def test_alert_setup_lifecycle_and_safe_command_result(tmp_path,capsys,monkeypatch):
    import orbit_os.alerts_cli as cli

    runtime = Path(sys.executable).absolute()
    monkeypatch.setattr(cli,'probe_runtime',lambda path: '0.2.3')
    monkeypatch.setattr(cli.sys,'platform','darwin')
    monkeypatch.setattr(cli.sys,'argv',[str(runtime)])
    code,result = invoke(['setup','atlas_studio','--login','orbit_demo','--runtime',str(runtime),
                          '--at','09:00','--timezone','UTC','--destination','current-user'],tmp_path,capsys)
    assert code == 0
    ident = result['job']['id']
    assert result['job']['state'] == 'paused'
    assert 'orbit_demo' not in json.dumps(result)
    assert invoke(['enable',ident],tmp_path,capsys)[0] == 2
    invoke(['bind',ident,'--host-job-id','host-123'],tmp_path,capsys)
    GraphStore(tmp_path/'orbitdiff.sqlite3').apply_collection(Collection('atlas_studio',0,(),True,datetime.now(UTC)-timedelta(days=1)))
    assert invoke(['enable',ident],tmp_path,capsys)[1]['job']['state'] == 'enabled'
    before = (tmp_path/'orbitdiff.sqlite3').read_bytes()
    assert invoke(['dry-run',ident],tmp_path,capsys)[1]['would_contact_instagram'] is False
    assert (tmp_path/'orbitdiff.sqlite3').read_bytes() == before
    assert invoke(['pause',ident],tmp_path,capsys)[1]['host_action'] == 'pause_matching_host_job'
    assert invoke(['update',ident,'--at','10:00','--timezone','UTC'],tmp_path,capsys)[0] == 0
    assert invoke(['resume',ident],tmp_path,capsys)[0] == 2
    assert invoke(['remove',ident],tmp_path,capsys)[1]['host_action'] == 'remove_matching_host_job'


def test_runtime_probe_rejects_plain_executable_and_protected_file(tmp_path):
    from orbit_os.alerts_cli import probe_runtime

    with pytest.raises(ValueError):
        probe_runtime(Path('/usr/bin/true'))
    protected = tmp_path/'.env'
    with pytest.raises((OSError,ValueError)):
        probe_runtime(protected)


def test_synthetic_submission_requires_explicit_destination_action(tmp_path,capsys):
    code,result = invoke(['test-notification'],tmp_path,capsys)
    assert code == 2
    assert result['outcome'] == 'blocked'
    assert not (tmp_path/'orbitdiff.sqlite3').exists()


def test_resolve_retry_requires_acknowledgement_and_uses_selected_notice(tmp_path,capsys):
    from orbitdiff.alert_outbox import OutboxStore

    code,result = invoke(['resolve','missing','--action','retry'],tmp_path,capsys)
    assert code == 2 and result['outcome'] == 'blocked'
    assert not (tmp_path/'orbitdiff.sqlite3').exists()
    store = OutboxStore(tmp_path/'orbitdiff.sqlite3')
    store.initialize()
    code,result = invoke(['resolve','missing','--action','discard'],tmp_path,capsys)
    assert code == 2
    assert 'only uncertain' in result['reason']


def test_enable_does_not_execute_runtime_path_from_database(tmp_path,capsys,monkeypatch):
    import orbit_os.alerts_cli as cli
    from orbitdiff.alert_outbox import OutboxStore

    store = OutboxStore(tmp_path/'orbitdiff.sqlite3')
    now=datetime.now(UTC)
    store.apply_collection(Collection('atlas_studio',0,(),True,now-timedelta(days=1)))
    job=store.configure('atlas_studio',login='orbit_demo',runtime=Path(sys.executable).absolute(),
                        time='09:00',timezone='UTC',now=now)
    store.bind(job['id'],'host-123')
    monkeypatch.setattr(cli.sys,'platform','darwin')
    def forbidden(path):
        raise AssertionError('stored paths must not be executed')
    monkeypatch.setattr(cli,'probe_runtime',forbidden)
    code,result=invoke(['enable',job['id']],tmp_path,capsys)
    assert code==2 and result['reason']=='runtime_mismatch'
