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
import { updateTaskByIdDirect } from './direct-functions/update-task-by-id.js';
import { updateSubtaskByIdDirect } from './direct-functions/update-subtask-by-id.js';
import { generateTaskFilesDirect } from './direct-functions/generate-task-files.js';
import { setTaskStatusDirect } from './direct-functions/set-task-status.js';
import { showTaskDirect } from './direct-functions/show-task.js';
import { nextTaskDirect } from './direct-functions/next-task.js';
import { expandTaskDirect } from './direct-functions/expand-task.js';

// Re-export utility functions
export { findTasksJsonPath } from './utils/path-utils.js';

// Re-export all direct functions
export {
  listTasksDirect,
  getCacheStatsDirect,
  parsePRDDirect,
  updateTasksDirect,
  updateTaskByIdDirect,
  updateSubtaskByIdDirect,
  generateTaskFilesDirect,
  setTaskStatusDirect,
  showTaskDirect,
  nextTaskDirect,
  expandTaskDirect,
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
  updateTask: updateTaskByIdDirect,
  updateSubtask: updateSubtaskByIdDirect,
  generate: generateTaskFilesDirect,
  setStatus: setTaskStatusDirect,
  showTask: showTaskDirect,
  nextTask: nextTaskDirect,
  expandTask: expandTaskDirect,
  // Add more functions as we implement them
}; 