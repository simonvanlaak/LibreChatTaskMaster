/**
 * task-master-core.js
 * Direct function imports from Task Master modules
 * 
 * This module provides direct access to Task Master core functions
 * for improved performance and error handling compared to CLI execution.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

// Get the current module's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import Task Master modules
import { 
  listTasks,
  // We'll import more functions as we continue implementation
} from '../../../scripts/modules/task-manager.js';

/**
 * Finds the absolute path to the tasks.json file based on project root and arguments.
 * @param {Object} args - Command arguments, potentially including 'projectRoot' and 'file'.
 * @param {Object} log - Logger object.
 * @returns {string} - Absolute path to the tasks.json file.
 * @throws {Error} - If tasks.json cannot be found.
 */
function findTasksJsonPath(args, log) {
  // Assume projectRoot is already normalized absolute path if passed in args
  // Or use getProjectRoot if we decide to centralize that logic
  const projectRoot = args.projectRoot || process.cwd(); 
  log.info(`Searching for tasks.json within project root: ${projectRoot}`);

  const possiblePaths = [];

  // 1. If a file is explicitly provided relative to projectRoot
  if (args.file) {
    possiblePaths.push(path.resolve(projectRoot, args.file));
  }

  // 2. Check the standard locations relative to projectRoot
  possiblePaths.push(
    path.join(projectRoot, 'tasks.json'),
    path.join(projectRoot, 'tasks', 'tasks.json')
  );

  log.info(`Checking potential task file paths: ${possiblePaths.join(', ')}`);

  // Find the first existing path
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log.info(`Found tasks file at: ${p}`);
      return p;
    }
  }

  // If no file was found, throw an error
  throw new Error(`Tasks file not found in any of the expected locations relative to ${projectRoot}: ${possiblePaths.join(', ')}`);
}

/**
 * Direct function wrapper for listTasks with error handling
 * 
 * @param {Object} args - Command arguments (projectRoot is expected to be resolved)
 * @param {Object} log - Logger object
 * @returns {Object} - Task list result
 */
export async function listTasksDirect(args, log) {
  try {
    log.info(`Listing tasks with args: ${JSON.stringify(args)}`);
    
    // Use the helper function to find the tasks file path
    const tasksPath = findTasksJsonPath(args, log);
    
    // Extract other arguments
    const statusFilter = args.status || null;
    const withSubtasks = args.withSubtasks || false;
    
    log.info(`Using tasks file at: ${tasksPath}`);
    log.info(`Status filter: ${statusFilter}, withSubtasks: ${withSubtasks}`);
    
    // Call listTasks with json format
    const result = listTasks(tasksPath, statusFilter, withSubtasks, 'json');
    
    if (!result || !result.tasks) {
      throw new Error('Invalid or empty response from listTasks function');
    }
    
    log.info(`Successfully retrieved ${result.tasks.length} tasks`);
    
    // Return the raw result directly
    return {
      success: true,
      data: result // Return the actual object, not a stringified version
    };
  } catch (error) {
    log.error(`Error in listTasksDirect: ${error.message}`);
    
    // Ensure we always return a properly structured error object
    return {
      success: false,
      error: {
        code: error.code || 'LIST_TASKS_ERROR',
        message: error.message || 'Unknown error occurred'
      }
    };
  }
}

/**
 * Maps Task Master functions to their direct implementation
 */
export const directFunctions = {
  list: listTasksDirect,
  // Add more functions as we implement them
}; 