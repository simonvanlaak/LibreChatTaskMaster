/**
 * tools/expand-task.js
 * Tool to expand a task into subtasks
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { expandTaskDirect } from "../core/task-master-core.js";

/**
 * Register the expand-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerExpandTaskTool(server) {
  server.addTool({
    name: "expand_task",
    description: "Expand a task into subtasks for detailed implementation",
    parameters: z.object({
      id: z.string().describe("ID of task to expand"),
      num: z.union([z.number(), z.string()]).optional().describe("Number of subtasks to generate"),
      research: z.boolean().optional().describe("Use Perplexity AI for research-backed generation"),
      prompt: z.string().optional().describe("Additional context for subtask generation"),
      force: z.boolean().optional().describe("Force regeneration even for tasks that already have subtasks"),
      file: z.string().optional().describe("Path to the tasks file"),
      projectRoot: z
        .string()
        .describe(
          "Root directory of the project (default: current working directory)"
        ),
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Expanding task with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await expandTaskDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Successfully expanded task ID: ${args.id} with ${result.data.subtasksAdded} new subtasks${result.data.hasExistingSubtasks ? ' (appended to existing subtasks)' : ''}`);
        } else {
          log.error(`Failed to expand task: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error expanding task');
      } catch (error) {
        log.error(`Error in expand-task tool: ${error.message}`);
        return createErrorResponse(`Failed to expand task: ${error.message}`);
      }
    },
  });
} 