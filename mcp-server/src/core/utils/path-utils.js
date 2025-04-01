/**
 * path-utils.js
 * Utility functions for file path operations in Task Master
 * 
 * This module provides robust path resolution for both:
 * 1. PACKAGE PATH: Where task-master code is installed 
 *    (global node_modules OR local ./node_modules/task-master OR direct from repo)
 * 2. PROJECT PATH: Where user's tasks.json resides (typically user's project root)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

// Store last found project root to improve performance on subsequent calls
export let lastFoundProjectRoot = null;

// Project marker files that indicate a potential project root
export const PROJECT_MARKERS = [
  // Task Master specific
  'tasks.json',
  'tasks/tasks.json',
  
  // Common version control
  '.git',
  '.svn',
  
  // Common package files
  'package.json',
  'pyproject.toml',
  'Gemfile',
  'go.mod',
  'Cargo.toml',
  
  // Common IDE/editor folders
  '.cursor',
  '.vscode',
  '.idea',
  
  // Common dependency directories (check if directory)
  'node_modules',
  'venv',
  '.venv',
  
  // Common config files
  '.env',
  '.eslintrc',
  'tsconfig.json',
  'babel.config.js',
  'jest.config.js',
  'webpack.config.js',
  
  // Common CI/CD files
  '.github/workflows',
  '.gitlab-ci.yml',
  '.circleci/config.yml'
];

/**
 * Gets the path to the task-master package installation directory
 * @returns {string} - Absolute path to the package installation directory
 */
export function getPackagePath() {
  // When running from source, __dirname is the directory containing this file
  // When running from npm, we need to find the package root
  const thisFilePath = fileURLToPath(import.meta.url);
  const thisFileDir = path.dirname(thisFilePath);
  
  // Navigate from core/utils up to the package root
  // In dev: /path/to/task-master/mcp-server/src/core/utils -> /path/to/task-master
  // In npm: /path/to/node_modules/task-master/mcp-server/src/core/utils -> /path/to/node_modules/task-master
  return path.resolve(thisFileDir, '../../../../');
}

/**
 * Finds the absolute path to the tasks.json file based on project root and arguments.
 * @param {Object} args - Command arguments, potentially including 'projectRoot' and 'file'.
 * @param {Object} log - Logger object.
 * @returns {string} - Absolute path to the tasks.json file.
 * @throws {Error} - If tasks.json cannot be found.
 */
export function findTasksJsonPath(args, log) {
  // PRECEDENCE ORDER:
  // 1. Environment variable override
  // 2. Explicitly provided projectRoot in args
  // 3. Previously found/cached project root
  // 4. Current directory and parent traversal
  // 5. Package directory (for development scenarios)
  
  // 1. Check for environment variable override
  if (process.env.TASK_MASTER_PROJECT_ROOT) {
    const envProjectRoot = process.env.TASK_MASTER_PROJECT_ROOT;
    log.info(`Using project root from TASK_MASTER_PROJECT_ROOT environment variable: ${envProjectRoot}`);
    return findTasksJsonInDirectory(envProjectRoot, args.file, log);
  }
  
  // 2. If project root is explicitly provided, use it directly
  if (args.projectRoot) {
    const projectRoot = args.projectRoot;
    log.info(`Using explicitly provided project root: ${projectRoot}`);
    return findTasksJsonInDirectory(projectRoot, args.file, log);
  }
  
  // 3. If we have a last known project root that worked, try it first
  if (lastFoundProjectRoot) {
    log.info(`Trying last known project root: ${lastFoundProjectRoot}`);
    try {
      const tasksPath = findTasksJsonInDirectory(lastFoundProjectRoot, args.file, log);
      return tasksPath;
    } catch (error) {
      log.info(`Task file not found in last known project root, continuing search.`);
      // Continue with search if not found
    }
  }
  
  // 4. Start with current directory - this is likely the user's project directory
  const startDir = process.cwd();
  log.info(`Searching for tasks.json starting from current directory: ${startDir}`);
  
  // Try to find tasks.json by walking up the directory tree from cwd
  try {
    return findTasksJsonWithParentSearch(startDir, args.file, log);
  } catch (error) {
    // 5. If not found in cwd or parents, package might be installed via npm
    // and the user could be in an unrelated directory
    
    // As a last resort, check if there's a tasks.json in the package directory itself
    // (for development scenarios)
    const packagePath = getPackagePath();
    if (packagePath !== startDir) {
      log.info(`Tasks file not found in current directory tree. Checking package directory: ${packagePath}`);
      try {
        return findTasksJsonInDirectory(packagePath, args.file, log);
      } catch (packageError) {
        // Fall through to throw the original error
      }
    }
    
    // If all attempts fail, throw the original error with guidance
    error.message = `${error.message}\n\nPossible solutions:
1. Run the command from your project directory containing tasks.json
2. Use --project-root=/path/to/project to specify the project location
3. Set TASK_MASTER_PROJECT_ROOT environment variable to your project path`;
    throw error;
  }
}

