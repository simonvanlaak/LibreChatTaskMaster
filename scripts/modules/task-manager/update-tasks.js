import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';

import { log, readJSON, writeJSON, truncate, isSilentMode } from '../utils.js';

import {
	getStatusWithColor,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';

import { getDebugFlag } from '../config-manager.js';
import generateTaskFiles from './generate-task-files.js';

/**
 * Update tasks based on new context
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number} fromId - Task ID to start updating from
 * @param {string} prompt - Prompt with new context
 * @param {boolean} useResearch - Whether to use Perplexity AI for research
 * @param {function} reportProgress - Function to report progress to MCP server (optional)
 * @param {Object} mcpLog - MCP logger object (optional)
 * @param {Object} session - Session object from MCP server (optional)
 */
async function updateTasks(
	tasksPath,
	fromId,
	prompt,
	useResearch = false,
	{ reportProgress, mcpLog, session } = {}
) {
	// Determine output format based on mcpLog presence (simplification)
	const outputFormat = mcpLog ? 'json' : 'text';

	// Create custom reporter that checks for MCP log and silent mode
	const report = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (!isSilentMode() && outputFormat === 'text') {
			// Only log to console if not in silent mode and outputFormat is 'text'
			log(level, message);
		}
	};

	try {
		report(`Updating tasks from ID ${fromId} with prompt: "${prompt}"`);

		// Read the tasks file
		const data = readJSON(tasksPath);
		if (!data || !data.tasks) {
			throw new Error(`No valid tasks found in ${tasksPath}`);
		}

		// Find tasks to update (ID >= fromId and not 'done')
		const tasksToUpdate = data.tasks.filter(
			(task) => task.id >= fromId && task.status !== 'done'
		);
		if (tasksToUpdate.length === 0) {
			report(
				`No tasks to update (all tasks with ID >= ${fromId} are already marked as done)`,
				'info'
			);

			// Only show UI elements for text output (CLI)
			if (outputFormat === 'text') {
				console.log(
					chalk.yellow(
						`No tasks to update (all tasks with ID >= ${fromId} are already marked as done)`
					)
				);
			}
			return;
		}

		// Only show UI elements for text output (CLI)
		if (outputFormat === 'text') {
			// Show the tasks that will be updated
			const table = new Table({
				head: [
					chalk.cyan.bold('ID'),
					chalk.cyan.bold('Title'),
					chalk.cyan.bold('Status')
				],
				colWidths: [5, 60, 10]
			});

			tasksToUpdate.forEach((task) => {
				table.push([
					task.id,
					truncate(task.title, 57),
					getStatusWithColor(task.status)
				]);
			});

			console.log(
				boxen(chalk.white.bold(`Updating ${tasksToUpdate.length} tasks`), {
					padding: 1,
					borderColor: 'blue',
					borderStyle: 'round',
					margin: { top: 1, bottom: 0 }
				})
			);

			console.log(table.toString());

			// Display a message about how completed subtasks are handled
			console.log(
				boxen(
					chalk.cyan.bold('How Completed Subtasks Are Handled:') +
						'\n\n' +
						chalk.white(
							'• Subtasks marked as "done" or "completed" will be preserved\n'
						) +
						chalk.white(
							'• New subtasks will build upon what has already been completed\n'
						) +
						chalk.white(
							'• If completed work needs revision, a new subtask will be created instead of modifying done items\n'
						) +
						chalk.white(
							'• This approach maintains a clear record of completed work and new requirements'
						),
					{
						padding: 1,
						borderColor: 'blue',
						borderStyle: 'round',
						margin: { top: 1, bottom: 1 }
					}
				)
			);
		}

		// Build the system prompt
		const systemPrompt = `You are an AI assistant helping to update software development tasks based on new context.
You will be given a set of tasks and a prompt describing changes or new implementation details.
Your job is to update the tasks to reflect these changes, while preserving their basic structure.

Guidelines:
1. Maintain the same IDs, statuses, and dependencies unless specifically mentioned in the prompt
2. Update titles, descriptions, details, and test strategies to reflect the new information
3. Do not change anything unnecessarily - just adapt what needs to change based on the prompt
4. You should return ALL the tasks in order, not just the modified ones
5. Return a complete valid JSON object with the updated tasks array
6. VERY IMPORTANT: Preserve all subtasks marked as "done" or "completed" - do not modify their content
7. For tasks with completed subtasks, build upon what has already been done rather than rewriting everything
8. If an existing completed subtask needs to be changed/undone based on the new context, DO NOT modify it directly
9. Instead, add a new subtask that clearly indicates what needs to be changed or replaced
10. Use the existence of completed subtasks as an opportunity to make new subtasks more specific and targeted

The changes described in the prompt should be applied to ALL tasks in the list.`;

		const taskData = JSON.stringify(tasksToUpdate, null, 2);

		// Initialize variables for model selection and fallback
		let updatedTasks;
		let loadingIndicator = null;
		let claudeOverloaded = false;
		let modelAttempts = 0;
		const maxModelAttempts = 2; // Try up to 2 models before giving up

		// Only create loading indicator for text output (CLI) initially
		if (outputFormat === 'text') {
			loadingIndicator = startLoadingIndicator(
				useResearch
					? 'Updating tasks with Perplexity AI research...'
					: 'Updating tasks with Claude AI...'
			);
		}

		try {
			// Import the getAvailableAIModel function
			const { getAvailableAIModel } = await import('./ai-services.js');

			// Try different models with fallback
			while (modelAttempts < maxModelAttempts && !updatedTasks) {
				modelAttempts++;
				const isLastAttempt = modelAttempts >= maxModelAttempts;
				let modelType = null;

				try {
					// Get the appropriate model based on current state
					const result = getAvailableAIModel({
						claudeOverloaded,
						requiresResearch: useResearch
					});
					modelType = result.type;
					const client = result.client;

					report(
						`Attempt ${modelAttempts}/${maxModelAttempts}: Updating tasks using ${modelType}`,
						'info'
					);

					// Update loading indicator - only for text output
					if (outputFormat === 'text') {
						if (loadingIndicator) {
							stopLoadingIndicator(loadingIndicator);
						}
						loadingIndicator = startLoadingIndicator(
							`Attempt ${modelAttempts}: Using ${modelType.toUpperCase()}...`
						);
					}

					if (modelType === 'perplexity') {
						// Call Perplexity AI using proper format
						const perplexityModel =
							process.env.PERPLEXITY_MODEL ||
							session?.env?.PERPLEXITY_MODEL ||
							'sonar-pro';
						const result = await client.chat.completions.create({
							model: perplexityModel,
							messages: [
								{
									role: 'system',
									content: `${systemPrompt}\n\nAdditionally, please research the latest best practices, implementation details, and considerations when updating these tasks. Use your online search capabilities to gather relevant information. Remember to strictly follow the guidelines about preserving completed subtasks and building upon what has already been done rather than modifying or replacing it.`
								},
								{
									role: 'user',
									content: `Here are the tasks to update:
${taskData}

Please update these tasks based on the following new context:
${prompt}

IMPORTANT: In the tasks JSON above, any subtasks with "status": "done" or "status": "completed" should be preserved exactly as is. Build your changes around these completed items.

Return only the updated tasks as a valid JSON array.`
								}
							],
							temperature: parseFloat(
								process.env.TEMPERATURE ||
									session?.env?.TEMPERATURE ||
									CONFIG.temperature
							),
							max_tokens: 8700
						});

						const responseText = result.choices[0].message.content;

						// Extract JSON from response
						const jsonStart = responseText.indexOf('[');
						const jsonEnd = responseText.lastIndexOf(']');

						if (jsonStart === -1 || jsonEnd === -1) {
							throw new Error(
								`Could not find valid JSON array in ${modelType}'s response`
							);
						}

						const jsonText = responseText.substring(jsonStart, jsonEnd + 1);
						updatedTasks = JSON.parse(jsonText);
					} else {
						// Call Claude to update the tasks with streaming
						let responseText = '';
						let streamingInterval = null;

						try {
							// Update loading indicator to show streaming progress - only for text output
							if (outputFormat === 'text') {
								let dotCount = 0;
								const readline = await import('readline');
								streamingInterval = setInterval(() => {
									readline.cursorTo(process.stdout, 0);
									process.stdout.write(
										`Receiving streaming response from Claude${'.'.repeat(dotCount)}`
									);
									dotCount = (dotCount + 1) % 4;
								}, 500);
							}

							// Use streaming API call
							const stream = await client.messages.create({
								model: session?.env?.ANTHROPIC_MODEL || CONFIG.model,
								max_tokens: session?.env?.MAX_TOKENS || CONFIG.maxTokens,
								temperature: session?.env?.TEMPERATURE || CONFIG.temperature,
								system: systemPrompt,
								messages: [
									{
										role: 'user',
										content: `Here is the task to update:
${taskData}

Please update this task based on the following new context:
${prompt}

IMPORTANT: In the task JSON above, any subtasks with "status": "done" or "status": "completed" should be preserved exactly as is. Build your changes around these completed items.

Return only the updated task as a valid JSON object.`
									}
								],
								stream: true
							});

							// Process the stream
							for await (const chunk of stream) {
								if (chunk.type === 'content_block_delta' && chunk.delta.text) {
									responseText += chunk.delta.text;
								}
								if (reportProgress) {
									await reportProgress({
										progress: (responseText.length / CONFIG.maxTokens) * 100
									});
								}
								if (mcpLog) {
									mcpLog.info(
										`Progress: ${(responseText.length / CONFIG.maxTokens) * 100}%`
									);
								}
							}

							if (streamingInterval) clearInterval(streamingInterval);

							report(
								`Completed streaming response from ${modelType} API (Attempt ${modelAttempts})`,
								'info'
							);

							// Extract JSON from response
							const jsonStart = responseText.indexOf('[');
							const jsonEnd = responseText.lastIndexOf(']');

							if (jsonStart === -1 || jsonEnd === -1) {
								throw new Error(
									`Could not find valid JSON array in ${modelType}'s response`
								);
							}

							const jsonText = responseText.substring(jsonStart, jsonEnd + 1);
							updatedTasks = JSON.parse(jsonText);
						} catch (streamError) {
							if (streamingInterval) clearInterval(streamingInterval);

							// Process stream errors explicitly
							report(`Stream error: ${streamError.message}`, 'error');

							// Check if this is an overload error
							let isOverload = false;
							// Check 1: SDK specific property
							if (streamError.type === 'overloaded_error') {
								isOverload = true;
							}
							// Check 2: Check nested error property
							else if (streamError.error?.type === 'overloaded_error') {
								isOverload = true;
							}
							// Check 3: Check status code
							else if (
								streamError.status === 429 ||
								streamError.status === 529
							) {
								isOverload = true;
							}
							// Check 4: Check message string
							else if (
								streamError.message?.toLowerCase().includes('overloaded')
							) {
								isOverload = true;
							}

							if (isOverload) {
								claudeOverloaded = true;
								report(
									'Claude overloaded. Will attempt fallback model if available.',
									'warn'
								);
								// Let the loop continue to try the next model
								throw new Error('Claude overloaded');
							} else {
								// Re-throw non-overload errors
								throw streamError;
							}
						}
					}

					// If we got here successfully, break out of the loop
					if (updatedTasks) {
						report(
							`Successfully updated tasks using ${modelType} on attempt ${modelAttempts}`,
							'success'
						);
						break;
					}
				} catch (modelError) {
					const failedModel = modelType || 'unknown model';
					report(
						`Attempt ${modelAttempts} failed using ${failedModel}: ${modelError.message}`,
						'warn'
					);

					// Continue to next attempt if we have more attempts and this was an overload error
					const wasOverload = modelError.message
						?.toLowerCase()
						.includes('overload');

					if (wasOverload && !isLastAttempt) {
						if (modelType === 'claude') {
							claudeOverloaded = true;
							report('Will attempt with Perplexity AI next', 'info');
						}
						continue; // Continue to next attempt
					} else if (isLastAttempt) {
						report(
							`Final attempt (${modelAttempts}/${maxModelAttempts}) failed. No fallback possible.`,
							'error'
						);
						throw modelError; // Re-throw on last attempt
					} else {
						throw modelError; // Re-throw for non-overload errors
					}
				}
			}

			// If we don't have updated tasks after all attempts, throw an error
			if (!updatedTasks) {
				throw new Error(
					'Failed to generate updated tasks after all model attempts'
				);
			}

			// Replace the tasks in the original data
			updatedTasks.forEach((updatedTask) => {
				const index = data.tasks.findIndex((t) => t.id === updatedTask.id);
				if (index !== -1) {
					data.tasks[index] = updatedTask;
				}
			});

			// Write the updated tasks to the file
			writeJSON(tasksPath, data);

			report(`Successfully updated ${updatedTasks.length} tasks`, 'success');

			// Generate individual task files
			await generateTaskFiles(tasksPath, path.dirname(tasksPath));

			// Only show success box for text output (CLI)
			if (outputFormat === 'text') {
				console.log(
					boxen(
						chalk.green(`Successfully updated ${updatedTasks.length} tasks`),
						{ padding: 1, borderColor: 'green', borderStyle: 'round' }
					)
				);
			}
		} finally {
			// Stop the loading indicator if it was created
			if (loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
				loadingIndicator = null;
			}
		}
	} catch (error) {
		report(`Error updating tasks: ${error.message}`, 'error');

		// Only show error box for text output (CLI)
		if (outputFormat === 'text') {
			console.error(chalk.red(`Error: ${error.message}`));

			// Provide helpful error messages based on error type
			if (error.message?.includes('ANTHROPIC_API_KEY')) {
				console.log(
					chalk.yellow('\nTo fix this issue, set your Anthropic API key:')
				);
				console.log('  export ANTHROPIC_API_KEY=your_api_key_here');
			} else if (error.message?.includes('PERPLEXITY_API_KEY') && useResearch) {
				console.log(chalk.yellow('\nTo fix this issue:'));
				console.log(
					'  1. Set your Perplexity API key: export PERPLEXITY_API_KEY=your_api_key_here'
				);
				console.log(
					'  2. Or run without the research flag: task-master update --from=<id> --prompt="..."'
				);
			} else if (error.message?.includes('overloaded')) {
				console.log(
					chalk.yellow(
						'\nAI model overloaded, and fallback failed or was unavailable:'
					)
				);
				console.log('  1. Try again in a few minutes.');
				console.log('  2. Ensure PERPLEXITY_API_KEY is set for fallback.');
			}

			if (getDebugFlag()) {
				// Use getter
				console.error(error);
			}

			process.exit(1);
		} else {
			throw error; // Re-throw for JSON output
		}
	}
}

export default updateTasks;
