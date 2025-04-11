import { z } from 'zod';
import { execSync } from 'child_process';
import {
	createContentResponse,
	createErrorResponse,
	getProjectRootFromSession
} from './utils.js';

export function registerInitializeProjectTool(server) {
	server.addTool({
		name: 'initialize_project',
		description:
			"Initializes a new Task Master project structure in the specified project directory by running 'task-master init'. If the project information required for the initialization is not available or provided by the user, prompt if the user wishes to provide them (name, description, author) or skip them. If the user wishes to skip, set the 'yes' flag to true and do not set any other parameters. DO NOT run the initialize_project tool without parameters.",
		parameters: z.object({
			projectName: z
				.string()
				.optional()
				.describe(
					'The name for the new project. If not provided, prompt the user for it.'
				),
			projectDescription: z
				.string()
				.optional()
				.describe(
					'A brief description for the project. If not provided, prompt the user for it.'
				),
			projectVersion: z
				.string()
				.optional()
				.describe(
					"The initial version for the project (e.g., '0.1.0'). User input not needed unless user requests to override."
				),
			authorName: z
				.string()
				.optional()
				.describe(
					"The author's name. User input not needed unless user requests to override."
				),
			skipInstall: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					'Skip installing dependencies automatically. Never do this unless you are sure the project is already installed.'
				),
			addAliases: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					'Add shell aliases (tm, taskmaster) to shell config file. User input not needed.'
				),
			yes: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					"Skip prompts and use default values or provided arguments. Use true if you wish to skip details like the project name, etc. If the project information required for the initialization is not available or provided by the user, prompt if the user wishes to provide them (name, description, author) or skip them. If the user wishes to skip, set the 'yes' flag to true and do not set any other parameters."
				),
			projectRoot: z
				.string()
				.optional()
				.describe(
					'Optional fallback project root if session data is unavailable. Setting a value is not needed unless you are running the tool from a different directory than the project root.'
				)
		}),
		execute: async (args, { log, session }) => {
			try {
				log.info(
					`Executing initialize_project with args: ${JSON.stringify(args)}`
				);

				let targetDirectory = getProjectRootFromSession(session, log);
				if (!targetDirectory) {
					if (args.projectRoot) {
						targetDirectory = args.projectRoot;
						log.warn(
							`Using projectRoot argument as fallback: ${targetDirectory}`
						);
					} else {
						log.error(
							'Could not determine target directory for initialization from session or arguments.'
						);
						return createErrorResponse(
							'Failed to determine target directory for initialization.'
						);
					}
				}
				log.info(`Target directory for initialization: ${targetDirectory}`);

				let commandBase = 'npx task-master init';
				const cliArgs = [];
				if (args.projectName)
					cliArgs.push(`--name "${args.projectName.replace(/"/g, '\\"')}"`);
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

				log.debug(
					`Value of args.yes before check: ${args.yes} (Type: ${typeof args.yes})`
				);
				if (args.yes === true) {
					cliArgs.push('--yes');
					log.info('Added --yes flag to cliArgs.');
				} else {
					log.info(`Did NOT add --yes flag. args.yes value: ${args.yes}`);
				}

				const command =
					cliArgs.length > 0
						? `${commandBase} ${cliArgs.join(' ')}`
						: commandBase;

				log.info(`FINAL Constructed command for execSync: ${command}`);

				const output = execSync(command, {
					encoding: 'utf8',
					stdio: 'pipe',
					timeout: 300000,
					cwd: targetDirectory
				});

				log.info(`Initialization output:\n${output}`);

				return createContentResponse({
					message: `Taskmaster successfully initialized in ${targetDirectory}.`,
					next_step:
						'Now that the project is initialized, the next step is to create the tasks by parsing a PRD. This will create the tasks folder and the initial task files. The parse-prd tool will required a prd.txt file as input in scripts/prd.txt. You can create a prd.txt file by asking the user about their idea, and then using the scripts/example_prd.txt file as a template to genrate a prd.txt file in scripts/. Before creating the PRD for the user, make sure you understand the idea fully and ask questions to eliminate ambiguity. You can then use the parse-prd tool to create the tasks. So: step 1 after initialization is to create a prd.txt file in scripts/prd.txt. Step 2 is to use the parse-prd tool to create the tasks. Do not bother looking for tasks after initialization, just use the parse-prd tool to create the tasks after creating a prd.txt from which to parse the tasks. ',
					output: output
				});
			} catch (error) {
				const errorMessage = `Project initialization failed: ${
					error.message || 'Unknown error'
				}`;
				const errorDetails =
					error.stderr?.toString() || error.stdout?.toString() || error.message;
				log.error(`${errorMessage}\nDetails: ${errorDetails}`);

				return createErrorResponse(errorMessage, { details: errorDetails });
			}
		}
	});
}
