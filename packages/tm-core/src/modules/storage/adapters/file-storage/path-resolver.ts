/**
 * @fileoverview Path resolution utilities for single tasks.json file
 */

import path from 'node:path';

const DEFAULT_STORAGE_ROOT = process.env.STORAGE_ROOT || '/storage';

/**
 * Resolve the base storage path, supporting per-user isolation for LibreChat.
 *
 * Priority:
 * 1) LIBRECHAT_USER_ID -> /storage/{user}/.taskmaster (or STORAGE_ROOT override)
 * 2) TASK_MASTER_STORAGE_ROOT explicit override
 * 3) Fallback to {projectPath}/.taskmaster
 */
function resolveBasePath(projectPath: string): string {
	const userId = process.env.LIBRECHAT_USER_ID;
	if (userId && !userId.startsWith('{{')) {
		const root = process.env.STORAGE_ROOT || DEFAULT_STORAGE_ROOT;
		return path.join(root, userId, '.taskmaster');
	}

	const customRoot = process.env.TASK_MASTER_STORAGE_ROOT;
	if (customRoot) {
		return customRoot;
	}

	return path.join(projectPath, '.taskmaster');
}

/**
 * Handles path resolution for the single tasks.json file storage
 */
export class PathResolver {
	private readonly basePath: string;
	private readonly tasksDir: string;
	private readonly tasksFilePath: string;

	constructor(projectPath: string) {
		this.basePath = resolveBasePath(projectPath);
		this.tasksDir = path.join(this.basePath, 'tasks');
		this.tasksFilePath = path.join(this.tasksDir, 'tasks.json');
	}

	/**
	 * Get the base storage directory path
	 */
	getBasePath(): string {
		return this.basePath;
	}

	/**
	 * Get the tasks directory path
	 */
	getTasksDir(): string {
		return this.tasksDir;
	}

	/**
	 * Get the path to the single tasks.json file
	 * All tags are stored in this one file
	 */
	getTasksPath(): string {
		return this.tasksFilePath;
	}
}
