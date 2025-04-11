---
'task-master-ai': patch
---

Two improvements to MCP tools:

1. Adjusts the response sent to the MCP client for `initialize-project` tool so it includes an explicit `next_steps` object. This is in an effort to reduce variability in what the LLM chooses to do as soon as the confirmation of initialized project. Instead of arbitrarily looking for tasks, it will know that a PRD is required next and will steer the user towards that before reaching for the parse-prd command.

2. Updates the `parse_prd` tool parameter description to explicitly mention support for .md file formats, clarifying that users can provide PRD documents in various text formats including Markdown.

3. Updates the `parse_prd` tool `numTasks` param description to encourage the LLM agent to use a number of tasks to break down the PRD into that is logical relative to project complexity.
