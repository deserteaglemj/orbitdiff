from __future__ import annotations

import hashlib
import importlib.util
import json
import plistlib
import subprocess
from pathlib import Path
from typing import Any

import pytest

SPEC = importlib.util.spec_from_file_location(
    "native_audit", Path(__file__).parents[1] / "scripts" / "native_audit.py"
)
assert SPEC is not None and SPEC.loader is not None
native_audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native_audit)


def record_manifest(bundle: Path) -> None:
    files: dict[str, Any] = {}
    for path in sorted(bundle.rglob("*")):
        rel = path.relative_to(bundle).as_posix()
        if rel.endswith("orbit-distribution.json"):
            continue
        if path.is_symlink():
            files[rel] = {"symlink": str(path.readlink())}
        elif path.is_file():
            content = path.read_bytes()
            files[rel] = {"size": len(content), "sha256": hashlib.sha256(content).hexdigest()}
    (bundle / "Contents/Resources/orbit-distribution.json").write_text(json.dumps({
        "schema_version": 1,
        "app_version": "0.2.0",
        "architecture": "arm64",
        "dependencies": [{"name": "synthetic", "version": "1", "licenses": ["licenses/synthetic/LICENSE"]}],
        "files": files,
    }))


@pytest.fixture
def bundle(tmp_path: Path) -> Path:
    root = tmp_path / "Orbit OS.app"
    resources = root / "Contents/Resources"
    (root / "Contents/MacOS").mkdir(parents=True)
    (root / "Contents/Frameworks").mkdir()
    (resources / "licenses/synthetic").mkdir(parents=True)
    (root / "Contents/Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIdentifier": "com.orbitdiff.orbitos", "CFBundleExecutable": "orbit-os",
        "CFBundleShortVersionString": "0.2.0", "CFBundlePackageType": "APPL",
    }))
    (root / "Contents/MacOS/orbit-os").write_bytes(b"\xcf\xfa\xed\xfe" + b"synthetic runtime")
    (resources / "licenses/synthetic/LICENSE").write_text("Synthetic permissive license\n")
    (resources / "THIRD_PARTY_NOTICES.txt").write_text("Synthetic dependency 1\n")
    record_manifest(root)
    return root


def test_clean_bundle_with_inventory_passes(bundle: Path) -> None:
    assert native_audit.audit_bundle(bundle) == []


def test_safe_internal_framework_link_passes(bundle: Path) -> None:
    target = bundle / "Contents/Frameworks/Python.framework/Versions/3.13"
    target.mkdir(parents=True)
    (target / "Python").write_bytes(b"\xcf\xfa\xed\xfe")
    (target.parent / "Current").symlink_to("3.13")
    record_manifest(bundle)
    assert native_audit.audit_bundle(bundle) == []


def test_external_symlink_is_rejected_without_reading_target(bundle: Path, tmp_path: Path) -> None:
    private = tmp_path / "private.txt"
    private.write_text("private")
    (bundle / "Contents/Frameworks/external.dylib").symlink_to(private)
    record_manifest(bundle)
    assert any("symlink escapes" in item for item in native_audit.audit_bundle(bundle))


def test_sensitive_database_is_rejected_even_when_manifest_lists_it(bundle: Path) -> None:
    path = bundle / "Contents/Resources/graph.db-wal"
    path.write_bytes(b"private data")
    record_manifest(bundle)
    assert any("sensitive filename" in item for item in native_audit.audit_bundle(bundle))


def test_unexpected_resource_is_rejected(bundle: Path) -> None:
    (bundle / "Contents/Resources/private-report.json").write_text("{}")
    record_manifest(bundle)
    assert any("outside runtime allowlist" in item for item in native_audit.audit_bundle(bundle))


def test_hash_mismatch_and_missing_inventory_member_fail(bundle: Path) -> None:
    (bundle / "Contents/Resources/THIRD_PARTY_NOTICES.txt").write_text("changed")
    (bundle / "Contents/Resources/licenses/synthetic/extra.txt").write_text("unrecorded")
    findings = native_audit.audit_bundle(bundle)
    assert any("hash mismatch" in item for item in findings)
    assert any("not in inventory" in item for item in findings)


