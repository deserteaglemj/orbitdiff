"""Frozen app entrypoint, also exposing the bundled command-line interface."""

from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        from orbit_os.desktop import launch

        return launch()
    from orbit_os.cli import main as cli_main

    return cli_main(args)


if __name__ == "__main__":
    raise SystemExit(main())

