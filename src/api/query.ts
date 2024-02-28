import { Model, APIS } from "./models";

export type Message = {
    role: string;
    content: string;
};
export type Prompt = string | Message[];

export async function query(prompt: Prompt, model: Model): Promise<string> {
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
    if (!apiKey) { throw new Error(`${api.key} environment variable isn't set!`); }

    const response = await fetch(api.url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(params),
    });

    const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
    if (!reader) { throw new Error("Failed to read response from API!"); }

    while (true) {
        const { value, done } = await reader.read();
        // console.log("GOT A VALUE");
        // console.log(value);
        if (value && (!value.startsWith('data: ') || !value.trim().endsWith('}'))) {
            console.log("Corrupt!");
            continue;
        }
        if (done) { break; }
        for (let data of value.split('\n')) {
            if (data.length === 0) { continue; } // ignore empty message
            if (data.startsWith(':')) { continue; } // ignore sse comment message
            if (data === 'data: [DONE]') { break; } // end of response
            const json = JSON.parse(data.substring(6));
            console.log(json.choices[0].delta.content);
        }
    }
    return "";

    const result = await response.json();
    if (response.status !== 200) {
        throw new Error(`Invalid response from API: ${response.status}\n${response.statusText}`);
    }
    if (!result.choices || result.choices.length !== 1) {
        throw new Error(`Expected exactly one choice, but got ${result.choices.length}!`);
    }
    return result.choices[0].message.content;
}
