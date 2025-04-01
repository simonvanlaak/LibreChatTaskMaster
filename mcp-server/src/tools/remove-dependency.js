/**
 * tools/remove-dependency.js
 * Tool for removing a dependency from a task
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { removeDependencyDirect } from "../core/task-master-core.js";

/**
 * Register the removeDependency tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerRemoveDependencyTool(server) {
  server.addTool({
    name: "remove_dependency",
    description: "Remove a dependency from a task",
    parameters: z.object({
      id: z.string().describe("Task ID to remove dependency from"),
      dependsOn: z.string().describe("Task ID to remove as a dependency"),
      file: z.string().optional().describe("Path to the tasks file (default: tasks/tasks.json)"),
      projectRoot: z.string().optional().describe("Root directory of the project (default: current working directory)")
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Removing dependency for task ${args.id} from ${args.dependsOn} with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await removeDependencyDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Successfully removed dependency: ${result.data.message}`);
        } else {
          log.error(`Failed to remove dependency: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error removing dependency');
      } catch (error) {
        log.error(`Error in removeDependency tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 