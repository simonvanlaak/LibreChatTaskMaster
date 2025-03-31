/**
 * tools/parsePRD.js
 * Tool to parse PRD documents and generate Task Master tasks
 */

import { z } from "zod";
import { executeMCPToolAction } from "./utils.js";
import { parsePRDDirect } from "../core/task-master-core.js";

/**
 * Register the parsePRD tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerParsePRDTool(server) {
  server.addTool({
    name: "parsePRD",
    description: "Parse a PRD document and generate Task Master tasks",
    parameters: z.object({
      input: z
        .string()
        .optional()
        .describe("Path to the PRD text file (default: sample-prd.txt)"),
      numTasks: z
        .number()
        .optional()
        .describe("Number of tasks to generate"),
      projectRoot: z
        .string()
        .optional()
        .describe("Root directory of the project (default: current working directory)")
    }),
    execute: async (args, { log }) => {
      return executeMCPToolAction({
        actionFn: parsePRDDirect,
        args,
        log,
        actionName: "Parse PRD and generate tasks"
      });
    },
  });
} 