/**
 * tools/complexity-report.js
 * Tool for displaying the complexity analysis report
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { complexityReportDirect } from "../core/task-master-core.js";

/**
 * Register the complexityReport tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerComplexityReportTool(server) {
  server.addTool({
    name: "complexity_report",
    description: "Display the complexity analysis report in a readable format",
    parameters: z.object({
      file: z.string().optional().describe("Path to the report file (default: scripts/task-complexity-report.json)"),
      projectRoot: z.string().optional().describe("Root directory of the project (default: current working directory)")
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Getting complexity report with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await complexityReportDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Successfully retrieved complexity report${result.fromCache ? ' (from cache)' : ''}`);
        } else {
          log.error(`Failed to retrieve complexity report: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error retrieving complexity report');
      } catch (error) {
        log.error(`Error in complexity-report tool: ${error.message}`);
        return createErrorResponse(`Failed to retrieve complexity report: ${error.message}`);
      }
    },
  });
} 