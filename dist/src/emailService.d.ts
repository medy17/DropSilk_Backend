import type { ServerResponse, IncomingMessage } from "http";
interface EmailRequestBody {
    token?: string;
}
interface IncomingMessageWithBody extends IncomingMessage {
    body?: EmailRequestBody;
}
export declare function handleRequestEmail(req: IncomingMessageWithBody, res: ServerResponse): Promise<void>;
export {};
//# sourceMappingURL=emailService.d.ts.map