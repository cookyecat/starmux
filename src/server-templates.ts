/** Curated setup recipes; users explicitly test/enable before packages execute. */
export const serverTemplates=Object.freeze([
 {id:'npm',name:'Node package',transport:'stdio',command:'npx',args:['--yes','PACKAGE@VERSION'],source:'https://docs.npmjs.com/cli/v11/commands/npx',applicableVersion:'npm 11',instructions:'Replace PACKAGE@VERSION with an explicitly chosen MCP server package and version. Reuses installed Node/npm.'},
 {id:'python',name:'Python package',transport:'stdio',command:'uvx',args:['PACKAGE==VERSION'],source:'https://docs.astral.sh/uv/guides/tools/',applicableVersion:'uv with uvx support',instructions:'Replace PACKAGE==VERSION with your chosen MCP server. Install uv if unavailable.'},
 {id:'container',name:'Container image',transport:'stdio',command:'docker',args:['run','--rm','-i','IMAGE@sha256:DIGEST'],source:'https://docs.docker.com/reference/cli/docker/container/run/',applicableVersion:'Docker CLI with run --rm -i',instructions:'Use an image digest and add the mounts required by the server. Docker must already be installed and running.'},
 {id:'http',name:'Remote MCP',transport:'streamable-http',url:'https://HOST/mcp',source:'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports',applicableVersion:'SDK 1.32.1',instructions:'Enter the MCP URL. Configure API key references or sign in to the upstream service if required.'}
]);
