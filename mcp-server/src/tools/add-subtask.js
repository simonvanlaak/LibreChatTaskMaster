/**
 * tools/add-subtask.js
 * Tool for adding subtasks to existing tasks
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { addSubtaskDirect } from "../core/task-master-core.js";

/**
 * Register the addSubtask tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerAddSubtaskTool(server) {
  server.addTool({
    name: "add_subtask",
    description: "Add a subtask to an existing task",
    parameters: z.object({
      id: z.string().describe("Parent task ID (required)"),
      taskId: z.string().optional().describe("Existing task ID to convert to subtask"),
      title: z.string().optional().describe("Title for the new subtask (when creating a new subtask)"),
      description: z.string().optional().describe("Description for the new subtask"),
      details: z.string().optional().describe("Implementation details for the new subtask"),
      status: z.string().optional().describe("Status for the new subtask (default: 'pending')"),
      dependencies: z.string().optional().describe("Comma-separated list of dependency IDs for the new subtask"),
      file: z.string().optional().describe("Path to the tasks file (default: tasks/tasks.json)"),
      skipGenerate: z.boolean().optional().describe("Skip regenerating task files"),
      projectRoot: z.string().describe("Root directory of the project (default: current working directory)")
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Adding subtask with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await addSubtaskDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Subtask added successfully: ${result.data.message}`);
        } else {
          log.error(`Failed to add subtask: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error adding subtask');
      } catch (error) {
        log.error(`Error in addSubtask tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 