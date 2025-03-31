/**
 * tools/analyze.js
 * Tool for analyzing task complexity and generating recommendations
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse
} from "./utils.js";
import { analyzeTaskComplexityDirect } from "../core/task-master-core.js";

/**
 * Register the analyze tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerAnalyzeTool(server) {
  server.addTool({
    name: "analyze_project_complexity",
    description: "Analyze task complexity and generate expansion recommendations",
    parameters: z.object({
      output: z.string().optional().describe("Output file path for the report (default: scripts/task-complexity-report.json)"),
      model: z.string().optional().describe("LLM model to use for analysis (defaults to configured model)"),
      threshold: z.union([z.number(), z.string()]).optional().describe("Minimum complexity score to recommend expansion (1-10) (default: 5)"),
      file: z.string().optional().describe("Path to the tasks file (default: tasks/tasks.json)"),
      research: z.boolean().optional().describe("Use Perplexity AI for research-backed complexity analysis"),
      projectRoot: z.string().describe("Root directory of the project (default: current working directory)")
    }),
    execute: async (args, { log }) => {
      try {
        log.info(`Analyzing task complexity with args: ${JSON.stringify(args)}`);
        
        // Call the direct function wrapper
        const result = await analyzeTaskComplexityDirect(args, log);
        
        // Log result
        if (result.success) {
          log.info(`Task complexity analysis complete: ${result.data.message}`);
          log.info(`Report summary: ${JSON.stringify(result.data.reportSummary)}`);
        } else {
          log.error(`Failed to analyze task complexity: ${result.error.message}`);
        }
        
        // Use handleApiResult to format the response
        return handleApiResult(result, log, 'Error analyzing task complexity');
      } catch (error) {
        log.error(`Error in analyze tool: ${error.message}`);
        return createErrorResponse(error.message);
      }
    },
  });
} 