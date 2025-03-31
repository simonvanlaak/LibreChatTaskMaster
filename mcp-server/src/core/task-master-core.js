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
  parsePRD,
  updateTasks,
  // We'll import more functions as we continue implementation
} from '../../../scripts/modules/task-manager.js';

// Import context manager
import { contextManager } from './context-manager.js';
import { getCachedOrExecute } from '../tools/utils.js'; // Import the utility here

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
  const error = new Error(`Tasks file not found in any of the expected locations relative to ${projectRoot}: ${possiblePaths.join(', ')}`);
  error.code = 'TASKS_FILE_NOT_FOUND';
  throw error;
}

/**
 * Direct function wrapper for listTasks with error handling and caching.
 *
 * @param {Object} args - Command arguments (projectRoot is expected to be resolved).
 * @param {Object} log - Logger object.
 * @returns {Promise<Object>} - Task list result { success: boolean, data?: any, error?: { code: string, message: string }, fromCache: boolean }.
 */
export async function listTasksDirect(args, log) {
  let tasksPath;
  try {
    // Find the tasks path first - needed for cache key and execution
    tasksPath = findTasksJsonPath(args, log);
  } catch (error) {
    if (error.code === 'TASKS_FILE_NOT_FOUND') {
      log.error(`Tasks file not found: ${error.message}`);
      // Return the error structure expected by the calling tool/handler
      return { success: false, error: { code: error.code, message: error.message }, fromCache: false };
    }
    log.error(`Unexpected error finding tasks file: ${error.message}`);
    // Re-throw for outer catch or return structured error
     return { success: false, error: { code: 'FIND_TASKS_PATH_ERROR', message: error.message }, fromCache: false };
  }

  // Generate cache key *after* finding tasksPath
  const statusFilter = args.status || 'all';
  const withSubtasks = args.withSubtasks || false;
  const cacheKey = `listTasks:${tasksPath}:${statusFilter}:${withSubtasks}`;
  
  // Define the action function to be executed on cache miss
  const coreListTasksAction = async () => {
    try {
      log.info(`Executing core listTasks function for path: ${tasksPath}, filter: ${statusFilter}, subtasks: ${withSubtasks}`);
      const resultData = listTasks(tasksPath, statusFilter, withSubtasks, 'json');

      if (!resultData || !resultData.tasks) {
        log.error('Invalid or empty response from listTasks core function');
        return { success: false, error: { code: 'INVALID_CORE_RESPONSE', message: 'Invalid or empty response from listTasks core function' } };
      }
      log.info(`Core listTasks function retrieved ${resultData.tasks.length} tasks`);
      return { success: true, data: resultData };

    } catch (error) {
      log.error(`Core listTasks function failed: ${error.message}`);
      return { success: false, error: { code: 'LIST_TASKS_CORE_ERROR', message: error.message || 'Failed to list tasks' } };
    }
  };

  // Use the caching utility
  try {
      const result = await getCachedOrExecute({
          cacheKey,
          actionFn: coreListTasksAction,
          log
      });
      log.info(`listTasksDirect completed. From cache: ${result.fromCache}`);
      return result; // Returns { success, data/error, fromCache }
  } catch(error) {
      // Catch unexpected errors from getCachedOrExecute itself (though unlikely)
      log.error(`Unexpected error during getCachedOrExecute for listTasks: ${error.message}`);
      console.error(error.stack);
      return { success: false, error: { code: 'CACHE_UTIL_ERROR', message: error.message }, fromCache: false };
  }
}

/**
 * Get cache statistics for monitoring
 * @param {Object} args - Command arguments
 * @param {Object} log - Logger object
 * @returns {Object} - Cache statistics
 */
export async function getCacheStatsDirect(args, log) {
  try {
    log.info('Retrieving cache statistics');
    const stats = contextManager.getStats();
    return {
      success: true,
      data: stats
    };
  } catch (error) {
    log.error(`Error getting cache stats: ${error.message}`);
    return {
      success: false,
      error: {
        code: 'CACHE_STATS_ERROR',
        message: error.message || 'Unknown error occurred'
      }
    };
  }
}

