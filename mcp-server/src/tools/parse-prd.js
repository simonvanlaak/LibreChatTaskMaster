/**
 * tools/parsePRD.js
 * Tool to parse PRD document and generate tasks
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { parsePRDDirect } from "../core/task-master-core.js";

/**
 * Register the parsePRD tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerParsePRDTool(server) {
  server.addTool({
    name: "parse_prd_document",
    description: "Parse PRD document and generate tasks",
    parameters: z.object({
      input: z.string().describe("Path to the PRD document file"),
      numTasks: z.union([z.number(), z.string()]).optional().describe("Number of tasks to generate (default: 10)"),
      output: z.string().optional().describe("Output path for tasks.json file (default: tasks/tasks.json)"),
      projectRoot: z
        .string()
        .optional()
        .describe(
          "Root directory of the project (default: current working directory)"
        ),
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Parsing PRD document with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await parsePRDDirect(args, log);
        
        // Log result
        log.info(`${result.success ? `Successfully generated ${result.data?.taskCount || 0} tasks` : 'Failed to parse PRD'}`);
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error parsing PRD document');
      } catch (error) {
        log.error(`Error in parsePRD tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 