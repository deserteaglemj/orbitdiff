"""Synthetic native-window feasibility check, never a release entrypoint."""

from __future__ import annotations

import time

import webview


def close_after_open() -> None:
    time.sleep(2)
    webview.windows[0].destroy()


if __name__ == "__main__":
    webview.create_window(
        "Orbit OS native feasibility",
        html="<!doctype html><title>Orbit OS</title><h1>Native runtime ready</h1>",
        width=640,
        height=400,
    )
    webview.start(close_after_open, private_mode=True, debug=False)

