/**
 * tools/validate-dependencies.js
 * Tool for validating task dependencies
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { validateDependenciesDirect } from "../core/task-master-core.js";

/**
 * Register the validateDependencies tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerValidateDependenciesTool(server) {
  server.addTool({
    name: "validate_dependencies",
    description: "Identify invalid dependencies in tasks without fixing them",
    parameters: z.object({
      file: z.string().optional().describe("Path to the tasks file"),
      projectRoot: z.string().optional().describe("Root directory of the project (default: current working directory)")
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Validating dependencies with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await validateDependenciesDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Successfully validated dependencies: ${result.data.message}`);
        } else {
          log.error(`Failed to validate dependencies: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error validating dependencies');
      } catch (error) {
        log.error(`Error in validateDependencies tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 