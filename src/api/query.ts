import * as vscode from 'vscode';
import { Model } from "./models";
import { LineDecoder } from "./decoder";
import type { ReadableStream } from 'stream/web';

export class APIKeyError extends Error {}
export class APIResponseError extends Error {}

export type Message = {
    role: string;
    content: string;
};

export async function* query(prompt: Message[], model: Model, controller: AbortController): AsyncIterable<string> {
    const api = model.api;
    const apiKey = vscode.workspace.getConfiguration('ask').get<string>(`apiKeys.${api.key}`);
    const apiKeyName = api.key[0].toUpperCase() + api.key.slice(1);
    if (!apiKey) {
        throw new APIKeyError(`${apiKeyName} API key isn't set!`);
    }

    const response = await fetch(api.url, {
        method: "POST",
        headers: api.headers(apiKey),
        body: JSON.stringify(api.params(model.id, prompt)),
        signal: controller.signal,
    });
    if (!response.ok || !response.body) {
        throw new APIResponseError(`Invalid response from API: ${response.status}\n${response.statusText}`);
    }

    try {
        const lineDecoder = new LineDecoder();
        for await (const chunk of response.body as ReadableStream<Uint8Array>) {
            for (const line of lineDecoder.decode(chunk)) {
                yield api.result(line);
            }
        }
    } catch (error: any) {
        if (error.name !== "AbortError") {
            throw error;
        }
    }
}
