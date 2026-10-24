if(process.env.MAC_MCP_GIT_MODE==='review')process.exit(42);
await import('../../src/instance-worker.js');
