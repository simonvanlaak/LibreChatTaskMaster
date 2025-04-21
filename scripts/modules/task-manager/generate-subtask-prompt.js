/**
 * Generate a prompt for creating subtasks from a task
 * @param {Object} task - The task to generate subtasks for
 * @param {number} numSubtasks - Number of subtasks to generate
 * @param {string} additionalContext - Additional context to include in the prompt
 * @param {Object} taskAnalysis - Optional complexity analysis for the task
 * @returns {string} - The generated prompt
 */
function generateSubtaskPrompt(
	task,
	numSubtasks,
	additionalContext = '',
	taskAnalysis = null
) {
	// Build the system prompt
	const basePrompt = `You need to break down the following task into ${numSubtasks} specific subtasks that can be implemented one by one.

Task ID: ${task.id}
Title: ${task.title}
Description: ${task.description || 'No description provided'}
Current details: ${task.details || 'No details provided'}
${additionalContext ? `\nAdditional context to consider: ${additionalContext}` : ''}
${taskAnalysis ? `\nComplexity analysis: This task has a complexity score of ${taskAnalysis.complexityScore}/10.` : ''}
${taskAnalysis && taskAnalysis.reasoning ? `\nReasoning for complexity: ${taskAnalysis.reasoning}` : ''}

Subtasks should:
1. Be specific and actionable implementation steps
2. Follow a logical sequence
3. Each handle a distinct part of the parent task
4. Include clear guidance on implementation approach
5. Have appropriate dependency chains between subtasks
6. Collectively cover all aspects of the parent task

Return exactly ${numSubtasks} subtasks with the following JSON structure:
[
  {
    "id": 1,
    "title": "First subtask title",
    "description": "Detailed description",
    "dependencies": [], 
    "details": "Implementation details"
  },
  ...more subtasks...
]

Note on dependencies: Subtasks can depend on other subtasks with lower IDs. Use an empty array if there are no dependencies.`;

	return basePrompt;
}

export default generateSubtaskPrompt;
