export type Headers = Record<string, string | string[]>;

export interface CapturedRequest {
  id: number;
  receivedAt: string;
  method: string;
  /** Path and query string, as received. */
  url: string;
  headers: Headers;
  /** Body as text, or base64 when it isn't valid UTF-8. */
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  remoteAddress?: string;
}
