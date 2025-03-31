/**
 * path-utils.js
 * Utility functions for file path operations in Task Master
 */

import path from 'path';
import fs from 'fs';

/**
 * Finds the absolute path to the tasks.json file based on project root and arguments.
 * @param {Object} args - Command arguments, potentially including 'projectRoot' and 'file'.
 * @param {Object} log - Logger object.
 * @returns {string} - Absolute path to the tasks.json file.
 * @throws {Error} - If tasks.json cannot be found.
 */
export function findTasksJsonPath(args, log) {
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