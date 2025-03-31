/**
 * tools/add-dependency.js
 * Tool for adding a dependency to a task
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { addDependencyDirect } from "../core/task-master-core.js";

/**
 * Register the addDependency tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerAddDependencyTool(server) {
  server.addTool({
    name: "add_dependency",
    description: "Add a dependency relationship between two tasks",
    parameters: z.object({
      id: z.string().describe("ID of task that will depend on another task"),
      dependsOn: z.string().describe("ID of task that will become a dependency"),
      file: z.string().optional().describe("Path to the tasks file (default: tasks/tasks.json)"),
      projectRoot: z.string().optional().describe("Root directory of the project (default: current working directory)")
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Adding dependency for task ${args.id} to depend on ${args.dependsOn} with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await addDependencyDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Successfully added dependency: ${result.data.message}`);
        } else {
          log.error(`Failed to add dependency: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error adding dependency');
      } catch (error) {
        log.error(`Error in addDependency tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 