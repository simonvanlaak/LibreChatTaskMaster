/**
 * tools/fix-dependencies.js
 * Tool for automatically fixing invalid task dependencies
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { fixDependenciesDirect } from "../core/task-master-core.js";

/**
 * Register the fixDependencies tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerFixDependenciesTool(server) {
  server.addTool({
    name: "fix_dependencies",
    description: "Fix invalid dependencies in tasks automatically",
    parameters: z.object({
      file: z.string().optional().describe("Path to the tasks file"),
      projectRoot: z.string().describe("Root directory of the project (default: current working directory)")
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Fixing dependencies with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await fixDependenciesDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Successfully fixed dependencies: ${result.data.message}`);
        } else {
          log.error(`Failed to fix dependencies: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error fixing dependencies');
      } catch (error) {
        log.error(`Error in fixDependencies tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    }
  });
} 