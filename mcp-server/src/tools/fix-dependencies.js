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
      projectRoot: z.string().optional().describe("Root directory of the project (default: current working directory)")
    }),
    handler: async ({ file, projectRoot }, { logger }) => {
      try {
        const result = await fixDependenciesDirect({ file, projectRoot }, logger);
        return handleApiResult(result);
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  });
} 