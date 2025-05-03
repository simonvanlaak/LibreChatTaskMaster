---
'task-master-ai': patch
---

Better support for file paths on Windows, Linux & WSL.

- Standardizes handling of different path formats (URI encoded, Windows, Linux, WSL).
- Ensures tools receive a clean, absolute path suitable for the server OS.
- Simplifies tool implementation by centralizing normalization logic.
