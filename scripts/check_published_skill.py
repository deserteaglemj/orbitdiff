"""Verify a pinned published skill separately from the current candidate.

Requires existing GitHub CLI access. Downloads only the Python and skill assets;
the offline installation checker handles the runtime in a fresh environment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from package_audit import scan_archive


def verify_checksums(text: str, artifacts: list[Path]) -> dict[str, str]:
    expected: dict[str, str] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)", line)
        if match is None:
            raise ValueError("invalid checksum or filename")
        digest, name = match.groups()
        if name in expected:
            raise ValueError("duplicate checksum filename")
        expected[name] = digest
    verified = {}
    for artifact in artifacts:
        if artifact.name not in expected:
            raise ValueError(f"missing checksum: {artifact.name}")
        actual = hashlib.sha256(artifact.read_bytes()).hexdigest()
        if actual != expected[artifact.name]:
            raise ValueError(f"checksum mismatch: {artifact.name}")
        verified[artifact.name] = actual
    return verified


def _document(text: str) -> tuple[dict, str]:
    """Parse this skill's bounded string-map YAML, rejecting unfamiliar syntax."""
    if not text.startswith("---\n") or "\n---\n" not in text[4:]:
        raise ValueError("missing skill frontmatter")
    header, body = text[4:].split("\n---\n", 1)
    result: dict = {}
    parent: dict | None = None
    child_indent: int | None = None
    for line in header.splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r"( *)([a-z][a-z0-9_-]*):(?: (.*))?", line)
        if match is None:
            raise ValueError("unsupported frontmatter syntax")
        indent, key, raw = match.groups()
        if indent:
            if parent is None or len(indent) not in (2, 4):
                raise ValueError("unsupported frontmatter nesting")
            if child_indent is not None and len(indent) != child_indent:
                raise ValueError("inconsistent frontmatter indentation")
            child_indent = len(indent)
            destination = parent
        else:
            destination = result
            parent = None
            child_indent = None
        if key in destination:
            raise ValueError("duplicate frontmatter key")
        if raw is None:
            if indent or key != "metadata":
                raise ValueError("unsupported frontmatter map")
            parent = {}
            result[key] = parent
        else:
            if raw.startswith('"'):
                value = json.loads(raw)
                if not isinstance(value, str):
                    raise ValueError("frontmatter must contain strings")
            elif raw.startswith("'") and raw.endswith("'"):
                value = raw[1:-1].replace("''", "'")
            elif not raw or raw[0] in "[{}&*!|>" or " #" in raw:
                raise ValueError("unsupported frontmatter scalar")
            else:
                value = raw
            destination[key] = value
    return result, body


def compare_skill_document(original: str, installed: str, expected: dict[str, str]) -> dict:
    source, source_body = _document(original)
    target, target_body = _document(installed)
    metadata = target.get("metadata", {})
    source_metadata = source.get("metadata", {})
    added = {key: value for key, value in metadata.items() if key not in source_metadata}
    if added != expected:
        raise ValueError("unexpected installer metadata")
    target["metadata"] = {key: value for key, value in metadata.items() if key not in expected}
    if target != source:
        raise ValueError("installer changed original metadata or frontmatter")
    removed = source_body.startswith("\n") and target_body == source_body[1:]
    if target_body != source_body and not removed:
        raise ValueError("installer changed skill body")
    return {
        "added_metadata": added,
        "frontmatter_order_quotes_and_indentation_normalized": original != installed,
        "leading_body_newline_removed": removed,
        "original_values_and_body_preserved": True,
    }


def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()


def verify_tree(files: dict[str, bytes], tree: list[dict]) -> None:
    expected = {}
    for entry in tree:
        if entry["type"] == "tree":
            continue
        if entry["type"] != "blob" or entry.get("mode") not in ("100644", "100755"):
            raise ValueError("unsupported git tree entry")
        expected[entry["path"]] = entry["sha"]
    if {name: git_blob_sha(data) for name, data in files.items()} != expected:
        raise ValueError("archive differs from pinned git tree")


