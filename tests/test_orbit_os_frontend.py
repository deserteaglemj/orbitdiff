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
            "const context = {module: {exports: {}}, AbortController, setTimeout, clearTimeout}; "
            f"vm.runInNewContext(fs.readFileSync({json.dumps(str(SCRIPT))}, 'utf8'), context); "
            "const app = context.module.exports; "
            f"Promise.resolve({expression}).then(value => console.log(JSON.stringify(value)))"
            ".catch(error => { console.error(error); process.exitCode = 1; });",
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


def test_setup_draft_keeps_file_identity_and_editable_values() -> None:
    result = evaluate("""(() => {
      const controller = app.createSetupController();
      const file = new (require('node:buffer').File)(['{}'], 'followers_1.json');
      controller.updateDraft('import', {account: 'atlas_studio', files: [file], completeFollowers: true});
      controller.updateDraft('scan', {target: 'nova_labs', login: 'atlas_studio', baseline: true});
      const first = controller.getDraft('import');
      first.files.pop();
      controller.updateDraft('import', {account: 'pixel_forge'});
      return {
        sameFile: controller.getDraft('import').files[0] === file,
        text: controller.getDraft('import').account,
        checked: controller.getDraft('import').completeFollowers,
        scan: controller.getDraft('scan').target
      };
    })()""")
    assert result == {"sameFile": True, "text": "pixel_forge", "checked": True, "scan": "nova_labs"}


def test_setup_operation_blocks_duplicate_submission_and_retains_status() -> None:
    result = evaluate("""(async () => {
      let finish;
      let posts = 0;
      const controller = app.createSetupController({request: async (url) => {
        if (url === '/api/session') return {ok: true, data: {token: 'synthetic-session'}};
        posts += 1;
        return new Promise(resolve => { finish = resolve; });
      }});
      const first = controller.submit('import', async () => ({account: 'atlas_studio'}));
      await new Promise(resolve => setImmediate(resolve));
      const busy = controller.isLocked();
      const duplicate = await controller.submit('scan', async () => ({target: 'nova_labs'}));
      controller.updateDraft('import', {account: 'pixel_forge'});
      const phase = controller.getOperation('import').phase;
      finish({ok: true, data: {ok: true, import_result: {duplicate: false}}});
      const success = await first;
      return {busy, blocked: !duplicate.started, phase, posts, success: success.ok,
        unlocked: !controller.isLocked(), draft: controller.getDraft('import').account,
        message: controller.getOperation('import').message};
    })()""")
    assert isinstance(result, dict)
    assert result["busy"] and result["blocked"] and result["unlocked"]
    assert result["phase"] == "running"
    assert result["posts"] == 1
    assert result["success"] is True
    assert result["draft"] == "pixel_forge"
    assert result["message"] == "Your export was imported locally."


def test_timeout_keeps_post_locked_even_if_server_finishes_later() -> None:
    result = evaluate("""(async () => {
      let completeServer;
      let posts = 0;
      let aborted = false;
      let serverFinished = false;
      context.fetch = async (url, options) => {
        if (url === '/api/session') return {ok: true, status: 200, json: async () => ({token: 'synthetic-session'})};
        posts += 1;
        options.signal.addEventListener('abort', () => { aborted = true; });
        return new Promise(resolve => { completeServer = () => {
          serverFinished = true;
          resolve({ok: true, status: 200, json: async () => ({ok: true, message: 'Scan saved.'})});
        }; });
      };
      const controller = app.createSetupController({timeouts: {session: 20, import: 20, scan: 20}});
      await controller.submit('scan', async () => ({target: 'nova_labs'}));
      const message = controller.getOperation('scan').message;
      const phaseAtDeadline = controller.getOperation('scan').phase;
      const duplicate = await controller.submit('scan', async () => ({target: 'nova_labs'}));
      completeServer();
      await new Promise(resolve => setImmediate(resolve));
      return {posts, aborted, serverFinished, phaseAtDeadline,
        stillLocked: controller.isLocked(), stillUncertain: controller.getOperation('scan').phase === 'uncertain',
        blocked: !duplicate.started, message};
    })()""")
    assert isinstance(result, dict)
    assert result["posts"] == 1
    assert result["aborted"] and result["serverFinished"] and result["blocked"]
    assert result["phaseAtDeadline"] == "uncertain"
    assert result["stillLocked"] and result["stillUncertain"]
    assert "server may still finish" in result["message"].lower()
    assert "does not prove" in result["message"].lower()


def test_session_timeout_does_not_claim_that_a_post_was_started() -> None:
    result = evaluate("""(async () => {
      const calls = [];
      context.fetch = (url) => { calls.push(url); return new Promise(() => {}); };
      const controller = app.createSetupController({timeouts: {session: 10, import: 10, scan: 10}});
      await controller.submit('import', async () => ({}));
      return {calls, unlocked: !controller.isLocked(), operation: controller.getOperation('import')};
    })()""")
    assert isinstance(result, dict)
    assert result["calls"] == ["/api/session"]
    assert result["unlocked"] is True
    assert result["operation"]["phase"] == "failed"
    assert "nothing was submitted" in result["operation"]["message"].lower()


