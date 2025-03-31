---
"task-master-ai": patch
---

- Split monolithic task-master-core.js into separate function files within direct-functions directory
- Implement update-task MCP command for updating a single task by ID
- Implement update-subtask MCP command for appending information to specific subtasks
- Implement generate MCP command for creating individual task files from tasks.json
- Implement set-status MCP command for updating task status
- Implement show-task MCP command for displaying detailed task information
- Document MCP server naming conventions in architecture.mdc and mcp.mdc files (file names use kebab-case, direct functions use camelCase with Direct suffix, tool registration functions use camelCase with Tool suffix, and MCP tool names use snake_case)