def verify_wheel_tree(wheel: Path, tree: list[dict]) -> int:
    prefixes = ("orbit_os/", "orbitdiff/")
    with zipfile.ZipFile(wheel) as archive:
        if len(archive.namelist()) != len(set(archive.namelist())):
            raise ValueError("duplicate wheel members")
        files = {name: archive.read(name) for name in archive.namelist()
                 if name.startswith(prefixes) and not name.endswith("/")}
    entries = [{**entry, "path": entry["path"].removeprefix("src/")}
               for entry in tree if entry["path"].startswith(tuple("src/" + prefix for prefix in prefixes))]
    if not files:
        raise ValueError("wheel contains no product files")
    verify_tree(files, entries)
    return len(files)


def installed_files(output: Path) -> dict[str, Path]:
    installed = output / "installed" / "orbitdiff"
    if (output / "installed").is_symlink() or installed.is_symlink():
        raise ValueError("symbolic installation roots are not allowed")
    if not installed.resolve().is_relative_to(output.resolve()) or not installed.is_dir():
        raise ValueError("installed skill is not an isolated directory")
    result = {}
    for path in installed.rglob("*"):
        if path.is_symlink():
            raise ValueError("symbolic installed files are not allowed")
        if path.is_file():
            result[str(path.relative_to(installed))] = path
    return result


