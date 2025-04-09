import { z } from 'zod';
import { execSync } from 'child_process';
import { createContentResponse, createErrorResponse } from './utils.js'; // Only need response creators

export function registerInitializeProjectTool(server) {
	server.addTool({
		name: 'initialize_project', // snake_case for tool name
		description:
			"Initializes a new Task Master project structure in the current working directory by running 'task-master init'.",
		parameters: z.object({
			projectName: z
				.string()
				.optional()
				.describe('The name for the new project.'),
			projectDescription: z
				.string()
				.optional()
				.describe('A brief description for the project.'),
			projectVersion: z
				.string()
				.optional()
				.describe("The initial version for the project (e.g., '0.1.0')."),
			authorName: z.string().optional().describe("The author's name."),
			skipInstall: z
				.boolean()
				.optional()
				.default(false)
				.describe('Skip installing dependencies automatically.'),
			addAliases: z
				.boolean()
				.optional()
				.default(false)
				.describe('Add shell aliases (tm, taskmaster) to shell config file.'),
			yes: z
				.boolean()
				.optional()
				.default(false)
				.describe('Skip prompts and use default values or provided arguments.')
			// projectRoot is not needed here as 'init' works on the current directory
		}),
		execute: async (args, { log }) => {
			// Destructure context to get log
			try {
				log.info(
					`Executing initialize_project with args: ${JSON.stringify(args)}`
				);

				// Construct the command arguments carefully
				// Using npx ensures it uses the locally installed version if available, or fetches it
				let command = 'npx task-master init';
				const cliArgs = [];
				if (args.projectName)
					cliArgs.push(`--name "${args.projectName.replace(/"/g, '\\"')}"`); // Escape quotes
				if (args.projectDescription)
					cliArgs.push(
						`--description "${args.projectDescription.replace(/"/g, '\\"')}"`
					);
				if (args.projectVersion)
					cliArgs.push(
						`--version "${args.projectVersion.replace(/"/g, '\\"')}"`
					);
				if (args.authorName)
					cliArgs.push(`--author "${args.authorName.replace(/"/g, '\\"')}"`);
				if (args.skipInstall) cliArgs.push('--skip-install');
				if (args.addAliases) cliArgs.push('--aliases');
				if (args.yes) cliArgs.push('--yes');

				command += ' ' + cliArgs.join(' ');

				log.info(`Constructed command: ${command}`);

				// Execute the command in the current working directory of the server process
				// Capture stdout/stderr. Use a reasonable timeout (e.g., 5 minutes)
				const output = execSync(command, {
					encoding: 'utf8',
					stdio: 'pipe',
					timeout: 300000
				});

				log.info(`Initialization output:\n${output}`);

				// Return a standard success response manually
				return createContentResponse({
					message: 'Taskmaster successfully initialized for this project.',
					next_step:
						'Now that the project is initialized, the next step is to create the tasks by parsing a PRD. This will create the tasks folder and the initial task files. The parse-prd tool will required a prd.txt file as input in scripts/prd.txt. You can create a prd.txt file by asking the user about their idea, and then using the scripts/example_prd.txt file as a template to genrate a prd.txt file in scripts/. You can then use the parse-prd tool to create the tasks. So: step 1 after initialization is to create a prd.txt file in scripts/prd.txt. Step 2 is to use the parse-prd tool to create the tasks. Do not bother looking for tasks after initialization, just use the parse-prd tool to create the tasks after creating a prd.txt from which to parse the tasks.'
				});
			} catch (error) {
				// Catch errors from execSync or timeouts
				const errorMessage = `Project initialization failed: ${error.message}`;
				const errorDetails =
					error.stderr?.toString() || error.stdout?.toString() || error.message; // Provide stderr/stdout if available
				log.error(`${errorMessage}\nDetails: ${errorDetails}`);

				// Return a standard error response manually
				return createErrorResponse(errorMessage, { details: errorDetails });
			}
		}
	});
}
