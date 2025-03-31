/**
 * tools/update.js
 * Tool to update tasks based on new context/prompt
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { updateTasksDirect } from "../core/task-master-core.js";

/**
 * Register the update tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerUpdateTool(server) {
  server.addTool({
    name: "update",
    description: "Update tasks with ID >= specified ID based on the provided prompt",
    parameters: z.object({
      from: z.union([z.number(), z.string()]).describe("Task ID from which to start updating"),
      prompt: z.string().describe("Explanation of changes or new context"),
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
        log.info(`Updating tasks with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await updateTasksDirect(args, log);
        
        // Log result
        log.info(`${result.success ? `Successfully updated tasks from ID ${args.from}` : 'Failed to update tasks'}`);
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error updating tasks');
      } catch (error) {
        log.error(`Error in update tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 