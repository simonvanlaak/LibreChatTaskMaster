/**
 * tools/utils.js
 * Utility functions for Task Master CLI integration
 */

import { spawnSync } from "child_process";
import path from "path";

/**
 * Get normalized project root path 
 * @param {string|undefined} projectRootRaw - Raw project root from arguments
 * @param {Object} log - Logger object
 * @returns {string} - Normalized absolute path to project root
 */
export function getProjectRoot(projectRootRaw, log) {
  // Make sure projectRoot is set
  const rootPath = projectRootRaw || process.cwd();
  
  // Ensure projectRoot is absolute
  const projectRoot = path.isAbsolute(rootPath) 
    ? rootPath 
    : path.resolve(process.cwd(), rootPath);
  
  log.info(`Using project root: ${projectRoot}`);
  return projectRoot;
}

/**
 * Handle API result with standardized error handling and response formatting
 * @param {Object} result - Result object from API call with success, data, and error properties
 * @param {Object} log - Logger object
 * @param {string} errorPrefix - Prefix for error messages
 * @param {Function} processFunction - Optional function to process successful result data
 * @returns {Object} - Standardized MCP response object
 */
export function handleApiResult(result, log, errorPrefix = 'API error', processFunction = processMCPResponseData) {
  if (!result.success) {
    const errorMsg = result.error?.message || `Unknown ${errorPrefix}`;
    log.error(`${errorPrefix}: ${errorMsg}`);
    return createErrorResponse(errorMsg);
  }
  
  // Process the result data if needed and if we have a processor function
  const processedData = processFunction ? processFunction(result.data) : result.data;
  
  // Return formatted response
  return createContentResponse(processedData);
}

/**
 * Execute a Task Master CLI command using child_process
 * @param {string} command - The command to execute
 * @param {Object} log - The logger object from FastMCP
 * @param {Array} args - Arguments for the command
 * @param {string|undefined} projectRootRaw - Optional raw project root path (will be normalized internally)
 * @returns {Object} - The result of the command execution
 */
