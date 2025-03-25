/**
 * tools/utils.js
 * Utility functions for Task Master CLI integration
 */

import { spawnSync } from "child_process";

/**
 * Execute a Task Master CLI command using child_process
 * @param {string} command - The command to execute
 * @param {Object} log - The logger object from FastMCP
 * @param {Array} args - Arguments for the command
 * @returns {Object} - The result of the command execution
 */
export function executeTaskMasterCommand(command, log, args = []) {
  try {
    log.info(
      `Executing task-master ${command} with args: ${JSON.stringify(args)}`
    );

    // Prepare full arguments array
    const fullArgs = [command, ...args];

    // Execute the command using the global task-master CLI or local script
    // Try the global CLI first
    let result = spawnSync("task-master", fullArgs, { encoding: "utf8" });

    // If global CLI is not available, try fallback to the local script
    if (result.error && result.error.code === "ENOENT") {
      log.info("Global task-master not found, falling back to local script");
      result = spawnSync("node", ["scripts/dev.js", ...fullArgs], {
        encoding: "utf8",
      });
    }

    if (result.error) {
      throw new Error(`Command execution error: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(
        `Command failed with exit code ${result.status}: ${result.stderr}`
      );
    }

    return {
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    log.error(`Error executing task-master command: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Creates standard content response for tools
 * @param {string} text - Text content to include in response
 * @returns {Object} - Content response object
 */
export function createContentResponse(text) {
  return {
    content: [
      {
        text,
        type: "text",
      },
    ],
  };
}

/**
 * Creates error response for tools
 * @param {string} errorMessage - Error message to include in response
 * @returns {Object} - Error content response object
 */
export function createErrorResponse(errorMessage) {
  return {
    content: [
      {
        text: errorMessage,
        type: "text",
      },
    ],
  };
}
