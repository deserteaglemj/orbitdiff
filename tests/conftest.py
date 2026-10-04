from __future__ import annotations

import io
import struct
import sys
import zipfile
from pathlib import Path

import pytest
from hypothesis.configuration import set_hypothesis_home_dir

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
set_hypothesis_home_dir(Path(__file__).parents[1] / ".orbit-local" / "hypothesis")


@pytest.fixture
def corrupt_deflate_zip() -> bytes:
    """Keep ZIP headers valid while making the first DEFLATE block invalid."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("followers_1.json", b"[]")
    payload = bytearray(buffer.getvalue())
    filename_size, extra_size = struct.unpack_from("<HH", payload, 26)
    payload[30 + filename_size + extra_size] = 0x07
    return bytes(payload)
