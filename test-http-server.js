#!/usr/bin/env node

/**
 * Test script to run Task Master MCP server locally with HTTP transport
 * This allows faster debugging without Docker rebuild cycles
 * 
 * Usage: node test-http-server.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from project root .env
const projectRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

// Set environment variables for HTTP transport
process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.PORT = process.env.PORT || '3004';
process.env.MCP_ENDPOINT = process.env.MCP_ENDPOINT || '/mcp';
process.env.STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(projectRoot, 'data', 'taskmaster');
process.env.TASK_MASTER_TOOLS = process.env.TASK_MASTER_TOOLS || 'standard';
process.env.TASK_MASTER_MCP = 'true';

// Ensure MISTRAL_API_KEY is set
if (!process.env.MISTRAL_API_KEY) {
	console.error('❌ MISTRAL_API_KEY is not set in .env file');
	console.error('Please set MISTRAL_API_KEY in .env file');
	process.exit(1);
}

console.log('🚀 Starting Task Master MCP Server locally...');
console.log(`   Host: ${process.env.HOST}`);
console.log(`   Port: ${process.env.PORT}`);
console.log(`   Endpoint: ${process.env.MCP_ENDPOINT}`);
console.log(`   Storage: ${process.env.STORAGE_ROOT}`);
console.log('');

// Import the built server entry point
// The build outputs dist/mcp-server.js which is the server entry point
import('./dist/mcp-server.js').catch((error) => {
	console.error('❌ Failed to import server:', error.message);
	console.error(error.stack);
	process.exit(1);
});