/**
 * Direct function wrapper for parsing PRD documents and generating tasks.
 * 
 * @param {Object} args - Command arguments containing input, numTasks or tasks, and output options.
 * @param {Object} log - Logger object.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function parsePRDDirect(args, log) {
  try {
    log.info(`Parsing PRD document with args: ${JSON.stringify(args)}`);
    
    // Check required parameters
    if (!args.input) {
      const errorMessage = 'No input file specified. Please provide an input PRD document path.';
      log.error(errorMessage);
      return { 
        success: false, 
        error: { code: 'MISSING_INPUT_FILE', message: errorMessage },
        fromCache: false 
      };
    }
    
    // Resolve input path (relative to project root if provided)
    const projectRoot = args.projectRoot || process.cwd();
    const inputPath = path.isAbsolute(args.input) ? args.input : path.resolve(projectRoot, args.input);
    
    // Determine output path
    let outputPath;
    if (args.output) {
      outputPath = path.isAbsolute(args.output) ? args.output : path.resolve(projectRoot, args.output);
    } else {
      // Default to tasks/tasks.json in the project root
      outputPath = path.resolve(projectRoot, 'tasks', 'tasks.json');
    }
    
    // Verify input file exists
    if (!fs.existsSync(inputPath)) {
      const errorMessage = `Input file not found: ${inputPath}`;
      log.error(errorMessage);
      return { 
        success: false, 
        error: { code: 'INPUT_FILE_NOT_FOUND', message: errorMessage },
        fromCache: false 
      };
    }
    
    // Parse number of tasks - handle both string and number values
    let numTasks = 10; // Default
    if (args.numTasks) {
      numTasks = typeof args.numTasks === 'string' ? parseInt(args.numTasks, 10) : args.numTasks;
      if (isNaN(numTasks)) {
        numTasks = 10; // Fallback to default if parsing fails
        log.warn(`Invalid numTasks value: ${args.numTasks}. Using default: 10`);
      }
    }
    
    log.info(`Preparing to parse PRD from ${inputPath} and output to ${outputPath} with ${numTasks} tasks`);
    
    // Execute core parsePRD function (which is not async but we'll await it to maintain consistency)
    await parsePRD(inputPath, outputPath, numTasks);
    
    // Since parsePRD doesn't return a value but writes to a file, we'll read the result
    // to return it to the caller
    if (fs.existsSync(outputPath)) {
      const tasksData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      log.info(`Successfully parsed PRD and generated ${tasksData.tasks?.length || 0} tasks`);
      
      return {
        success: true,
        data: {
          message: `Successfully generated ${tasksData.tasks?.length || 0} tasks from PRD`,
          taskCount: tasksData.tasks?.length || 0,
          outputPath
        },
        fromCache: false // This operation always modifies state and should never be cached
      };
    } else {
      const errorMessage = `Tasks file was not created at ${outputPath}`;
      log.error(errorMessage);
      return { 
        success: false, 
        error: { code: 'OUTPUT_FILE_NOT_CREATED', message: errorMessage },
        fromCache: false 
      };
    }
  } catch (error) {
    log.error(`Error parsing PRD: ${error.message}`);
    return { 
      success: false, 
      error: { code: 'PARSE_PRD_ERROR', message: error.message || 'Unknown error parsing PRD' },
      fromCache: false 
    };
  }
}

/**
 * Direct function wrapper for updating tasks based on new context/prompt.
 * 
 * @param {Object} args - Command arguments containing fromId, prompt, useResearch and file path options.
 * @param {Object} log - Logger object.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function updateTasksDirect(args, log) {
  try {
    log.info(`Updating tasks with args: ${JSON.stringify(args)}`);
    
    // Check required parameters
    if (!args.from) {
      const errorMessage = 'No from ID specified. Please provide a task ID to start updating from.';
      log.error(errorMessage);
      return { 
        success: false, 
        error: { code: 'MISSING_FROM_ID', message: errorMessage },
        fromCache: false 
      };
    }
    
    if (!args.prompt) {
      const errorMessage = 'No prompt specified. Please provide a prompt with new context for task updates.';
      log.error(errorMessage);
      return { 
        success: false, 
        error: { code: 'MISSING_PROMPT', message: errorMessage },
        fromCache: false 
      };
    }
    
    // Parse fromId - handle both string and number values
    let fromId;
    if (typeof args.from === 'string') {
      fromId = parseInt(args.from, 10);
      if (isNaN(fromId)) {
        const errorMessage = `Invalid from ID: ${args.from}. Task ID must be a positive integer.`;
        log.error(errorMessage);
        return { 
          success: false, 
          error: { code: 'INVALID_FROM_ID', message: errorMessage },
          fromCache: false 
        };
      }
    } else {
      fromId = args.from;
    }
    
    // Get tasks file path
    let tasksPath;
    try {
      tasksPath = findTasksJsonPath(args, log);
    } catch (error) {
      log.error(`Error finding tasks file: ${error.message}`);
      return { 
        success: false, 
        error: { code: 'TASKS_FILE_ERROR', message: error.message },
        fromCache: false 
      };
    }
    
    // Get research flag
    const useResearch = args.research === true;
    
    log.info(`Updating tasks from ID ${fromId} with prompt "${args.prompt}" and research: ${useResearch}`);
    
    // Execute core updateTasks function
    await updateTasks(tasksPath, fromId, args.prompt, useResearch);
    
    // Since updateTasks doesn't return a value but modifies the tasks file,
    // we'll return a success message
    return {
      success: true,
      data: {
        message: `Successfully updated tasks from ID ${fromId} based on the prompt`,
        fromId,
        tasksPath,
        useResearch
      },
      fromCache: false // This operation always modifies state and should never be cached
    };
  } catch (error) {
    log.error(`Error updating tasks: ${error.message}`);
    return { 
      success: false, 
      error: { code: 'UPDATE_TASKS_ERROR', message: error.message || 'Unknown error updating tasks' },
      fromCache: false 
    };
  }
}

/**
 * Maps Task Master functions to their direct implementation
 */
export const directFunctions = {
  list: listTasksDirect,
  cacheStats: getCacheStatsDirect,
  parsePRD: parsePRDDirect,
  update: updateTasksDirect,
  // Add more functions as we implement them
}; 