# cozoroctl

Windows helper to manage **only** the Portal + API processes started by this tool.

## Build the EXE (Windows)

Run:

`tools\\cozoroctl\\build-exe-win.cmd`

Output:

`tools\\cozoroctl\\dist\\cozoroctl.exe`

## Usage

From the repo root (recommended):

- `tools\\cozoroctl\\dist\\cozoroctl.exe build`
- `tools\\cozoroctl\\dist\\cozoroctl.exe rebuild`
- `tools\\cozoroctl\\dist\\cozoroctl.exe start`
- `tools\\cozoroctl\\dist\\cozoroctl.exe stop`
- `tools\\cozoroctl\\dist\\cozoroctl.exe restart`
- `tools\\cozoroctl\\dist\\cozoroctl.exe status`
- `tools\\cozoroctl\\dist\\cozoroctl.exe check-portal`

This tool stores the PIDs it started in `%LOCALAPPDATA%\\CozoroHome\\cozoroctl-state.json` and will refuse to kill anything that does not look like **this repo**.

## Notes

- Portal dev port defaults to `3001`.
- API dev port defaults to `4000` (override via `COZORO_API_PORT`).
- Logs go to `%LOCALAPPDATA%\\CozoroHome\\logs\\`.
