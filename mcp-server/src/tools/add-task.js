/**
 * tools/add-task.js
 * Tool to add a new task using AI
 */

import { z } from "zod";
import {
  handleApiResult,
  createErrorResponse,
  createContentResponse,
  getProjectRootFromSession
} from "./utils.js";
import { addTaskDirect } from "../core/task-master-core.js";

/**
 * Register the add-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 * @param {AsyncOperationManager} asyncManager - The async operation manager instance.
 */
export function registerAddTaskTool(server, asyncManager) {
  server.addTool({
    name: "add_task",
    description: "Starts adding a new task using AI in the background.",
    parameters: z.object({
      prompt: z.string().describe("Description of the task to add"),
      dependencies: z.string().optional().describe("Comma-separated list of task IDs this task depends on"),
      priority: z.string().optional().describe("Task priority (high, medium, low)"),
      file: z.string().optional().describe("Path to the tasks file"),
      projectRoot: z.string().optional().describe("Root directory of the project (default: current working directory)")
    }),
    execute: async (args, context) => {
      const { log, reportProgress, session } = context;
      try {
        log.info(`MCP add_task request received with prompt: \"${args.prompt}\"`);
        
        if (!args.prompt) {
          return createErrorResponse("Prompt is required for add_task.", "VALIDATION_ERROR");
        }

        let rootFolder = getProjectRootFromSession(session, log);
        if (!rootFolder && args.projectRoot) {
          rootFolder = args.projectRoot;
          log.info(`Using project root from args as fallback: ${rootFolder}`);
        }

        const directArgs = {
          projectRoot: rootFolder,
          ...args
        };

        const operationId = asyncManager.addOperation(addTaskDirect, directArgs, context);
        
        log.info(`Started background operation for add_task. Operation ID: ${operationId}`);

        return createContentResponse({
          message: "Add task operation started successfully.",
          operationId: operationId 
        });

      } catch (error) {
        log.error(`Error initiating add_task operation: ${error.message}`, { stack: error.stack });
        return createErrorResponse(`Failed to start add task operation: ${error.message}`, "ADD_TASK_INIT_ERROR");
      }
    }
  });
} 