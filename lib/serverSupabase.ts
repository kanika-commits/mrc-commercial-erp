import { Agent } from "undici";

const supabaseServerDispatcher = new Agent({ maxHeaderSize: 128 * 1024 });

export function supabaseServerFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, dispatcher: supabaseServerDispatcher } as RequestInit);
}
