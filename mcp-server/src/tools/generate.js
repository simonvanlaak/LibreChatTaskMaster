/**
 * tools/generate.js
 * Tool to generate individual task files from tasks.json
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { generateTaskFilesDirect } from "../core/task-master-core.js";

/**
 * Register the generate tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerGenerateTool(server) {
  server.addTool({
    name: "generate",
    description: "Generates individual task files in tasks/ directory based on tasks.json",
    parameters: z.object({
      file: z.string().optional().describe("Path to the tasks file"),
      output: z.string().optional().describe("Output directory (default: same directory as tasks file)"),
      projectRoot: z
        .string()
        .describe(
          "Root directory of the project (default: current working directory)"
        ),
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Generating task files with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await generateTaskFilesDirect(args, log);
        
        // Log result
        log.info(`${result.success ? 'Successfully generated task files' : 'Failed to generate task files'}`);
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error generating task files');
      } catch (error) {
        log.error(`Error in generate tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 