def test_private_literals_in_binary_resources_are_rejected(bundle: Path) -> None:
    path = bundle / "Contents/MacOS/orbit-os"
    path.write_bytes(b"\x00\x01private-account-marker\x00")
    record_manifest(bundle)
    assert any("forbidden value" in item for item in native_audit.audit_bundle(bundle, forbidden=["private-account-marker"]))


def test_dependency_license_must_exist(bundle: Path) -> None:
    path = bundle / "Contents/Resources/orbit-distribution.json"
    manifest = json.loads(path.read_text())
    manifest["dependencies"][0]["licenses"] = ["licenses/synthetic/missing.txt"]
    path.write_text(json.dumps(manifest))
    assert any("missing dependency license" in item for item in native_audit.audit_bundle(bundle))


def test_oversize_member_is_bounded(bundle: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(native_audit, "MAX_FILE_SIZE", 16)
    assert any("member too large" in item for item in native_audit.audit_bundle(bundle))


def test_sensitive_directory_is_never_read(bundle: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = bundle / "Contents/Resources/.remember/private-note"
    path.parent.mkdir()
    path.write_text("must not be read")
    original = Path.read_bytes

    def guarded_read(candidate: Path) -> bytes:
        assert ".remember" not in candidate.parts
        return original(candidate)

    monkeypatch.setattr(Path, "read_bytes", guarded_read)
    assert any("sensitive filename" in item for item in native_audit.audit_bundle(bundle))


def test_invalid_empty_license_path_is_reported(bundle: Path) -> None:
    path = bundle / "Contents/Resources/orbit-distribution.json"
    manifest = json.loads(path.read_text())
    manifest["dependencies"][0]["licenses"] = [""]
    path.write_text(json.dumps(manifest))
    assert any("missing dependency license" in item for item in native_audit.audit_bundle(bundle))


def test_symlinked_resources_are_rejected_before_inventory_read(bundle: Path, tmp_path: Path) -> None:
    resources = bundle / "Contents/Resources"
    resources.rename(bundle / "Contents/original-resources")
    resources.symlink_to(tmp_path)
    assert any("symlinked bundle directory" in item for item in native_audit.audit_bundle(bundle))


def test_build_assets_are_allowlisted_and_reject_source_symlinks(tmp_path: Path) -> None:
    spec = importlib.util.spec_from_file_location(
        "build_desktop", Path(__file__).parents[1] / "scripts/build_desktop.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    web = tmp_path / "src/orbit_os/web"
    fixtures = tmp_path / "src/orbitdiff/fixtures"
    web.mkdir(parents=True)
    fixtures.mkdir(parents=True)
    for name in ["index.html", "styles.css", "app.js", "icon.svg"]:
        (web / name).write_text("synthetic")
    for name in ["baseline.json", "pending.json", "confirmed.json"]:
        (fixtures / name).write_text("{}")
    (web / "private-note.txt").write_text("never package")
    assets = module.source_assets(tmp_path)
    assert len(assets) == 7
    assert all("private-note" not in source for source, _ in assets)
    (web / "index.html").rename(tmp_path / "original.html")
    (web / "index.html").symlink_to(tmp_path / "original.html")
    with pytest.raises(ValueError, match="symlink"):
        module.source_assets(tmp_path)


def test_signed_entrypoint_requires_a_valid_platform_signature(
    bundle: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = bundle / "Contents/Resources/orbit-distribution.json"
    manifest = json.loads(path.read_text())
    manifest["files"]["Contents/MacOS/orbit-os"] = {"integrity": "macos-code-signature"}
    path.write_text(json.dumps(manifest))
    calls: list[list[str]] = []

    def rejected_signature(command: list[str], **kwargs: Any) -> Any:
        calls.append(command)
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(native_audit.subprocess, "run", rejected_signature)
    assert "invalid macOS code signature" in native_audit.audit_bundle(bundle)
    assert calls[0][:4] == ["codesign", "--verify", "--deep", "--strict"]


def test_invalid_property_list_shape_is_reported(bundle: Path) -> None:
    (bundle / "Contents/Info.plist").write_bytes(plistlib.dumps(["invalid"]))
    record_manifest(bundle)
    assert "invalid application property list" in native_audit.audit_bundle(bundle)
