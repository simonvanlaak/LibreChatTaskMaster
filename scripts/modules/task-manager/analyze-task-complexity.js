import chalk from 'chalk';
import boxen from 'boxen';
import readline from 'readline';

import { log, readJSON, writeJSON, isSilentMode } from '../utils.js';

import { startLoadingIndicator, stopLoadingIndicator } from '../ui.js';

import { generateComplexityAnalysisPrompt } from '../ai-services.js';

import { getDebugFlag } from '../config-manager.js';

/**
 * Analyzes task complexity and generates expansion recommendations
 * @param {Object} options Command options
 * @param {function} reportProgress - Function to report progress to MCP server (optional)
 * @param {Object} mcpLog - MCP logger object (optional)
 * @param {Object} session - Session object from MCP server (optional)
 */
async function analyzeTaskComplexity(
	options,
	{ reportProgress, mcpLog, session } = {}
) {
	const tasksPath = options.file || 'tasks/tasks.json';
	const outputPath = options.output || 'scripts/task-complexity-report.json';
	const modelOverride = options.model;
	const thresholdScore = parseFloat(options.threshold || '5');
	const useResearch = options.research || false;

	// Determine output format based on mcpLog presence (simplification)
	const outputFormat = mcpLog ? 'json' : 'text';

	// Create custom reporter that checks for MCP log and silent mode
	const reportLog = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (!isSilentMode() && outputFormat === 'text') {
			// Only log to console if not in silent mode and outputFormat is 'text'
			log(level, message);
		}
	};

	// Only show UI elements for text output (CLI)
	if (outputFormat === 'text') {
		console.log(
			chalk.blue(
				`Analyzing task complexity and generating expansion recommendations...`
			)
		);
	}

	try {
		// Read tasks.json
		reportLog(`Reading tasks from ${tasksPath}...`, 'info');

		// Use either the filtered tasks data provided by the direct function or read from file
		let tasksData;
		let originalTaskCount = 0;

		if (options._filteredTasksData) {
			// If we have pre-filtered data from the direct function, use it
			tasksData = options._filteredTasksData;
			originalTaskCount = options._filteredTasksData.tasks.length;

			// Get the original task count from the full tasks array
			if (options._filteredTasksData._originalTaskCount) {
				originalTaskCount = options._filteredTasksData._originalTaskCount;
			} else {
				// Try to read the original file to get the count
				try {
					const originalData = readJSON(tasksPath);
					if (originalData && originalData.tasks) {
						originalTaskCount = originalData.tasks.length;
					}
				} catch (e) {
					// If we can't read the original file, just use the filtered count
					log('warn', `Could not read original tasks file: ${e.message}`);
				}
			}
		} else {
			// No filtered data provided, read from file
			tasksData = readJSON(tasksPath);

			if (
				!tasksData ||
				!tasksData.tasks ||
				!Array.isArray(tasksData.tasks) ||
				tasksData.tasks.length === 0
			) {
				throw new Error('No tasks found in the tasks file');
			}

			originalTaskCount = tasksData.tasks.length;

			// Filter out tasks with status done/cancelled/deferred
			const activeStatuses = ['pending', 'blocked', 'in-progress'];
			const filteredTasks = tasksData.tasks.filter((task) =>
				activeStatuses.includes(task.status?.toLowerCase() || 'pending')
			);

			// Store original data before filtering
			const skippedCount = originalTaskCount - filteredTasks.length;

			// Update tasksData with filtered tasks
			tasksData = {
				...tasksData,
				tasks: filteredTasks,
				_originalTaskCount: originalTaskCount
			};
		}

		// Calculate how many tasks we're skipping (done/cancelled/deferred)
		const skippedCount = originalTaskCount - tasksData.tasks.length;

		reportLog(
			`Found ${originalTaskCount} total tasks in the task file.`,
			'info'
		);

		if (skippedCount > 0) {
			const skipMessage = `Skipping ${skippedCount} tasks marked as done/cancelled/deferred. Analyzing ${tasksData.tasks.length} active tasks.`;
			reportLog(skipMessage, 'info');

			// For CLI output, make this more visible
			if (outputFormat === 'text') {
				console.log(chalk.yellow(skipMessage));
			}
		}

		// Prepare the prompt for the LLM
		const prompt = generateComplexityAnalysisPrompt(tasksData);

		// Only start loading indicator for text output (CLI)
		let loadingIndicator = null;
		if (outputFormat === 'text') {
			loadingIndicator = startLoadingIndicator(
				'Calling AI to analyze task complexity...'
			);
		}

		let fullResponse = '';
		let streamingInterval = null;

		try {
			// If research flag is set, use Perplexity first
			if (useResearch) {
				try {
					reportLog(
						'Using Perplexity AI for research-backed complexity analysis...',
						'info'
					);

					// Only show UI elements for text output (CLI)
					if (outputFormat === 'text') {
						console.log(
							chalk.blue(
								'Using Perplexity AI for research-backed complexity analysis...'
							)
						);
					}

					// Modify prompt to include more context for Perplexity and explicitly request JSON
					const researchPrompt = `You are conducting a detailed analysis of software development tasks to determine their complexity and how they should be broken down into subtasks.

Please research each task thoroughly, considering best practices, industry standards, and potential implementation challenges before providing your analysis.

CRITICAL: You MUST respond ONLY with a valid JSON array. Do not include ANY explanatory text, markdown formatting, or code block markers.

${prompt}

Your response must be a clean JSON array only, following exactly this format:
[
  {
    "taskId": 1,
    "taskTitle": "Example Task",
    "complexityScore": 7,
    "recommendedSubtasks": 4,
    "expansionPrompt": "Detailed prompt for expansion",
    "reasoning": "Explanation of complexity assessment"
  },
  // more tasks...
]

DO NOT include any text before or after the JSON array. No explanations, no markdown formatting.`;

					const result = await perplexity.chat.completions.create({
						model:
							process.env.PERPLEXITY_MODEL ||
							session?.env?.PERPLEXITY_MODEL ||
							'sonar-pro',
						messages: [
							{
								role: 'system',
								content:
									'You are a technical analysis AI that only responds with clean, valid JSON. Never include explanatory text or markdown formatting in your response.'
							},
							{
								role: 'user',
								content: researchPrompt
							}
						],
						temperature: session?.env?.TEMPERATURE || CONFIG.temperature,
						max_tokens: 8700,
						web_search_options: {
							search_context_size: 'high'
						},
						search_recency_filter: 'day'
					});

					// Extract the response text
					fullResponse = result.choices[0].message.content;
					reportLog(
						'Successfully generated complexity analysis with Perplexity AI',
						'success'
					);

					// Only show UI elements for text output (CLI)
					if (outputFormat === 'text') {
						console.log(
							chalk.green(
								'Successfully generated complexity analysis with Perplexity AI'
							)
						);
					}

					if (streamingInterval) clearInterval(streamingInterval);

					// Stop loading indicator if it was created
					if (loadingIndicator) {
						stopLoadingIndicator(loadingIndicator);
						loadingIndicator = null;
					}

					// ALWAYS log the first part of the response for debugging
					if (outputFormat === 'text') {
						console.log(chalk.gray('Response first 200 chars:'));
						console.log(chalk.gray(fullResponse.substring(0, 200)));
					}
				} catch (perplexityError) {
					reportLog(
						`Falling back to Claude for complexity analysis: ${perplexityError.message}`,
						'warn'
					);

					// Only show UI elements for text output (CLI)
					if (outputFormat === 'text') {
						console.log(
							chalk.yellow('Falling back to Claude for complexity analysis...')
						);
						console.log(
							chalk.gray('Perplexity error:'),
							perplexityError.message
						);
					}

					// Continue to Claude as fallback
					await useClaudeForComplexityAnalysis();
				}
			} else {
				// Use Claude directly if research flag is not set
				await useClaudeForComplexityAnalysis();
			}

			// Helper function to use Claude for complexity analysis
			async function useClaudeForComplexityAnalysis() {
				// Initialize retry variables for handling Claude overload
				let retryAttempt = 0;
				const maxRetryAttempts = 2;
				let claudeOverloaded = false;

				// Retry loop for Claude API calls
				while (retryAttempt < maxRetryAttempts) {
					retryAttempt++;
					const isLastAttempt = retryAttempt >= maxRetryAttempts;

					try {
						reportLog(
							`Claude API attempt ${retryAttempt}/${maxRetryAttempts}`,
							'info'
						);

						// Update loading indicator for CLI
						if (outputFormat === 'text' && loadingIndicator) {
							stopLoadingIndicator(loadingIndicator);
							loadingIndicator = startLoadingIndicator(
								`Claude API attempt ${retryAttempt}/${maxRetryAttempts}...`
							);
						}

						// Call the LLM API with streaming
						const stream = await anthropic.messages.create({
							max_tokens: session?.env?.MAX_TOKENS || CONFIG.maxTokens,
							model:
								modelOverride || CONFIG.model || session?.env?.ANTHROPIC_MODEL,
							temperature: session?.env?.TEMPERATURE || CONFIG.temperature,
							messages: [{ role: 'user', content: prompt }],
							system:
								'You are an expert software architect and project manager analyzing task complexity. Respond only with valid JSON.',
							stream: true
						});

						// Update loading indicator to show streaming progress - only for text output (CLI)
						if (outputFormat === 'text') {
							let dotCount = 0;
							streamingInterval = setInterval(() => {
								readline.cursorTo(process.stdout, 0);
								process.stdout.write(
									`Receiving streaming response from Claude${'.'.repeat(dotCount)}`
								);
								dotCount = (dotCount + 1) % 4;
							}, 500);
						}

						// Process the stream
						for await (const chunk of stream) {
							if (chunk.type === 'content_block_delta' && chunk.delta.text) {
								fullResponse += chunk.delta.text;
							}
							if (reportProgress) {
								await reportProgress({
									progress: (fullResponse.length / CONFIG.maxTokens) * 100
								});
							}
							if (mcpLog) {
								mcpLog.info(
									`Progress: ${(fullResponse.length / CONFIG.maxTokens) * 100}%`
								);
							}
						}

						if (streamingInterval) clearInterval(streamingInterval);

						// Stop loading indicator if it was created
						if (loadingIndicator) {
							stopLoadingIndicator(loadingIndicator);
							loadingIndicator = null;
						}

						reportLog(
							'Completed streaming response from Claude API!',
							'success'
						);

						// Only show UI elements for text output (CLI)
						if (outputFormat === 'text') {
							console.log(
								chalk.green('Completed streaming response from Claude API!')
							);
						}

						// Successfully received response, break the retry loop
						break;
					} catch (claudeError) {
						if (streamingInterval) clearInterval(streamingInterval);

						// Process error to check if it's an overload condition
						reportLog(
							`Error in Claude API call: ${claudeError.message}`,
							'error'
						);

						// Check if this is an overload error
						let isOverload = false;
						// Check 1: SDK specific property
						if (claudeError.type === 'overloaded_error') {
							isOverload = true;
						}
						// Check 2: Check nested error property
						else if (claudeError.error?.type === 'overloaded_error') {
							isOverload = true;
						}
						// Check 3: Check status code
						else if (claudeError.status === 429 || claudeError.status === 529) {
							isOverload = true;
						}
						// Check 4: Check message string
						else if (
							claudeError.message?.toLowerCase().includes('overloaded')
						) {
							isOverload = true;
						}

						if (isOverload) {
							claudeOverloaded = true;
							reportLog(
								`Claude overloaded (attempt ${retryAttempt}/${maxRetryAttempts})`,
								'warn'
							);

							// Only show UI elements for text output (CLI)
							if (outputFormat === 'text') {
								console.log(
									chalk.yellow(
										`Claude overloaded (attempt ${retryAttempt}/${maxRetryAttempts})`
									)
								);
							}

							if (isLastAttempt) {
								reportLog(
									'Maximum retry attempts reached for Claude API',
									'error'
								);

								// Only show UI elements for text output (CLI)
								if (outputFormat === 'text') {
									console.log(
										chalk.red('Maximum retry attempts reached for Claude API')
									);
								}

								// Let the outer error handling take care of it
								throw new Error(
									`Claude API overloaded after ${maxRetryAttempts} attempts`
								);
							}

							// Wait a bit before retrying - adds backoff delay
							const retryDelay = 1000 * retryAttempt; // Increases with each retry
							reportLog(
								`Waiting ${retryDelay / 1000} seconds before retry...`,
								'info'
							);

							// Only show UI elements for text output (CLI)
							if (outputFormat === 'text') {
								console.log(
									chalk.blue(
										`Waiting ${retryDelay / 1000} seconds before retry...`
									)
								);
							}

							await new Promise((resolve) => setTimeout(resolve, retryDelay));
							continue; // Try again
						} else {
							// Non-overload error - don't retry
							reportLog(
								`Non-overload Claude API error: ${claudeError.message}`,
								'error'
							);

							// Only show UI elements for text output (CLI)
							if (outputFormat === 'text') {
								console.log(
									chalk.red(`Claude API error: ${claudeError.message}`)
								);
							}

							throw claudeError; // Let the outer error handling take care of it
						}
					}
				}
			}

			// Parse the JSON response
			reportLog(`Parsing complexity analysis...`, 'info');

			// Only show UI elements for text output (CLI)
			if (outputFormat === 'text') {
				console.log(chalk.blue(`Parsing complexity analysis...`));
			}

			let complexityAnalysis;
			try {
				// Clean up the response to ensure it's valid JSON
				let cleanedResponse = fullResponse;

				// First check for JSON code blocks (common in markdown responses)
				const codeBlockMatch = fullResponse.match(
					/```(?:json)?\s*([\s\S]*?)\s*```/
				);
				if (codeBlockMatch) {
					cleanedResponse = codeBlockMatch[1];
					reportLog('Extracted JSON from code block', 'info');

					// Only show UI elements for text output (CLI)
					if (outputFormat === 'text') {
						console.log(chalk.blue('Extracted JSON from code block'));
					}
				} else {
					// Look for a complete JSON array pattern
					// This regex looks for an array of objects starting with [ and ending with ]
					const jsonArrayMatch = fullResponse.match(
						/(\[\s*\{\s*"[^"]*"\s*:[\s\S]*\}\s*\])/
					);
					if (jsonArrayMatch) {
						cleanedResponse = jsonArrayMatch[1];
						reportLog('Extracted JSON array pattern', 'info');

						// Only show UI elements for text output (CLI)
						if (outputFormat === 'text') {
							console.log(chalk.blue('Extracted JSON array pattern'));
						}
					} else {
						// Try to find the start of a JSON array and capture to the end
						const jsonStartMatch = fullResponse.match(/(\[\s*\{[\s\S]*)/);
						if (jsonStartMatch) {
							cleanedResponse = jsonStartMatch[1];
							// Try to find a proper closing to the array
							const properEndMatch = cleanedResponse.match(/([\s\S]*\}\s*\])/);
							if (properEndMatch) {
								cleanedResponse = properEndMatch[1];
							}
							reportLog('Extracted JSON from start of array to end', 'info');

							// Only show UI elements for text output (CLI)
							if (outputFormat === 'text') {
								console.log(
									chalk.blue('Extracted JSON from start of array to end')
								);
							}
						}
					}
				}

				// Log the cleaned response for debugging - only for text output (CLI)
				if (outputFormat === 'text') {
					console.log(chalk.gray('Attempting to parse cleaned JSON...'));
					console.log(chalk.gray('Cleaned response (first 100 chars):'));
					console.log(chalk.gray(cleanedResponse.substring(0, 100)));
					console.log(chalk.gray('Last 100 chars:'));
					console.log(
						chalk.gray(cleanedResponse.substring(cleanedResponse.length - 100))
					);
				}

				// More aggressive cleaning - strip any non-JSON content at the beginning or end
				const strictArrayMatch = cleanedResponse.match(
					/(\[\s*\{[\s\S]*\}\s*\])/
				);
				if (strictArrayMatch) {
					cleanedResponse = strictArrayMatch[1];
					reportLog('Applied strict JSON array extraction', 'info');

					// Only show UI elements for text output (CLI)
					if (outputFormat === 'text') {
						console.log(chalk.blue('Applied strict JSON array extraction'));
					}
				}

				try {
					complexityAnalysis = JSON.parse(cleanedResponse);
				} catch (jsonError) {
					reportLog(
						'Initial JSON parsing failed, attempting to fix common JSON issues...',
						'warn'
					);

					// Only show UI elements for text output (CLI)
					if (outputFormat === 'text') {
						console.log(
							chalk.yellow(
								'Initial JSON parsing failed, attempting to fix common JSON issues...'
							)
						);
					}

					// Try to fix common JSON issues
					// 1. Remove any trailing commas in arrays or objects
					cleanedResponse = cleanedResponse.replace(/,(\s*[\]}])/g, '$1');

					// 2. Ensure property names are double-quoted
					cleanedResponse = cleanedResponse.replace(
						/(\s*)(\w+)(\s*):(\s*)/g,
						'$1"$2"$3:$4'
					);

					// 3. Replace single quotes with double quotes for property values
					cleanedResponse = cleanedResponse.replace(
						/:(\s*)'([^']*)'(\s*[,}])/g,
						':$1"$2"$3'
					);

					// 4. Fix unterminated strings - common with LLM responses
					const untermStringPattern = /:(\s*)"([^"]*)(?=[,}])/g;
					cleanedResponse = cleanedResponse.replace(
						untermStringPattern,
						':$1"$2"'
					);

					// 5. Fix multi-line strings by replacing newlines
					cleanedResponse = cleanedResponse.replace(
						/:(\s*)"([^"]*)\n([^"]*)"/g,
						':$1"$2 $3"'
					);

					try {
						complexityAnalysis = JSON.parse(cleanedResponse);
						reportLog(
							'Successfully parsed JSON after fixing common issues',
							'success'
						);

						// Only show UI elements for text output (CLI)
						if (outputFormat === 'text') {
							console.log(
								chalk.green(
									'Successfully parsed JSON after fixing common issues'
								)
							);
						}
					} catch (fixedJsonError) {
						reportLog(
							'Failed to parse JSON even after fixes, attempting more aggressive cleanup...',
							'error'
						);

						// Only show UI elements for text output (CLI)
						if (outputFormat === 'text') {
							console.log(
								chalk.red(
									'Failed to parse JSON even after fixes, attempting more aggressive cleanup...'
								)
							);
						}

						// Try to extract and process each task individually
						try {
							const taskMatches = cleanedResponse.match(
								/\{\s*"taskId"\s*:\s*(\d+)[^}]*\}/g
							);
							if (taskMatches && taskMatches.length > 0) {
								reportLog(
									`Found ${taskMatches.length} task objects, attempting to process individually`,
									'info'
								);

								// Only show UI elements for text output (CLI)
								if (outputFormat === 'text') {
									console.log(
										chalk.yellow(
											`Found ${taskMatches.length} task objects, attempting to process individually`
										)
									);
								}

								complexityAnalysis = [];
								for (const taskMatch of taskMatches) {
									try {
										// Try to parse each task object individually
										const fixedTask = taskMatch.replace(/,\s*$/, ''); // Remove trailing commas
										const taskObj = JSON.parse(`${fixedTask}`);
										if (taskObj && taskObj.taskId) {
											complexityAnalysis.push(taskObj);
										}
									} catch (taskParseError) {
										reportLog(
											`Could not parse individual task: ${taskMatch.substring(0, 30)}...`,
											'warn'
										);

										// Only show UI elements for text output (CLI)
										if (outputFormat === 'text') {
											console.log(
												chalk.yellow(
													`Could not parse individual task: ${taskMatch.substring(0, 30)}...`
												)
											);
										}
									}
								}

								if (complexityAnalysis.length > 0) {
									reportLog(
										`Successfully parsed ${complexityAnalysis.length} tasks individually`,
										'success'
									);

									// Only show UI elements for text output (CLI)
									if (outputFormat === 'text') {
										console.log(
											chalk.green(
												`Successfully parsed ${complexityAnalysis.length} tasks individually`
											)
										);
									}
								} else {
									throw new Error('Could not parse any tasks individually');
								}
							} else {
								throw fixedJsonError;
							}
						} catch (individualError) {
							reportLog('All parsing attempts failed', 'error');

							// Only show UI elements for text output (CLI)
							if (outputFormat === 'text') {
								console.log(chalk.red('All parsing attempts failed'));
							}
							throw jsonError; // throw the original error
						}
					}
				}

				// Ensure complexityAnalysis is an array
				if (!Array.isArray(complexityAnalysis)) {
					reportLog(
						'Response is not an array, checking if it contains an array property...',
						'warn'
					);

					// Only show UI elements for text output (CLI)
					if (outputFormat === 'text') {
						console.log(
							chalk.yellow(
								'Response is not an array, checking if it contains an array property...'
							)
						);
					}

					// Handle the case where the response might be an object with an array property
					if (
						complexityAnalysis.tasks ||
						complexityAnalysis.analysis ||
						complexityAnalysis.results
					) {
						complexityAnalysis =
							complexityAnalysis.tasks ||
							complexityAnalysis.analysis ||
							complexityAnalysis.results;
					} else {
						// If no recognizable array property, wrap it as an array if it's an object
						if (
							typeof complexityAnalysis === 'object' &&
							complexityAnalysis !== null
						) {
							reportLog('Converting object to array...', 'warn');

							// Only show UI elements for text output (CLI)
							if (outputFormat === 'text') {
								console.log(chalk.yellow('Converting object to array...'));
							}
							complexityAnalysis = [complexityAnalysis];
						} else {
							throw new Error(
								'Response does not contain a valid array or object'
							);
						}
					}
				}

				// Final check to ensure we have an array
				if (!Array.isArray(complexityAnalysis)) {
					throw new Error('Failed to extract an array from the response');
				}

				// Check that we have an analysis for each task in the input file
				const taskIds = tasksData.tasks.map((t) => t.id);
				const analysisTaskIds = complexityAnalysis.map((a) => a.taskId);
				const missingTaskIds = taskIds.filter(
					(id) => !analysisTaskIds.includes(id)
				);

				// Only show missing task warnings for text output (CLI)
				if (missingTaskIds.length > 0 && outputFormat === 'text') {
					reportLog(
						`Missing analysis for ${missingTaskIds.length} tasks: ${missingTaskIds.join(', ')}`,
						'warn'
					);

					if (outputFormat === 'text') {
						console.log(
							chalk.yellow(
								`Missing analysis for ${missingTaskIds.length} tasks: ${missingTaskIds.join(', ')}`
							)
						);
						console.log(chalk.blue(`Attempting to analyze missing tasks...`));
					}

					// Handle missing tasks with a basic default analysis
					for (const missingId of missingTaskIds) {
						const missingTask = tasksData.tasks.find((t) => t.id === missingId);
						if (missingTask) {
							reportLog(
								`Adding default analysis for task ${missingId}`,
								'info'
							);

							// Create a basic analysis for the missing task
							complexityAnalysis.push({
								taskId: missingId,
								taskTitle: missingTask.title,
								complexityScore: 5, // Default middle complexity
								recommendedSubtasks: 3, // Default recommended subtasks
								expansionPrompt: `Break down this task with a focus on ${missingTask.title.toLowerCase()}.`,
								reasoning:
									'Automatically added due to missing analysis in API response.'
							});
						}
					}
				}

				// Create the final report
				const finalReport = {
					meta: {
						generatedAt: new Date().toISOString(),
						tasksAnalyzed: tasksData.tasks.length,
						thresholdScore: thresholdScore,
						projectName: tasksData.meta?.projectName || 'Your Project Name',
						usedResearch: useResearch
					},
					complexityAnalysis: complexityAnalysis
				};

				// Write the report to file
				reportLog(`Writing complexity report to ${outputPath}...`, 'info');
				writeJSON(outputPath, finalReport);

				reportLog(
					`Task complexity analysis complete. Report written to ${outputPath}`,
					'success'
				);

				// Only show UI elements for text output (CLI)
				if (outputFormat === 'text') {
					console.log(
						chalk.green(
							`Task complexity analysis complete. Report written to ${outputPath}`
						)
					);

					// Display a summary of findings
					const highComplexity = complexityAnalysis.filter(
						(t) => t.complexityScore >= 8
					).length;
					const mediumComplexity = complexityAnalysis.filter(
						(t) => t.complexityScore >= 5 && t.complexityScore < 8
					).length;
					const lowComplexity = complexityAnalysis.filter(
						(t) => t.complexityScore < 5
					).length;
					const totalAnalyzed = complexityAnalysis.length;

					console.log('\nComplexity Analysis Summary:');
					console.log('----------------------------');
					console.log(`Tasks in input file: ${tasksData.tasks.length}`);
					console.log(`Tasks successfully analyzed: ${totalAnalyzed}`);
					console.log(`High complexity tasks: ${highComplexity}`);
					console.log(`Medium complexity tasks: ${mediumComplexity}`);
					console.log(`Low complexity tasks: ${lowComplexity}`);
					console.log(
						`Sum verification: ${highComplexity + mediumComplexity + lowComplexity} (should equal ${totalAnalyzed})`
					);
					console.log(
						`Research-backed analysis: ${useResearch ? 'Yes' : 'No'}`
					);
					console.log(
						`\nSee ${outputPath} for the full report and expansion commands.`
					);

					// Show next steps suggestions
					console.log(
						boxen(
							chalk.white.bold('Suggested Next Steps:') +
								'\n\n' +
								`${chalk.cyan('1.')} Run ${chalk.yellow('task-master complexity-report')} to review detailed findings\n` +
								`${chalk.cyan('2.')} Run ${chalk.yellow('task-master expand --id=<id>')} to break down complex tasks\n` +
								`${chalk.cyan('3.')} Run ${chalk.yellow('task-master expand --all')} to expand all pending tasks based on complexity`,
							{
								padding: 1,
								borderColor: 'cyan',
								borderStyle: 'round',
								margin: { top: 1 }
							}
						)
					);
				}

				return finalReport;
			} catch (error) {
				if (streamingInterval) clearInterval(streamingInterval);

				// Stop loading indicator if it was created
				if (loadingIndicator) {
					stopLoadingIndicator(loadingIndicator);
				}

				reportLog(
					`Error parsing complexity analysis: ${error.message}`,
					'error'
				);

				if (outputFormat === 'text') {
					console.error(
						chalk.red(`Error parsing complexity analysis: ${error.message}`)
					);
					if (getDebugFlag()) {
						// Use getter
						console.debug(
							chalk.gray(`Raw response: ${fullResponse.substring(0, 500)}...`)
						);
					}
				}

				throw error;
			}
		} catch (error) {
			if (streamingInterval) clearInterval(streamingInterval);

			// Stop loading indicator if it was created
			if (loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
			}

			reportLog(`Error during AI analysis: ${error.message}`, 'error');
			throw error;
		}
	} catch (error) {
		reportLog(`Error analyzing task complexity: ${error.message}`, 'error');

		// Only show error UI for text output (CLI)
		if (outputFormat === 'text') {
			console.error(
				chalk.red(`Error analyzing task complexity: ${error.message}`)
			);

			// Provide more helpful error messages for common issues
			if (error.message.includes('ANTHROPIC_API_KEY')) {
				console.log(
					chalk.yellow('\nTo fix this issue, set your Anthropic API key:')
				);
				console.log('  export ANTHROPIC_API_KEY=your_api_key_here');
			} else if (error.message.includes('PERPLEXITY_API_KEY')) {
				console.log(chalk.yellow('\nTo fix this issue:'));
				console.log(
					'  1. Set your Perplexity API key: export PERPLEXITY_API_KEY=your_api_key_here'
				);
				console.log(
					'  2. Or run without the research flag: task-master analyze-complexity'
				);
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

export default analyzeTaskComplexity;
