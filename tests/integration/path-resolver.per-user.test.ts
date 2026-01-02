import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import path from 'node:path';
import { PathResolver } from '../../packages/tm-core/src/modules/storage/adapters/file-storage/path-resolver';

const ORIGINAL_ENV = { ...process.env };

describe('PathResolver per-user storage', () => {
	beforeEach(() => {
		process.env = { ...ORIGINAL_ENV };
		delete process.env.LIBRECHAT_USER_ID;
		delete process.env.TASK_MASTER_STORAGE_ROOT;
		delete process.env.STORAGE_ROOT;
	});

	afterAll(() => {
		process.env = ORIGINAL_ENV;
	});

	it('uses LIBRECHAT_USER_ID with STORAGE_ROOT override', () => {
		process.env.LIBRECHAT_USER_ID = 'alice';
		process.env.STORAGE_ROOT = '/tmp/storage';

		const resolver = new PathResolver('/project/root');

		expect(resolver.getBasePath()).toBe(path.join('/tmp/storage', 'alice', '.taskmaster'));
		expect(resolver.getTasksDir()).toBe(path.join('/tmp/storage', 'alice', '.taskmaster', 'tasks'));
		expect(resolver.getTasksPath()).toBe(
			path.join('/tmp/storage', 'alice', '.taskmaster', 'tasks', 'tasks.json')
		);
	});

	it('uses TASK_MASTER_STORAGE_ROOT override when set', () => {
		process.env.TASK_MASTER_STORAGE_ROOT = '/custom/root';

		const resolver = new PathResolver('/project/root');

		expect(resolver.getBasePath()).toBe('/custom/root');
		expect(resolver.getTasksPath()).toBe(path.join('/custom/root', 'tasks', 'tasks.json'));
	});

	it('falls back to project path when no env is set', () => {
		const resolver = new PathResolver('/project/root');

		expect(resolver.getBasePath()).toBe('/project/root/.taskmaster');
		expect(resolver.getTasksPath()).toBe('/project/root/.taskmaster/tasks/tasks.json');
	});
});