def test_response_body_has_the_same_deadline_as_response_headers() -> None:
    result = evaluate("""(async () => {
      context.fetch = async () => ({ok: true, status: 200, json: () => new Promise(() => {})});
      try { await app.requestJSON('/api/session', {}, 10); }
      catch (error) { return error.name; }
      return 'unexpected success';
    })()""")
    assert result == "TimeoutError"


def test_focus_restores_replaced_filter_control() -> None:
    result = evaluate("""(() => {
      let focused = '';
      const original = {id: '', dataset: {focusKey: 'relationship-filter-mutual'}};
      const replacement = {disabled: false, focus: () => { focused = 'mutual'; }};
      const root = {getElementById: () => null, querySelector: () => replacement, querySelectorAll: () => []};
      app.restoreFocus(app.captureFocus(original), root);
      return focused;
    })()""")
    assert result == "mutual"


def test_disabled_pagination_control_moves_focus_to_enabled_peer() -> None:
    result = evaluate("""(() => {
      let focused = '';
      const original = {id: '', dataset: {focusKey: 'relationships-next', focusGroup: 'relationships-pages'}};
      const disabledNext = {disabled: true, focus: () => { focused = 'disabled'; }};
      const enabledPrevious = {disabled: false, focus: () => { focused = 'previous'; }};
      const root = {getElementById: () => null, querySelector: () => disabledNext,
        querySelectorAll: () => [enabledPrevious, disabledNext]};
      app.restoreFocus(app.captureFocus(original), root);
      return focused;
    })()""")
    assert result == "previous"


def test_operation_refresh_waits_for_a_new_read_after_an_older_read() -> None:
    result = evaluate("""(async () => {
      const label = {textContent: ''};
      const element = {disabled: false, hidden: true, textContent: '', setAttribute() {}, querySelector: () => label};
      context.document = {getElementById: () => element};
      vm.runInContext('render = () => {}; announce = () => {};', context);
      const reads = [];
      let posts = 0;
      context.fetch = async (url) => {
        if (url === '/api/session') return {ok: true, status: 200, json: async () => ({token: 'synthetic-session'})};
        if (url === '/api/import') {
          posts += 1;
          return {ok: true, status: 200, json: async () => ({ok: true, import_result: {duplicate: false}})};
        }
        return new Promise(resolve => { reads.push({url, resolve}); });
      };
      const oldRead = vm.runInContext('loadState(false)', context);
      await new Promise(resolve => setImmediate(resolve));
      const operation = await app.createSetupController().submit('import', async () => ({}));
      let freshFinished = false;
      const freshRead = vm.runInContext('loadState(false)', context).then(() => { freshFinished = true; });
      await new Promise(resolve => setImmediate(resolve));
      const finishedBeforeOldRead = freshFinished;
      reads[0].resolve({ok: true, json: async () => ({schema_version: 1, generation: 'before-import'})});
      await oldRead;
      await new Promise(resolve => setImmediate(resolve));
      const finishedBeforeNewRead = freshFinished;
      if (reads[1]) reads[1].resolve({ok: true, json: async () => ({schema_version: 1, generation: 'after-import'})});
      await freshRead;
      return {posts, operation: operation.ok, readCount: reads.length, finishedBeforeOldRead,
        finishedBeforeNewRead, generation: vm.runInContext('ui.data.generation', context)};
    })()""")
    assert result == {
        "posts": 1,
        "operation": True,
        "readCount": 2,
        "finishedBeforeOldRead": False,
        "finishedBeforeNewRead": False,
        "generation": "after-import",
    }


def test_queued_reads_keep_demo_identity_and_continue_after_read_failure() -> None:
    result = evaluate("""(async () => {
      const label = {textContent: ''};
      const element = {disabled: false, hidden: true, textContent: '', setAttribute() {}, querySelector: () => label};
      context.document = {getElementById: () => element};
      vm.runInContext('render = () => {}; announce = () => {};', context);
      const reads = [];
      context.fetch = (url) => new Promise((resolve, reject) => { reads.push({url, resolve, reject}); });
      const first = vm.runInContext('loadState(false)', context);
      const demo = vm.runInContext('loadState(true)', context);
      const workspace = vm.runInContext('loadState(false)', context);
      await new Promise(resolve => setImmediate(resolve));
      reads[0].reject(new Error('Synthetic read failure'));
      await first;
      await new Promise(resolve => setImmediate(resolve));
      if (reads[1]) reads[1].resolve({ok: true, json: async () => ({schema_version: 1, workspace: {mode: 'demo', demo: true}})});
      await demo;
      const demoMode = vm.runInContext('ui.data?.workspace?.mode || null', context);
      await new Promise(resolve => setImmediate(resolve));
      if (reads[2]) reads[2].resolve({ok: true, json: async () => ({schema_version: 1, workspace: {mode: 'portable', demo: false}})});
      await workspace;
      return {urls: reads.map(read => read.url), demoMode,
        finalMode: vm.runInContext('ui.data?.workspace?.mode || null', context),
        loading: vm.runInContext('ui.loading', context)};
    })()""")
    assert result == {
        "urls": ["/api/state", "/api/demo", "/api/state"],
        "demoMode": "demo",
        "finalMode": "portable",
        "loading": False,
    }
