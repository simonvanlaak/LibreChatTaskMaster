---
"task-master-ai": patch
---

- Split monolithic task-master-core.js into separate function files within direct-functions directory
- Implement update-task MCP command for updating a single task by ID
- Implement update-subtask MCP command for appending information to specific subtasks
- Implement generate MCP command for creating individual task files from tasks.json
- Implement set-status MCP command for updating task status