def run_check(repo: str, tag: str, expected_commit: str, output: Path) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("invalid repository")
    match = re.fullmatch(r"v(\d+\.\d+\.\d+)", tag)
    if not match or not re.fullmatch(r"[a-f0-9]{40}", expected_commit):
        raise ValueError("a stable version tag and full expected commit are required")
    version = match.group(1)
    output = output.resolve()
    checkout = Path(__file__).resolve().parents[1]
    if output.is_relative_to(checkout):
        raise ValueError("published installation destination must be outside the checkout")
    output.mkdir(parents=True, exist_ok=False)
    commands: list[dict] = []
    receipt: dict = {"outcome": "error", "provenance": "published", "repository": repo,
                     "tag": tag, "expected_commit": expected_commit, "commands": commands}

    def command(argv: list[str], *, timeout: int = 120) -> str:
        result = subprocess.run(argv, cwd=output, capture_output=True, text=True, timeout=timeout)
        commands.append({"argv": argv, "returncode": result.returncode,
                         "stdout": result.stdout, "stderr": result.stderr})
        if result.returncode:
            raise ValueError(f"command failed: {argv[0]} {argv[1]}")
        return result.stdout

    def api(endpoint: str) -> dict:
        return json.loads(command(["gh", "api", f"repos/{repo}/{endpoint}"]))

    def identity() -> dict:
        ref = api(f"git/ref/tags/{tag}")
        item = ref["object"]
        tag_object = item["sha"]
        if item["type"] == "tag":
            item = api(f"git/tags/{tag_object}")["object"]
        if item["type"] != "commit" or item["sha"] != expected_commit:
            raise ValueError("published tag does not match expected commit")
        return {"tag_object": tag_object, "commit": item["sha"]}

    try:
        receipt["identity"] = identity()
        release = api(f"releases/tags/{tag}")
        if release["draft"] or release["tag_name"] != tag:
            raise ValueError("release is not a published matching tag")
        receipt["is_prerelease"] = release["prerelease"]
        names = [f"orbitdiff-{version}-py3-none-any.whl", f"orbitdiff-{version}.tar.gz",
                 f"orbitdiff-skill-{version}.zip", "SHA256SUMS.txt"]
        assets = {entry["name"]: entry for entry in release["assets"]}
        if any(name not in assets for name in names):
            raise ValueError("missing published Python/skill asset")
        if any(assets[name]["size"] > 10 * 1024 * 1024 for name in names):
            raise ValueError("published Python/skill asset exceeds size limit")
        download = ["gh", "release", "download", tag, "--repo", repo, "--dir", str(output)]
        for name in names:
            download.extend(["--pattern", name])
        command(download)
        paths = [output / name for name in names[:-1]]
        receipt["sha256"] = verify_checksums((output / "SHA256SUMS.txt").read_text(), paths)
        for path in [*paths, output / "SHA256SUMS.txt"]:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if assets[path.name].get("digest") != f"sha256:{digest}":
                raise ValueError("download differs from GitHub asset digest")
        for path in paths:
            findings = scan_archive(path, [])
            if findings:
                raise ValueError("published archive audit failed: " + "; ".join(findings))
        tree = api(f"git/trees/{expected_commit}?recursive=1")
        if tree.get("truncated"):
            raise ValueError("truncated published tree")
        receipt["wheel_product_files_matching_commit"] = verify_wheel_tree(paths[0], tree["tree"])
        skill_tree = next(entry["sha"] for entry in tree["tree"] if entry["path"] == "skills/orbitdiff")
        skill_entries = [{**entry, "path": entry["path"][len("skills/orbitdiff/"):]}
                         for entry in tree["tree"] if entry["path"].startswith("skills/orbitdiff/")]
        with zipfile.ZipFile(paths[2]) as archive:
            if len(archive.namelist()) != len(set(archive.namelist())):
                raise ValueError("duplicate archive members")
            files = {name.removeprefix("orbitdiff/"): archive.read(name)
                     for name in archive.namelist() if not name.endswith("/")}
        license_data = files.pop("LICENSE")
        license_sha = next(entry["sha"] for entry in tree["tree"] if entry["path"] == "LICENSE")
        if git_blob_sha(license_data) != license_sha:
            raise ValueError("archive license differs from pinned commit")
        verify_tree(files, skill_entries)
        receipt["skill_tree"] = skill_tree
        command(["gh", "skill", "install", repo, "orbitdiff", "--pin", tag,
                 "--dir", str(output / "installed")])
        installation = installed_files(output)
        if set(installation) != set(files):
            raise ValueError("unexpected installed skill files")
        for name, content in files.items():
            actual = installation[name].read_bytes()
            if name == "SKILL.md":
                receipt["installer_changes"] = compare_skill_document(content.decode(), actual.decode(), {
                    "github-path": "skills/orbitdiff", "github-ref": f"refs/tags/{tag}",
                    "github-repo": f"https://github.com/{repo}", "github-tree-sha": skill_tree,
                    "github-pinned": tag,
                })
            elif actual != content:
                raise ValueError(f"installer changed file: {name}")
        command([sys.executable, str(checkout / "scripts/check_skill_install.py"),
                 "--wheel", str(paths[0]), "--skill-archive", str(paths[2]),
                 "--source-commit", expected_commit, "--expected-version", version,
                 "--provenance", "published", "--output-dir", str(output / "runtime")], timeout=360)
        if identity() != receipt["identity"]:
            raise ValueError("published tag changed during verification")
        after = api(f"releases/tags/{tag}")
        if {a["name"]: (a["id"], a.get("digest")) for a in after["assets"] if a["name"] in names} != {
            name: (assets[name]["id"], assets[name].get("digest")) for name in names
        }:
            raise ValueError("published assets changed during verification")
        receipt["outcome"] = "success"
    except (ValueError, OSError, KeyError, StopIteration, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        receipt["error"] = str(error)
    (output / "published-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="deserteaglemj/orbitdiff")
    parser.add_argument("--tag", required=True)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    output = args.output_dir or Path(tempfile.mkdtemp(prefix="orbitdiff-published-")) / "proof"
    try:
        receipt = run_check(args.repo, args.tag, args.expected_commit, output)
    except (ValueError, OSError) as error:
        print(json.dumps({"outcome": "error", "error": str(error)}))
        return 1
    print(json.dumps({"outcome": receipt["outcome"], "receipt": str(output / "published-receipt.json"),
                      "error": receipt.get("error")}))
    return 0 if receipt["outcome"] == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
