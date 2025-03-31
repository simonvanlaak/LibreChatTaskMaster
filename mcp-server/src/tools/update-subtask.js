/**
 * tools/update-subtask.js
 * Tool to append additional information to a specific subtask
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { updateSubtaskByIdDirect } from "../core/task-master-core.js";

/**
 * Register the update-subtask tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerUpdateSubtaskTool(server) {
  server.addTool({
    name: "update-subtask",
    description: "Appends additional information to a specific subtask without replacing existing content",
    parameters: z.object({
      id: z.string().describe("ID of the subtask to update in format \"parentId.subtaskId\" (e.g., \"5.2\")"),
      prompt: z.string().describe("Information to add to the subtask"),
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
        log.info(`Updating subtask with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await updateSubtaskByIdDirect(args, log);
        
        // Log result
        log.info(`${result.success ? `Successfully updated subtask with ID ${args.id}` : 'Failed to update subtask'}`);
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error updating subtask');
      } catch (error) {
        log.error(`Error in update-subtask tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 