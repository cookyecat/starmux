import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

/** SDK Client.connect starts close without awaiting it on initialization errors.
 * Share its cleanup promise so our subsequent close waits for child termination.
 */
export class ManagedStdioTransport extends StdioClientTransport {
  #closing:Promise<void>|null=null;
  override close():Promise<void>{
    return this.#closing??=super.close();
  }
}