export function executeTaskMasterCommand(
  command,
  log,
  args = [],
  projectRootRaw = null
) {
  try {
    // Normalize project root internally using the getProjectRoot utility
    const cwd = getProjectRoot(projectRootRaw, log);

    log.info(
      `Executing task-master ${command} with args: ${JSON.stringify(
        args
      )} in directory: ${cwd}`
    );

    // Prepare full arguments array
    const fullArgs = [command, ...args];

    // Common options for spawn
    const spawnOptions = {
      encoding: "utf8",
      cwd: cwd,
    };

    // Execute the command using the global task-master CLI or local script
    // Try the global CLI first
    let result = spawnSync("task-master", fullArgs, spawnOptions);

    // If global CLI is not available, try fallback to the local script
    if (result.error && result.error.code === "ENOENT") {
      log.info("Global task-master not found, falling back to local script");
      result = spawnSync("node", ["scripts/dev.js", ...fullArgs], spawnOptions);
    }

    if (result.error) {
      throw new Error(`Command execution error: ${result.error.message}`);
    }

    if (result.status !== 0) {
      // Improve error handling by combining stderr and stdout if stderr is empty
      const errorOutput = result.stderr
        ? result.stderr.trim()
        : result.stdout
        ? result.stdout.trim()
        : "Unknown error";
      throw new Error(
        `Command failed with exit code ${result.status}: ${errorOutput}`
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
 * Executes a Task Master tool action with standardized error handling, logging, and response formatting
 * @param {Object} options - Options for executing the tool action
 * @param {Function} options.actionFn - The core action function to execute (must return {success, data, error})
 * @param {Object} options.args - Arguments for the action
 * @param {Object} options.log - Logger object from FastMCP
 * @param {string} options.actionName - Name of the action for logging purposes
 * @param {Function} options.processResult - Optional function to process the result before returning
 * @returns {Promise<Object>} - Standardized response for FastMCP
 */
export async function executeMCPToolAction({
  actionFn,
  args,
  log,
  actionName,
  processResult = processMCPResponseData
}) {
  try {
    // Log the action start
    log.info(`${actionName} with args: ${JSON.stringify(args)}`);
    
    // Normalize project root path - common to almost all tools
    const projectRootRaw = args.projectRoot || process.cwd();
    const projectRoot = path.isAbsolute(projectRootRaw)
      ? projectRootRaw
      : path.resolve(process.cwd(), projectRootRaw);
    
    log.info(`Using project root: ${projectRoot}`);
    
    // Execute the core action function with normalized arguments
    const result = await actionFn({...args, projectRoot}, log);
    
    // Handle error case
    if (!result.success) {
      const errorMsg = result.error?.message || `Unknown error during ${actionName.toLowerCase()}`;
      log.error(`Error during ${actionName.toLowerCase()}: ${errorMsg}`);
      return createErrorResponse(errorMsg);
    }
    
    // Log success
    log.info(`Successfully completed ${actionName.toLowerCase()}`);
    
    // Process the result data if needed
    const processedData = processResult ? processResult(result.data) : result.data;
    
    // Return formatted response
    return createContentResponse(processedData);
  } catch (error) {
    // Handle unexpected errors
    log.error(`Unexpected error during ${actionName.toLowerCase()}: ${error.message}`);
    return createErrorResponse(error.message);
  }
}

/**
 * Recursively removes specified fields from task objects, whether single or in an array.
 * Handles common data structures returned by task commands.
 * @param {Object|Array} taskOrData - A single task object or a data object containing a 'tasks' array.
 * @param {string[]} fieldsToRemove - An array of field names to remove.
 * @returns {Object|Array} - The processed data with specified fields removed.
 */
export function processMCPResponseData(taskOrData, fieldsToRemove = ['details', 'testStrategy']) {
  if (!taskOrData) {
    return taskOrData;
  }

  // Helper function to process a single task object
  const processSingleTask = (task) => {
    if (typeof task !== 'object' || task === null) {
        return task;
    }
      
    const processedTask = { ...task };
    
    // Remove specified fields from the task
    fieldsToRemove.forEach(field => {
      delete processedTask[field];
    });

    // Recursively process subtasks if they exist and are an array
    if (processedTask.subtasks && Array.isArray(processedTask.subtasks)) {
      // Use processArrayOfTasks to handle the subtasks array
      processedTask.subtasks = processArrayOfTasks(processedTask.subtasks); 
    }
    
    return processedTask;
  };
  
  // Helper function to process an array of tasks
  const processArrayOfTasks = (tasks) => {
      return tasks.map(processSingleTask);
  };

  // Check if the input is a data structure containing a 'tasks' array (like from listTasks)
  if (typeof taskOrData === 'object' && taskOrData !== null && Array.isArray(taskOrData.tasks)) {
    return {
      ...taskOrData, // Keep other potential fields like 'stats', 'filter'
      tasks: processArrayOfTasks(taskOrData.tasks),
    };
  } 
  // Check if the input is likely a single task object (add more checks if needed)
  else if (typeof taskOrData === 'object' && taskOrData !== null && 'id' in taskOrData && 'title' in taskOrData) {
    return processSingleTask(taskOrData);
  }
  // Check if the input is an array of tasks directly (less common but possible)
  else if (Array.isArray(taskOrData)) {
      return processArrayOfTasks(taskOrData);
  }
  
  // If it doesn't match known task structures, return it as is
  return taskOrData; 
}

/**
 * Creates standard content response for tools
 * @param {string|Object} content - Content to include in response
 * @returns {Object} - Content response object in FastMCP format
 */
export function createContentResponse(content) {
  // FastMCP requires text type, so we format objects as JSON strings
  return {
    content: [
      {
        type: "text", 
        text: typeof content === 'object' ? 
          // Format JSON nicely with indentation
          JSON.stringify(content, null, 2) : 
          // Keep other content types as-is
          String(content)
      }
    ]
  };
}

/**
 * Creates error response for tools
 * @param {string} errorMessage - Error message to include in response
 * @returns {Object} - Error content response object in FastMCP format
 */
export function createErrorResponse(errorMessage) {
  return {
    content: [
      {
        type: "text",
        text: `Error: ${errorMessage}`
      }
    ],
    isError: true
  };
}
