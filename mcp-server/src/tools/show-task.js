/**
 * tools/show-task.js
 * Tool to show task details by ID
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { showTaskDirect } from "../core/task-master-core.js";

/**
 * Register the show-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerShowTaskTool(server) {
  server.addTool({
    name: "show_task",
    description: "Display detailed information about a specific task",
    parameters: z.object({
      id: z.string().describe("Task ID to show"),
      file: z.string().optional().describe("Path to the tasks file"),
      projectRoot: z
        .string()
        .optional()
        .describe(
          "Root directory of the project (default: current working directory)"
        ),
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Showing task details for ID: ${args.id}`);
        
        // Call the direct function wrapper
        const result = await showTaskDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Successfully retrieved task details for ID: ${args.id}${result.fromCache ? ' (from cache)' : ''}`);
        } else {
          log.error(`Failed to show task: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error retrieving task details');
      } catch (error) {
        log.error(`Error in show-task tool: ${error.message}`);
        return createErrorResponse(`Failed to show task: ${error.message}`);
      }
    },
  });
} 