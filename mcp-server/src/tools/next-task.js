/**
 * tools/next-task.js
 * Tool to find the next task to work on
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { nextTaskDirect } from "../core/task-master-core.js";

/**
 * Register the next-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerNextTaskTool(server) {
  server.addTool({
    name: "next_task",
    description: "Find the next task to work on based on dependencies and status",
    parameters: z.object({
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
        log.info(`Finding next task with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await nextTaskDirect(args, log);
        
        // Log result
        if (result.success) {
          if (result.data.nextTask) {
            log.info(`Successfully found next task ID: ${result.data.nextTask.id}${result.fromCache ? ' (from cache)' : ''}`);
          } else {
            log.info(`No eligible next task found${result.fromCache ? ' (from cache)' : ''}`);
          }
        } else {
          log.error(`Failed to find next task: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error finding next task');
      } catch (error) {
        log.error(`Error in next-task tool: ${error.message}`);
        return createErrorResponse(`Failed to find next task: ${error.message}`);
      }
    },
  });
} 