/**
 * tools/add-task.js
 * Tool to add a new task using AI
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { addTaskDirect } from "../core/task-master-core.js";

/**
 * Register the add-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerAddTaskTool(server) {
  server.addTool({
    name: "add_task",
    description: "Add a new task using AI",
    parameters: z.object({
      prompt: z.string().describe("Description of the task to add"),
      dependencies: z.string().optional().describe("Comma-separated list of task IDs this task depends on"),
      priority: z.string().optional().describe("Task priority (high, medium, low)"),
      file: z.string().optional().describe("Path to the tasks file"),
      projectRoot: z.string().optional().describe("Root directory of the project (default: current working directory)")
    }),
    execute: async ({ prompt, dependencies, priority, file, projectRoot }, log) => {
      try {
        log.info(`MCP add_task called with prompt: "${prompt}"`);
        
        const result = await addTaskDirect({
          prompt,
          dependencies,
          priority,
          file,
          projectRoot
        }, log);
        
        return handleApiResult(result);
      } catch (error) {
        log.error(`Error in add_task MCP tool: ${error.message}`);
        return createErrorResponse(error.message, "ADD_TASK_ERROR");
      }
    }
  });
} 