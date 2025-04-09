---
'task-master-ai': patch
---

Adjusts the response sent to the MCP client for `initialize-project` tool so it includes an explicit `next_steps` object. This is in an effort to reduce variability in what the LLM chooses to do as soon as the confirmation of initialized project. Instead of arbitrarily looking for tasks, it will know that a PRD is required next and will steer the user towards that before reaching for the parse-prd command."
