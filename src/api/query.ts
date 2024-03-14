import { Model } from "./models";
import { LineDecoder } from "./decoder";
import type { ReadableStream } from 'stream/web';

export class APIKeyError extends Error {}
export class APIResponseError extends Error {}

export type Message = {
    role: string;
    content: string;
};

export async function* query(prompt: string | Message[], model: Model, controller: AbortController): AsyncIterable<string> {
    if (typeof prompt === "string") {
        prompt = [{ role: "user", content: prompt }];
    }

    const api = model.api;
    const apiKey = process.env[api.key];
    if (!apiKey) {
        throw new APIKeyError(`${api.key} environment variable isn't set!`);
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
