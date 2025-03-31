/**
 * tools/update-task.js
 * Tool to update a single task by ID with new information
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { updateTaskByIdDirect } from "../core/task-master-core.js";

/**
 * Register the update-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerUpdateTaskTool(server) {
  server.addTool({
    name: "update-task",
    description: "Updates a single task by ID with new information",
    parameters: z.object({
      id: z.union([z.number(), z.string()]).describe("ID of the task to update"),
      prompt: z.string().describe("New information or context to update the task"),
      research: z.boolean().optional().describe("Use Perplexity AI for research-backed updates"),
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
        log.info(`Updating task with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await updateTaskByIdDirect(args, log);
        
        // Log result
        log.info(`${result.success ? `Successfully updated task with ID ${args.id}` : 'Failed to update task'}`);
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error updating task');
      } catch (error) {
        log.error(`Error in update-task tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 