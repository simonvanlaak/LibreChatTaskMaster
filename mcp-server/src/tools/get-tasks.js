/**
 * tools/get-tasks.js
 * Tool to get all tasks from Task Master
 */

import { z } from "zod";
import {
  createErrorResponse,
  handleApiResult
} from "./utils.js";
import { listTasksDirect } from "../core/task-master-core.js";

/**
 * Register the getTasks tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerListTasksTool(server) {
  server.addTool({
    name: "get-tasks",
    description: "Get all tasks from Task Master",
    parameters: z.object({
      status: z.string().optional().describe("Filter tasks by status"),
      withSubtasks: z
        .boolean()
        .optional()
        .describe("Include subtasks in the response"),
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
        log.info(`Getting tasks with filters: ${JSON.stringify(args)}`);
        
        // Call core function - args contains projectRoot which is handled internally
        const result = await listTasksDirect(args, log);
        
        // Log result and use handleApiResult utility
        log.info(`Retrieved ${result.success ? (result.data?.tasks?.length || 0) : 0} tasks`);
        return handleApiResult(result, log, 'Error getting tasks');
      } catch (error) {
        log.error(`Error getting tasks: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
}

// We no longer need the formatTasksResponse function as we're returning raw JSON data
