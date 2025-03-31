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
    handler: async ({ file, projectRoot }, { logger }) => {
      try {
        const result = await validateDependenciesDirect({ file, projectRoot }, logger);
        return handleApiResult(result);
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  });
} 