/**
 * tools/setTaskStatus.js
 * Tool to set the status of a task
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { setTaskStatusDirect } from "../core/task-master-core.js";

/**
 * Register the setTaskStatus tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerSetTaskStatusTool(server) {
  server.addTool({
    name: "set_task_status",
    description: "Set the status of a task",
    parameters: z.object({
      id: z
        .string()
        .describe("Task ID (can be comma-separated for multiple tasks)"),
      status: z
        .string()
        .describe("New status (todo, in-progress, review, done)"),
      file: z.string().optional().describe("Path to the tasks file"),
      projectRoot: z
        .string()
        .optional()
        .describe(
          "Root directory of the project (default: automatically detected)"
        ),
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Setting status of task(s) ${args.id} to: ${args.status}`);
        
        // Call the direct function wrapper
        const result = await setTaskStatusDirect(args, log);
        
        // Log result
        log.info(`${result.success ? `Successfully updated task ${args.id} status to "${args.status}"` : 'Failed to update task status'}`);
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error setting task status');
      } catch (error) {
        log.error(`Error in setTaskStatus tool: ${error.message}`);
        return createErrorResponse(`Error setting task status: ${error.message}`);
      }
    },
  });
}
