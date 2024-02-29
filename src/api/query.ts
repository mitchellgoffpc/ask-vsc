import * as assert from "assert";
import { Model, APIS } from "./models";
import { LineDecoder } from "./decoder";
import type { ReadableStream } from 'stream/web';

export type Message = {
    role: string;
    content: string;
};

export async function* query(prompt: string | Message[], model: Model): AsyncIterable<string> {
    if (typeof prompt === "string") {
        prompt = [{ role: "user", content: prompt }];
    }

    const api = APIS[model.api];
    const apiKey = process.env[api.key];
    const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };
    const params = {
        model: model.name,
        messages: prompt,
        temperature: 0.7,
        stream: true,
    };
    assert.ok(apiKey, `${api.key} environment variable isn't set!`);

    const controller = new AbortController();
    const response = await fetch(api.url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(params),
        signal: controller.signal,
    });
    if (!response.ok || !response.body) {
        throw new Error(`Invalid response from API: ${response.status}\n${response.statusText}`);
    }

    const lineDecoder = new LineDecoder();

    for await (const chunk of response.body as ReadableStream<Uint8Array>) {
        for (const line of lineDecoder.decode(chunk)) {
            yield line.choices[0].delta.content || "";
        }
    }
}