/**
 * Check if a directory contains any project marker files or directories
 * @param {string} dirPath - Directory to check
 * @returns {boolean} - True if the directory contains any project markers
 */
function hasProjectMarkers(dirPath) {
  return PROJECT_MARKERS.some(marker => {
    const markerPath = path.join(dirPath, marker);
    // Check if the marker exists as either a file or directory
    return fs.existsSync(markerPath);
  });
}

/**
 * Search for tasks.json in a specific directory
 * @param {string} dirPath - Directory to search in
 * @param {string} explicitFilePath - Optional explicit file path relative to dirPath
 * @param {Object} log - Logger object
 * @returns {string} - Absolute path to tasks.json
 * @throws {Error} - If tasks.json cannot be found
 */
function findTasksJsonInDirectory(dirPath, explicitFilePath, log) {
  const possiblePaths = [];

  // 1. If a file is explicitly provided relative to dirPath
  if (explicitFilePath) {
    possiblePaths.push(path.resolve(dirPath, explicitFilePath));
  }

  // 2. Check the standard locations relative to dirPath
  possiblePaths.push(
    path.join(dirPath, 'tasks.json'),
    path.join(dirPath, 'tasks', 'tasks.json')
  );

  log.info(`Checking potential task file paths: ${possiblePaths.join(', ')}`);

  // Find the first existing path
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log.info(`Found tasks file at: ${p}`);
      // Store the project root for future use
      lastFoundProjectRoot = dirPath;
      return p;
    }
  }

  // If no file was found, throw an error
  const error = new Error(`Tasks file not found in any of the expected locations relative to ${dirPath}: ${possiblePaths.join(', ')}`);
  error.code = 'TASKS_FILE_NOT_FOUND';
  throw error;
}

/**
 * Recursively search for tasks.json in the given directory and parent directories
 * Also looks for project markers to identify potential project roots
 * @param {string} startDir - Directory to start searching from
 * @param {string} explicitFilePath - Optional explicit file path
 * @param {Object} log - Logger object
 * @returns {string} - Absolute path to tasks.json
 * @throws {Error} - If tasks.json cannot be found in any parent directory
 */
function findTasksJsonWithParentSearch(startDir, explicitFilePath, log) {
  let currentDir = startDir;
  const rootDir = path.parse(currentDir).root;
  
  // Keep traversing up until we hit the root directory
  while (currentDir !== rootDir) {
    // First check for tasks.json directly
    try {
      return findTasksJsonInDirectory(currentDir, explicitFilePath, log);
    } catch (error) {
      // If tasks.json not found but the directory has project markers,
      // log it as a potential project root (helpful for debugging)
      if (hasProjectMarkers(currentDir)) {
        log.info(`Found project markers in ${currentDir}, but no tasks.json`);
      }
      
      // Move up to parent directory
      const parentDir = path.dirname(currentDir);
      
      // Check if we've reached the root
      if (parentDir === currentDir) {
        break;
      }
      
      log.info(`Tasks file not found in ${currentDir}, searching in parent directory: ${parentDir}`);
      currentDir = parentDir;
    }
  }
  
  // If we've searched all the way to the root and found nothing
  const error = new Error(`Tasks file not found in ${startDir} or any parent directory.`);
  error.code = 'TASKS_FILE_NOT_FOUND';
  throw error;
}

function findTasksWithNpmConsideration(startDir, log) {
  // First try our recursive parent search from cwd
  try {
    return findTasksJsonWithParentSearch(startDir, null, log);
  } catch (error) {
    // If that fails, try looking relative to the executable location
    const execPath = process.argv[1];
    const execDir = path.dirname(execPath);
    log.info(`Looking for tasks file relative to executable at: ${execDir}`);
    
    try {
      return findTasksJsonWithParentSearch(execDir, null, log);
    } catch (secondError) {
      // If that also fails, check standard locations in user's home directory
      const homeDir = os.homedir();
      log.info(`Looking for tasks file in home directory: ${homeDir}`);
      
      try {
        // Check standard locations in home dir
        return findTasksJsonInDirectory(path.join(homeDir, '.task-master'), null, log);
      } catch (thirdError) {
        // If all approaches fail, throw the original error
        throw error;
      }
    }
  }
} 