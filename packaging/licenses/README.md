# Desktop license sources

The native builder copies license texts from the installed, version-pinned dependency distributions. It records package versions and relative license paths in `orbit-distribution.json` inside the app. Build-tool licenses are also included for reproducibility.

Some dependency wheels omit the license file. The following upstream copies supply those missing notices:

- `proxy-tools-LICENSE.txt`: [proxy_tools upstream BSD license](https://github.com/jtushman/proxy_tools/blob/master/LICENSE.txt). Version 0.1.0's source header identifies this BSD license, although its package metadata says MIT. The upstream license text is preserved.
- `pyobjc-core-LICENSE.txt`: `License.txt` from the PyPI `pyobjc-core` 12.2.2 source distribution. The shared PyObjC MIT notice also covers the Security and UniformTypeIdentifiers wrappers whose wheels omit a license file.
- `python-runtime/`: the bzip2, Expat, libedit, libffi, liblzma, mpdecimal, ncurses, OpenSSL 3, SQLite, and zlib notices from [python-build-standalone build 20260325](https://github.com/astral-sh/python-build-standalone/tree/20260325). These cover native dependencies of the managed CPython runtime used by the verified build.

The Python license itself comes from the bundled interpreter. System-provided macOS frameworks are referenced rather than redistributed.
