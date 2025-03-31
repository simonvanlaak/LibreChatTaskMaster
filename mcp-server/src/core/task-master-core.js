/**
 * task-master-core.js
 * Central module that imports and re-exports all direct function implementations
 * for improved organization and maintainability.
 */

// Import direct function implementations
import { listTasksDirect } from './direct-functions/list-tasks.js';
import { getCacheStatsDirect } from './direct-functions/cache-stats.js';
import { parsePRDDirect } from './direct-functions/parse-prd.js';
import { updateTasksDirect } from './direct-functions/update-tasks.js';

// Re-export utility functions
export { findTasksJsonPath } from './utils/path-utils.js';

// Re-export all direct functions
export {
  listTasksDirect,
  getCacheStatsDirect,
  parsePRDDirect,
  updateTasksDirect,
};

/**
 * Maps Task Master functions to their direct implementation
 * This map is used by tools to look up the appropriate function by name
 */
export const directFunctions = {
  list: listTasksDirect,
  cacheStats: getCacheStatsDirect,
  parsePRD: parsePRDDirect,
  update: updateTasksDirect,
  // Add more functions as we implement them
}; 