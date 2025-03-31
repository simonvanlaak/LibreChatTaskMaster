/**
 * tools/index.js
 * Export all Task Master CLI tools for MCP server
 */

import logger from "../logger.js";
import { registerListTasksTool } from "./list-tasks.js";
import { registerSetTaskStatusTool } from "./set-task-status.js";
import { registerParsePRDTool } from "./parse-prd.js";
import { registerUpdateTool } from "./update.js";
import { registerUpdateTaskTool } from "./update-task.js";
import { registerUpdateSubtaskTool } from "./update-subtask.js";
import { registerGenerateTool } from "./generate.js";
import { registerShowTaskTool } from "./show-task.js";
import { registerNextTaskTool } from "./next-task.js";
import { registerExpandTaskTool } from "./expand-task.js";
import { registerAddTaskTool } from "./add-task.js";
import { registerAddSubtaskTool } from "./add-subtask.js";
import { registerRemoveSubtaskTool } from "./remove-subtask.js";
import { registerAnalyzeTool } from "./analyze.js";
import { registerClearSubtasksTool } from "./clear-subtasks.js";

/**
 * Register all Task Master tools with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerTaskMasterTools(server) {
  registerListTasksTool(server);
  registerSetTaskStatusTool(server);
  registerParsePRDTool(server);
  registerUpdateTool(server);
  registerUpdateTaskTool(server);
  registerUpdateSubtaskTool(server);
  registerGenerateTool(server);
  registerShowTaskTool(server);
  registerNextTaskTool(server);
  registerExpandTaskTool(server);
  registerAddTaskTool(server);
  registerAddSubtaskTool(server);
  registerRemoveSubtaskTool(server);
  registerAnalyzeTool(server);
  registerClearSubtasksTool(server);
  
  logger.info("Registered all Task Master tools with MCP server");
}

export default {
  registerTaskMasterTools,
};