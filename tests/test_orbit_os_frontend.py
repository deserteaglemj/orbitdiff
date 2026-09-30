"""Browser helper contracts for local data safety and honest event wording."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "src" / "orbit_os" / "web" / "app.js"


def evaluate(expression: str) -> object:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is needed for the browser helper contracts")
    result = subprocess.run(
        [
            node,
            "-e",
            "const fs = require('node:fs'); const vm = require('node:vm'); "
            "const context = {module: {exports: {}}}; "
            f"vm.runInNewContext(fs.readFileSync({json.dumps(str(SCRIPT))}, 'utf8'), context); "
            f"const app = context.module.exports; console.log(JSON.stringify({expression}));",
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return json.loads(result.stdout)


def test_profile_links_accept_only_instagram_usernames() -> None:
    assert evaluate("app.profileURL('atlas_studio')") == "https://www.instagram.com/atlas_studio/"
    assert evaluate("app.profileURL('javascript:alert(1)')") is None
    assert evaluate("app.profileURL('../admin')") is None
    assert evaluate("app.profileURL('')") is None


def test_csv_cells_neutralize_spreadsheet_formulas() -> None:
    cells = evaluate("['=1+1', '+SUM(A1)', '-1', '@SUM(A1)', ' \\t=1', '\\r=1', 'safe,quoted'].map(app.csvCell)")
    assert isinstance(cells, list)
    assert all(cell.startswith('"\'') for cell in cells[:6])
    assert cells[-1] == '"safe,quoted"'


def test_lost_mutual_event_does_not_claim_an_unfollow() -> None:
    event = evaluate("app.describeEvent({type: 'lost_mutual', username: 'atlas_studio'})")
    assert isinstance(event, dict)
    assert "mutual" in event["title"].lower()
    assert "unfollow" not in event["title"].lower()
    assert "does not establish" in event["detail"].lower()


def test_export_removal_is_an_observation_not_a_confirmed_live_unfollow() -> None:
    event = evaluate("app.describeEvent({type: 'follower_observed_removed', source: 'export_observation'})")
    assert isinstance(event, dict)
    assert "export" in event["detail"].lower()
    assert "observed" in event["title"].lower()
    assert "confirmed" not in event["detail"].lower()


def test_unattributed_balance_is_always_anonymous() -> None:
    event = evaluate("app.describeEvent({type: 'unattributed_balance', delta: -3, username: 'atlas_studio'})")
    assert isinstance(event, dict)
    assert event["anonymous"] is True
    assert "atlas_studio" not in event["title"] + event["detail"]


def test_status_prioritizes_failure_over_freshness() -> None:
    assert evaluate("app.statusInfo({status: 'failed', stale: true}).label") == "Collection failed"
    assert evaluate("app.statusInfo({status: 'ok', stale: true}).label") == "Stale data"


def test_unavailable_watchlist_roster_is_not_presented_as_zero() -> None:
    markup = evaluate("app.watchAccountTable({following_count: null, accounts: []})")
    assert isinstance(markup, str)
    assert "Roster unavailable" in markup
    assert "0 accounts" not in markup
    assert "watch-search" not in markup
    assert 'class="pagination"' not in markup
    assert "does not mean it follows zero accounts" in markup


def test_empty_stale_source_does_not_claim_historical_observations() -> None:
    markup = evaluate("app.sourceBanner({status: 'hidden', stale: true, last_run_at: null}, false)")
    assert isinstance(markup, str)
    assert "historical observations" not in markup
    assert "No successful collection is recorded" in markup
    history = evaluate("app.sourceBanner({status: 'stale', stale: true, last_run_at: '2026-01-01'}, false)")
    assert isinstance(history, str)
    assert "historical observations" in history


def test_frontend_has_no_inline_handlers_or_remote_assets() -> None:
    document = SCRIPT.with_name("index.html").read_text()
    assert "onclick=" not in document
    assert "onerror=" not in document
    assert '<script src="/app.js" defer></script>' in document
    assert "https://" not in document
    for path in SCRIPT.parent.iterdir():
        if path.is_file():
            assert chr(0x2014) not in path.read_text()
