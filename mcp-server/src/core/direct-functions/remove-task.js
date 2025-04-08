/**
 * remove-task.js
 * Direct function implementation for removing a task
 */

import { removeTask } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import { findTasksJsonPath } from '../utils/path-utils.js';

/**
 * Direct function wrapper for removeTask with error handling.
 *
 * @param {Object} args - Command arguments
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} - Remove task result { success: boolean, data?: any, error?: { code: string, message: string }, fromCache: false }
 */
export async function removeTaskDirect(args, log) {
	try {
		// Find the tasks path first
		let tasksPath;
		try {
			tasksPath = findTasksJsonPath(args, log);
		} catch (error) {
			log.error(`Tasks file not found: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'FILE_NOT_FOUND_ERROR',
					message: error.message
				},
				fromCache: false
			};
		}

		// Validate task ID parameter
		const taskId = args.id;
		if (!taskId) {
			log.error('Task ID is required');
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message: 'Task ID is required'
				},
				fromCache: false
			};
		}

		// Skip confirmation in the direct function since it's handled by the client
		log.info(`Removing task with ID: ${taskId} from ${tasksPath}`);

		try {
			// Enable silent mode to prevent console logs from interfering with JSON response
			enableSilentMode();

			// Call the core removeTask function
			const result = await removeTask(tasksPath, taskId);

			// Restore normal logging
			disableSilentMode();

			log.info(`Successfully removed task: ${taskId}`);

			// Return the result
			return {
				success: true,
				data: {
					message: result.message,
					taskId: taskId,
					tasksPath: tasksPath,
					removedTask: result.removedTask
				},
				fromCache: false
			};
		} catch (error) {
			// Make sure to restore normal logging even if there's an error
			disableSilentMode();

			log.error(`Error removing task: ${error.message}`);
			return {
				success: false,
				error: {
					code: error.code || 'REMOVE_TASK_ERROR',
					message: error.message || 'Failed to remove task'
				},
				fromCache: false
			};
		}
	} catch (error) {
		// Ensure silent mode is disabled even if an outer error occurs
		disableSilentMode();

		// Catch any unexpected errors
		log.error(`Unexpected error in removeTaskDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'UNEXPECTED_ERROR',
				message: error.message
			},
			fromCache: false
		};
	}
}
