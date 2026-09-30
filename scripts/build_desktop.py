"""Build one isolated Apple Silicon desktop candidate from allowlisted inputs."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import resource
import subprocess
import sys
import sysconfig
import tomllib
from pathlib import Path
from typing import Any

RUNTIME_DEPENDENCIES = (
    "bottle", "certifi", "charset-normalizer", "idna", "instaloader", "platformdirs",
    "proxy-tools", "pyobjc-core", "pyobjc-framework-Cocoa", "pyobjc-framework-Quartz",
    "pyobjc-framework-Security", "pyobjc-framework-UniformTypeIdentifiers",
    "pyobjc-framework-WebKit", "pywebview", "requests", "typing-extensions", "urllib3",
)
BUILD_DEPENDENCIES = (
    "altgraph", "macholib", "packaging", "pyinstaller", "pyinstaller-hooks-contrib", "setuptools",
)
WEB_ASSETS = ("index.html", "app.js", "styles.css", "icon.svg", "manifest.webmanifest")
FIXTURES = ("baseline.json", "pending.json", "confirmed.json")


def source_assets(root: Path) -> list[tuple[str, str]]:
    """Copy only packaged UI assets and the three synthetic collector fixtures."""
    assets: list[tuple[str, str]] = []
    for package, directory, names in (
        ("orbit_os", "web", WEB_ASSETS), ("orbitdiff", "fixtures", FIXTURES),
    ):
        for name in names:
            path = root / "src" / package / directory / name
            if name == "manifest.webmanifest" and not path.exists():
                continue
            if path.is_symlink() or not path.resolve().is_relative_to((root / "src").resolve()):
                raise ValueError("A desktop source asset is a symlink or leaves the source directory")
            if not path.is_file():
                raise ValueError(f"Missing desktop source asset: {package}/{directory}/{name}")
            assets.append((str(path), f"{package}/{directory}"))
    return assets


def _normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.lower())


def create_app_icon(root: Path, work: Path) -> Path:
    """Render the existing SVG mark with macOS, without an extra graphics dependency."""
    from AppKit import (
        NSBitmapImageRep,
        NSCompositeSourceOver,
        NSDeviceRGBColorSpace,
        NSGraphicsContext,
        NSImage,
        NSPNGFileType,
    )

    source = root / "src/orbit_os/web/icon.svg"
    if source.is_symlink():
        raise ValueError("The icon source must not be a symlink")
    image = NSImage.alloc().initWithContentsOfFile_(str(source))
    if image is None:
        raise ValueError("The native SVG renderer could not read the approved icon")
    iconset = work / "orbit-os.iconset"
    iconset.mkdir(exist_ok=True)
    for logical_size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            pixels = logical_size * scale
            bitmap_initializer = (
                "initWithBitmapDataPlanes_"
                "pixelsWide_pixelsHigh_bitsPerSample_"
                "samplesPerPixel_hasAlpha_isPlanar_"
                "colorSpaceName_bytesPerRow_bitsPerPixel_"
            )
            bitmap = getattr(NSBitmapImageRep.alloc(), bitmap_initializer)(
                None, pixels, pixels, 8, 4, True, False, NSDeviceRGBColorSpace, 0, 0,
            )
            NSGraphicsContext.saveGraphicsState()
            try:
                NSGraphicsContext.setCurrentContext_(NSGraphicsContext.graphicsContextWithBitmapImageRep_(bitmap))
                image.drawInRect_fromRect_operation_fraction_(
                    ((0, 0), (pixels, pixels)), ((0, 0), (0, 0)), NSCompositeSourceOver, 1.0,
                )
            finally:
                NSGraphicsContext.restoreGraphicsState()
            suffix = "@2x" if scale == 2 else ""
            destination = iconset / f"icon_{logical_size}x{logical_size}{suffix}.png"
            encoded = bitmap.representationUsingType_properties_(NSPNGFileType, {})
            if encoded is None or not encoded.writeToFile_atomically_(str(destination), True):
                raise ValueError("The native icon could not be encoded")
    destination = work / "orbit-os.icns"
    subprocess.run(["iconutil", "-c", "icns", "-o", str(destination), str(iconset)], check=True, timeout=30)
    return destination


def dependency_notices(root: Path, staging: Path) -> list[dict[str, Any]]:
    """Fail the build if a declared dependency lacks a redistributable license text."""
    result: list[dict[str, Any]] = []
    for name in (*RUNTIME_DEPENDENCIES, *BUILD_DEPENDENCIES):
        distribution = importlib.metadata.distribution(name)
        normalized = _normalized(name)
        destination = staging / "licenses" / normalized
        destination.mkdir(parents=True, exist_ok=True)
        sources: list[Path] = []
        for file in distribution.files or ():
            parts = Path(str(file)).parts
            if not parts or not parts[0].endswith(".dist-info"):
                continue
            if "license" in file.name.lower() or "copying" in file.name.lower():
                sources.append(Path(distribution.locate_file(file)))
        if not sources:
            fallback = "pyobjc-core" if normalized.startswith("pyobjc-") else normalized
            sources = [root / "packaging/licenses" / f"{fallback}-LICENSE.txt"]
        licenses: list[str] = []
        for index, source in enumerate(sources):
            if not source.is_file() or source.stat().st_size > 512 * 1024:
                raise ValueError(f"Missing or oversized license text for {name}")
            target = destination / (source.name if index == 0 else f"{index}-{source.name}")
            target.write_bytes(source.read_bytes())
            licenses.append(target.relative_to(staging).as_posix())
        result.append({
            "name": name,
            "version": distribution.version,
            "role": "runtime" if name in RUNTIME_DEPENDENCIES else "build tool",
            "license_expression": distribution.metadata.get("License-Expression", "see license text"),
            "licenses": licenses,
        })
    python_license = Path(sysconfig.get_path("stdlib")) / "LICENSE.txt"
    if not python_license.is_file():
        raise ValueError("The bundled Python runtime license is missing")
    target = staging / "licenses/Python/LICENSE.txt"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(python_license.read_bytes())
    result.append({
        "name": "Python", "version": platform.python_version(), "role": "runtime",
        "licenses": ["licenses/Python/LICENSE.txt"],
    })
    native_licenses: list[str] = []
    for source in sorted((root / "packaging/licenses/python-runtime").glob("LICENSE.*.txt")):
        destination = staging / "licenses/Python-native-libraries" / source.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read_bytes())
        native_licenses.append(destination.relative_to(staging).as_posix())
    if len(native_licenses) != 10:
        raise ValueError("The Python native library license inventory is incomplete")
    result.append({
        "name": "Python native libraries", "version": "CPython 3.13.12 build 20260325",
        "role": "runtime", "licenses": native_licenses,
    })
    own_license = staging / "licenses/OrbitOS/LICENSE"
    own_license.parent.mkdir(parents=True, exist_ok=True)
    own_license.write_bytes((root / "LICENSE").read_bytes())
    result.append({"name": "Orbit OS", "version": _version(root), "role": "application", "licenses": ["licenses/OrbitOS/LICENSE"]})
    lines = [
        "Orbit OS third-party notices", "", "This application bundles an isolated Python runtime.",
        "System frameworks remain provided by macOS. Build tools are listed for reproducibility.",
        "The complete license texts are included in the licenses directory.", "",
    ]
    for item in result:
        lines.append(f"{item['name']} {item['version']} ({item['role']})")
        lines.extend(f"  {license_path}" for license_path in item["licenses"])
    (staging / "THIRD_PARTY_NOTICES.txt").write_text("\n".join(lines) + "\n")
    return result


def _version(root: Path) -> str:
    return str(tomllib.loads((root / "pyproject.toml").read_text())["project"]["version"])


def write_inventory(bundle: Path, dependencies: list[dict[str, Any]], version: str) -> None:
    files: dict[str, Any] = {}
    for path in sorted(bundle.rglob("*")):
        relative = path.relative_to(bundle).as_posix()
        if relative.endswith("orbit-distribution.json") or relative.startswith("Contents/_CodeSignature/"):
            continue
        if path.is_symlink():
            files[relative] = {"symlink": str(path.readlink())}
        elif path.is_file():
            content = path.read_bytes()
            if relative == "Contents/MacOS/orbit-os":
                # The signature seals the inventory, so a hash of this binary would be cyclic.
                files[relative] = {"integrity": "macos-code-signature"}
            else:
                files[relative] = {"size": len(content), "sha256": hashlib.sha256(content).hexdigest()}
    manifest = {
        "schema_version": 1, "app_version": version, "architecture": platform.machine(),
        "python": platform.python_version(), "build_macos": platform.mac_ver()[0],
        "signing": "ad-hoc local candidate; not notarized", "dependencies": dependencies, "files": files,
    }
    (bundle / "Contents/Resources/orbit-distribution.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build an audited, ad-hoc-signed macOS desktop candidate.")
    parser.add_argument("--output", type=Path, default=Path("dist/desktop"))
    parser.add_argument("--work", type=Path, default=Path(".orbit-local/desktop-build"))
    parser.add_argument("--feasibility", action="store_true", help="Build only the synthetic native runtime check")
    parser.add_argument("--dmg", action="store_true", help="Also create a compressed disk image")
    parser.add_argument("--forbid", action="append", default=[])
    args = parser.parse_args(argv)
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        parser.error("This verified recipe requires Apple Silicon macOS. Other platforms need native verification.")
    root = Path(__file__).resolve().parents[1]
    work = args.work.resolve()
    output = args.output.resolve()
    work.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    if (output / "Orbit OS.app").exists() or (output / "Orbit OS").exists():
        parser.error("The output already contains an application. Choose a new output directory.")
    lock = root / ".orbit-local/native-build.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        parser.error("Another native build owns this checkout. Wait for that build to finish.")
    os.close(descriptor)
    try:
        staging = work / "notices"
        staging.mkdir(exist_ok=True)
        dependencies = dependency_notices(root, staging)
        version = _version(root)
        assets = source_assets(root)
        assets.extend([(str(staging / "licenses"), "licenses"), (str(staging / "THIRD_PARTY_NOTICES.txt"), ".")])
        config = {
            "entry": str(root / "packaging" / ("smoke_entry.py" if args.feasibility else "desktop_entry.py")),
            "source": str(root / "src"), "assets": assets, "version": version,
            "icon": str(create_app_icon(root, work)),
        }
        config_path = work / "build-config.json"
        config_path.write_text(json.dumps(config))
        environment = dict(
            os.environ,
            ORBIT_DESKTOP_BUILD_CONFIG=str(config_path),
            PYINSTALLER_CONFIG_DIR=str(work / "pyinstaller-cache"),
        )
        subprocess.run([
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--distpath", str(output),
            "--workpath", str(work / "pyinstaller"), str(root / "packaging/orbit_os.spec"),
        ], check=True, env=environment, timeout=900)
        peak_bytes = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        print(f"Native builder peak child memory: {peak_bytes / 1024**2:.1f} MiB")
        if peak_bytes > 2 * 1024**3:
            raise RuntimeError("The native build exceeded its approved 2 GiB memory budget")
        bundle = output / "Orbit OS.app"
        write_inventory(bundle, dependencies, version)
        subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(bundle)], check=True)
        # Signing changes binaries; refresh their recorded hashes and seal the resources again.
        write_inventory(bundle, dependencies, version)
        subprocess.run(["codesign", "--force", "--sign", "-", str(bundle)], check=True)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(bundle)], check=True)
        audit_command = [sys.executable, str(root / "scripts/native_audit.py"), str(bundle)]
        for value in args.forbid:
            audit_command.extend(["--forbid", value])
        subprocess.run(audit_command, check=True)
        if args.feasibility:
            print("Synthetic feasibility bundle ready. This is not the release application.")
            return 0
        stem = f"Orbit-OS-{version}-macOS-arm64"
        archive = output / f"{stem}.zip"
        subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(bundle), str(archive)], check=True)
        archives = [archive]
        if args.dmg:
            image = output / f"{stem}.dmg"
            subprocess.run(["hdiutil", "create", "-volname", "Orbit OS", "-srcfolder", str(bundle), "-format", "UDZO", str(image)], check=True)
            archives.append(image)
        checksum_lines = [f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}" for path in archives]
        (output / "SHA256SUMS.txt").write_text("\n".join(checksum_lines) + "\n")
        print(f"Desktop candidate ready: {archive.name}")
        print("Ad-hoc signed, not notarized. Downloaded-file quarantine still requires validation.")
        return 0
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
