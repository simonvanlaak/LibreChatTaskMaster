/**
 * Find the next pending task based on dependencies
 * @param {Object[]} tasks - The array of tasks
 * @returns {Object|null} The next task to work on or null if no eligible tasks
 */
function findNextTask(tasks) {
	// Get all completed task IDs
	const completedTaskIds = new Set(
		tasks
			.filter((t) => t.status === 'done' || t.status === 'completed')
			.map((t) => t.id)
	);

	// Filter for pending tasks whose dependencies are all satisfied
	const eligibleTasks = tasks.filter(
		(task) =>
			(task.status === 'pending' || task.status === 'in-progress') &&
			task.dependencies && // Make sure dependencies array exists
			task.dependencies.every((depId) => completedTaskIds.has(depId))
	);

	if (eligibleTasks.length === 0) {
		return null;
	}

	// Sort eligible tasks by:
	// 1. Priority (high > medium > low)
	// 2. Dependencies count (fewer dependencies first)
	// 3. ID (lower ID first)
	const priorityValues = { high: 3, medium: 2, low: 1 };

	const nextTask = eligibleTasks.sort((a, b) => {
		// Sort by priority first
		const priorityA = priorityValues[a.priority || 'medium'] || 2;
		const priorityB = priorityValues[b.priority || 'medium'] || 2;

		if (priorityB !== priorityA) {
			return priorityB - priorityA; // Higher priority first
		}

		// If priority is the same, sort by dependency count
		if (
			a.dependencies &&
			b.dependencies &&
			a.dependencies.length !== b.dependencies.length
		) {
			return a.dependencies.length - b.dependencies.length; // Fewer dependencies first
		}

		// If dependency count is the same, sort by ID
		return a.id - b.id; // Lower ID first
	})[0]; // Return the first (highest priority) task

	return nextTask;
}

export default findNextTask;
