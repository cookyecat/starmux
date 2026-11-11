/** Presentation only: keep original errors and protocol behavior unchanged. No user data is interpolated into guidance. */
const guidance:Record<string,readonly [string,string]>={};
function add(codes:string,en:string,zh:string){for(const code of codes.split(' '))guidance[code]=[en,zh];}
add('PORT_IN_USE EADDRINUSE','The port is already in use. Check starmux ls for another instance; choose a free port in Configuration, or stop the instance using it.','端口已被占用。请用 starmux ls 检查其他实例，在配置中选择空闲端口，或停止占用该端口的实例。');
add('CONFIG_CONFLICT CONFIG_REVISION_CONFLICT CONFIG_SOURCE_CHANGED','Configuration changed since you opened it. Copy your unsaved edits, reload the configuration, compare changes, then save again.','配置已被其他操作更新。请先复制保留未保存的修改，再重新加载配置、核对差异后保存。');
add('SERVER_IMPORT_JSON_INVALID','The configuration could not be parsed. Check JSON/JSONC syntax, especially quotes, commas and brackets, then validate again.','配置无法解析。请检查 JSON/JSONC 的引号、逗号和括号，再重新校验。');
add('INSTANCE_NAME_EXISTS SERVER_ID_CONFLICT MIDDLEWARE_ID_CONFLICT','This name or ID already exists. Choose another, or edit the existing entry. Server replacement requires an explicit Replace action / --replace.','名称或 ID 已存在。请换一个名称，或编辑已有条目；替换服务需要明确选择“替换”或使用 --replace。');
add('SERVER_NOT_FOUND','The service is not registered in this instance. Refresh the service list or run starmux server list with the same -i selector, then use its service ID.','当前实例中没有这个服务。请刷新服务列表，或使用相同的 -i 参数运行 starmux server list，再使用列表中的服务 ID。');
add('MIDDLEWARE_NOT_FOUND MIDDLEWARE_ORDER_INVALID','The middleware list may have changed. Reload it before editing. Ordering must include every current middleware ID exactly once.','中间件列表可能已变化。请重新加载后编辑；排序需要包含当前全部中间件 ID，且每个只出现一次。');
add('SERVER_PREVIEW_EXPIRED SERVER_PREVIEW_LIMIT','Preview again to obtain a current import preview, then test it before saving. Older previews expire after 30 minutes; wait for older previews to expire if the preview limit is reached.','请重新预览导入内容，再测试并保存。预览在 30 分钟后过期；如已达到预览数量上限，请等待旧预览过期后再试。');
add('SERVER_TEST_REQUIRED','No successful connection test is available for this preview. Test the connection, resolve any reported errors, then enable the service.','此预览尚未通过连接测试。请先测试连接并处理提示的问题，再启用服务。');
add('SERVER_RUNTIME_MISSING','The required executable was not found. Install the indicated runtime or set an absolute executable path, then test again. Restart Starmux after changing PATH.','未找到所需程序。请安装提示中的运行时，或填写可执行文件的绝对路径，再测试连接；修改 PATH 后需重启 Starmux。');
add('SERVER_SHELL_SYNTAX_UNSUPPORTED SERVER_COMMAND_UNCLOSED_QUOTE SERVER_COMMAND_INVALID','Enter an executable and arguments, not a shell script. Check matching quotes; use command and args JSON fields for complex arguments.','请填写程序和参数，不要粘贴 Shell 脚本。检查引号是否配对；复杂参数可用 JSON 的 command 和 args 字段表达。');
add('SERVER_IMPORT_UNKNOWN_FIELDS SERVER_IMPORT_DUPLICATE_FIELD','Review the reported fields. Remove duplicate keys and use supported server configuration fields; preview again before testing.','请检查提示中的字段，移除重复键并使用支持的服务配置字段，再重新预览和测试。');
add('UPSTREAM_SECRET_MISSING SERVER_SECRET_REFERENCE_CONFLICT SERVER_SECRET_REFERENCE_COLLISION','Check the referenced secret names in this instance. Add the missing secret or use a distinct reference; do not paste credentials into diagnostics.','请检查当前实例引用的密钥名称，补齐缺失密钥或使用不同的引用名；不要将凭证粘贴到诊断信息中。');
add('UPSTREAM_AUTH_REQUIRED UPSTREAM_AUTH_DENIED UPSTREAM_AUTH_FAILED','The upstream service requires valid credentials. Check its API key or sign in to that service, then retry its connection. Starmux client authentication is separate.','上游服务需要有效凭证。请检查该服务的 API Key 或登录账号，再重试连接；这与客户端访问 Starmux 的认证是两套配置。');
add('UPSTREAM_AUTH_ATTEMPT_EXPIRED UPSTREAM_AUTH_SESSION_CHANGED UPSTREAM_AUTH_SERVER_CHANGED','This authorization attempt is no longer current. Start a new sign-in for this service and use the newly generated authorization URL.','本次授权已失效或连接配置已变化。请重新发起该服务的登录，并使用新生成的授权链接。');
add('UPSTREAM_AUTH_BUSY INSTANCE_BUSY INSTANCE_APPLY_IN_PROGRESS','Another operation is still running. Check its progress and wait for it to finish before submitting another change.','另一个操作仍在进行。请查看进度，等待完成后再提交变更。');
add('OPERATION_PENDING GATEWAY_APPLY_TIMEOUT INSTANCE_CONTROL_TIMEOUT INSTANCE_STOP_TIMEOUT','Confirmation timed out; the operation may still be running. Check instance status and logs before retrying. A timeout does not prove that nothing happened.','等待确认超时，操作可能仍在进行。请先检查实例状态和日志，再决定是否重试；超时不代表操作没有执行。');
add('INSTANCE_NOT_RUNNING','This instance is not running. Start the selected instance, then retry the operation. Use starmux status -i NAME_OR_ID to check it.','当前实例未运行。请先启动选中的实例，再执行操作；可用 starmux status -i 名称或ID 查看状态。');
add('INSTANCE_START_FAILED INSTANCE_START_TIMEOUT INSTANCE_WORKER_EXITED','The instance did not become ready. Check starmux logs -i NAME_OR_ID and starmux doctor -i NAME_OR_ID for the selected instance before starting again.','实例未能就绪。请用 starmux logs -i 名称或ID 和 starmux doctor -i 名称或ID 检查对应实例，再重新启动。');
add('SERVER_TEST_FAILED UPSTREAM_CONNECT_FAILED','Connection testing failed. Check the service command or URL and its diagnostics. For initial dependency downloads, use Prepare / --prepare; do not disable authentication to bypass connection errors.','连接测试失败。请检查服务命令或 URL 及其诊断；首次下载依赖可使用准备操作或 --prepare，不要通过关闭认证绕过连接错误。');
add('SERVER_TEST_CANCELLED','The connection test was canceled. Review its diagnostics before starting a new test; cancellation does not undo dependency downloads or program side effects.','连接测试已取消。重新测试前可查看诊断；取消不会撤销已经下载的依赖或程序已经产生的影响。');
add('MANAGER_LOGIN_REQUIRED','The console session is missing or expired. Run starmux dashboard to open an authenticated session again.','控制台会话缺失或已失效。请运行 starmux dashboard 重新打开已授权的控制台。');
add('MIDDLEWARE_FAILED MIDDLEWARE_TIMEOUT MIDDLEWARE_INVALID_OUTPUT MIDDLEWARE_BUSY','Check the plugin ID, stage and upstreamExecution in diagnostics. Fix or reload the plugin before another call; if upstream returned or execution is uncertain, verify effects before retrying.','请查看诊断中的插件 ID、阶段和 upstreamExecution，修复或重新加载插件；若上游已返回或执行状态不确定，请核实实际结果后再重试。');
add('CONFIG_INVALID','Configuration validation failed. Check the field named in the error, correct its value or JSONC syntax, then validate before saving.','配置校验未通过。请检查错误中指出的字段、取值或 JSONC 语法，修正后先校验再保存。');
add('SERVER_LIMIT SERVER_IMPORT_TOO_LARGE CONFIG_TOO_LARGE UPSTREAM_CATALOG_LIMIT','The configured size or count limit was exceeded. Reduce the import or catalog size; no partial catalog should be used.','配置数量或内容大小超过限制。请缩小导入或目录规模，不要使用不完整目录。');
add('UPSTREAM_CURSOR_REPEATED UPSTREAM_CATALOG_CONFLICT GATEWAY_CATALOG_CONFLICT','The service directory contains repeated pages or conflicting names. Check the upstream server and names, then refresh its directory.','服务目录出现重复分页或名称冲突。请检查上游服务和命名，再刷新目录。');
export function errorGuidance(message:string,language='en'):string|undefined{
 const code=/^([A-Z][A-Z0-9_]+)(?=[:\s]|$)/.exec(message)?.[1];
 return code?guidance[code]?.[language==='zh'?1:0]:undefined;
}
export function formatUserError(message:string,language='en'){
 const hint=errorGuidance(message,language);return hint?message+'\n'+hint:message;
}
export function withErrorGuidance(value:unknown):unknown{
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const result={...value} as Record<string,unknown>;
 if(typeof result.error==='string'){const hint=errorGuidance(result.error);if(hint)result.hint=hint;}
 if(Array.isArray(result.results))result.results=result.results.map(item=>withErrorGuidance(item));
 return result;
}

/** Shared service/middleware feedback; saving is distinct from runtime application. */
export function applicationFeedback(result:{application?:string;error?:string},language='en'){
 const zh=language==='zh';
 const error=Boolean(result.error)||!['applied','on-next-start'].includes(result.application??'');
 const message=result.application==='applied'&&!result.error?(zh?'已保存并应用':'Saved and applied'):
  result.application==='on-next-start'&&!result.error?(zh?'已保存；实例启动时生效。':'Saved; changes will activate when this instance starts.'):
  result.application==='pending'?(zh?'已保存，但尚未应用。':'Saved, but not applied.'):
  (zh?'生效状态未确认，请检查实例状态。':'Application status is unconfirmed; check instance status.');
 return {message:message+(result.error?'\n'+formatUserError(result.error,language):''),error};
}
