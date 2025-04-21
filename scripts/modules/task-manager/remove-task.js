import fs from 'fs';
import path from 'path';

import { log, readJSON, writeJSON } from '../utils.js';
import generateTaskFiles from './generate-task-files.js';
import taskExists from './task-exists.js';

/**
 * Removes a task or subtask from the tasks file
 * @param {string} tasksPath - Path to the tasks file
 * @param {string|number} taskId - ID of task or subtask to remove (e.g., '5' or '5.2')
 * @returns {Object} Result object with success message and removed task info
 */
async function removeTask(tasksPath, taskId) {
	try {
		// Read the tasks file
		const data = readJSON(tasksPath);
		if (!data || !data.tasks) {
			throw new Error(`No valid tasks found in ${tasksPath}`);
		}

		// Check if the task ID exists
		if (!taskExists(data.tasks, taskId)) {
			throw new Error(`Task with ID ${taskId} not found`);
		}

		// Handle subtask removal (e.g., '5.2')
		if (typeof taskId === 'string' && taskId.includes('.')) {
			const [parentTaskId, subtaskId] = taskId
				.split('.')
				.map((id) => parseInt(id, 10));

			// Find the parent task
			const parentTask = data.tasks.find((t) => t.id === parentTaskId);
			if (!parentTask || !parentTask.subtasks) {
				throw new Error(
					`Parent task with ID ${parentTaskId} or its subtasks not found`
				);
			}

			// Find the subtask to remove
			const subtaskIndex = parentTask.subtasks.findIndex(
				(st) => st.id === subtaskId
			);
			if (subtaskIndex === -1) {
				throw new Error(
					`Subtask with ID ${subtaskId} not found in parent task ${parentTaskId}`
				);
			}

			// Store the subtask info before removal for the result
			const removedSubtask = parentTask.subtasks[subtaskIndex];

			// Remove the subtask
			parentTask.subtasks.splice(subtaskIndex, 1);

			// Remove references to this subtask in other subtasks' dependencies
			if (parentTask.subtasks && parentTask.subtasks.length > 0) {
				parentTask.subtasks.forEach((subtask) => {
					if (
						subtask.dependencies &&
						subtask.dependencies.includes(subtaskId)
					) {
						subtask.dependencies = subtask.dependencies.filter(
							(depId) => depId !== subtaskId
						);
					}
				});
			}

			// Save the updated tasks
			writeJSON(tasksPath, data);

			// Generate updated task files
			try {
				await generateTaskFiles(tasksPath, path.dirname(tasksPath));
			} catch (genError) {
				log(
					'warn',
					`Successfully removed subtask but failed to regenerate task files: ${genError.message}`
				);
			}

			return {
				success: true,
				message: `Successfully removed subtask ${subtaskId} from task ${parentTaskId}`,
				removedTask: removedSubtask,
				parentTaskId: parentTaskId
			};
		}

		// Handle main task removal
		const taskIdNum = parseInt(taskId, 10);
		const taskIndex = data.tasks.findIndex((t) => t.id === taskIdNum);
		if (taskIndex === -1) {
			throw new Error(`Task with ID ${taskId} not found`);
		}

		// Store the task info before removal for the result
		const removedTask = data.tasks[taskIndex];

		// Remove the task
		data.tasks.splice(taskIndex, 1);

		// Remove references to this task in other tasks' dependencies
		data.tasks.forEach((task) => {
			if (task.dependencies && task.dependencies.includes(taskIdNum)) {
				task.dependencies = task.dependencies.filter(
					(depId) => depId !== taskIdNum
				);
			}
		});

		// Save the updated tasks
		writeJSON(tasksPath, data);

		// Delete the task file if it exists
		const taskFileName = path.join(
			path.dirname(tasksPath),
			`task_${taskIdNum.toString().padStart(3, '0')}.txt`
		);
		if (fs.existsSync(taskFileName)) {
			try {
				fs.unlinkSync(taskFileName);
			} catch (unlinkError) {
				log(
					'warn',
					`Successfully removed task from tasks.json but failed to delete task file: ${unlinkError.message}`
				);
			}
		}

		// Generate updated task files
		try {
			await generateTaskFiles(tasksPath, path.dirname(tasksPath));
		} catch (genError) {
			log(
				'warn',
				`Successfully removed task but failed to regenerate task files: ${genError.message}`
			);
		}

		return {
			success: true,
			message: `Successfully removed task ${taskId}`,
			removedTask: removedTask
		};
	} catch (error) {
		log('error', `Error removing task: ${error.message}`);
		throw {
			code: 'REMOVE_TASK_ERROR',
			message: error.message,
			details: error.stack
		};
	}
}

export default removeTask;
