/**
 * tools/get-task.js
 * Tool to get task details by ID
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { showTaskDirect } from "../core/task-master-core.js";

/**
 * Register the get-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerShowTaskTool(server) {
  server.addTool({
    name: "get_task",
    description: "Get detailed information about a specific task",
    parameters: z.object({
      id: z.string().describe("Task ID to get"),
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
        log.info(`Getting task details for ID: ${args.id}`);
        
        // Call the direct function wrapper
        const result = await showTaskDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Successfully retrieved task details for ID: ${args.id}${result.fromCache ? ' (from cache)' : ''}`);
        } else {
          log.error(`Failed to get task: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error retrieving task details');
      } catch (error) {
        log.error(`Error in get-task tool: ${error.message}`);
        return createErrorResponse(`Failed to get task: ${error.message}`);
      }
    },
  });
} 