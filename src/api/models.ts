enum EditingStrategy {
    UDIFF = "UDIFF",
    REPLACE = "REPLACE",
}

class API {
    constructor(public url: string, public key: string) { }

    headers(api_key: string): any {
        return {"Authorization": `Bearer ${api_key}`, "Content-Type": "application/json"};
    }
    params(model_name: string, messages: any[], temperature: number = 0.7): any {
        return {"model": model_name, "messages": messages, "temperature": temperature, "max_tokens": 4096, "stream": true};
    }
    result(line: any): string {
        if (line['choices'].length !== 1) {
            throw new Error(`Expected exactly one choice, but got ${line['choices'].length}!`);
        }
        return line.choices[0].delta.content || "";
    }
}

class AnthropicAPI extends API {
    headers(api_key: string): any {
        return {"x-api-key": api_key, 'anthropic-version': '2023-06-01', "Content-Type": "application/json"};
    }
    params(model_name: string, messages: any[], temperature: number = 0.7): any {
        let systemMessages = messages.filter(msg => msg.role === 'system');
        let userMessages = messages.filter(msg => msg.role === 'user');
        let systemPrompt = systemMessages.map(msg => msg.content).join('\n\n') || undefined;
        return {"model": model_name, "system": systemPrompt, "messages": userMessages, "temperature": temperature, "max_tokens": 4096, "stream": true};
    }
    result(response: any): string {
        return response.type === 'content_block_delta' ? response.delta.text : "";
    }
}

export interface Model {
    id: string;
    name: string;
    api: API;
}

export const APIS: { [key: string]: API } = {
    OpenAI: new API('https://api.openai.com/v1/chat/completions', 'openAI'),
    Mistral: new API('https://api.mistral.ai/v1/chat/completions', 'mistral'),
    Anthropic: new AnthropicAPI('https://api.anthropic.com/v1/messages', 'anthropic'),
};

export const MODELS: Model[] = [
    {id: 'gpt-3.5-turbo', name: 'GPT 3.5 Turbo', api: APIS.OpenAI},
    {id: 'gpt-4', name: "GPT 4", api: APIS.OpenAI},
    {id: 'gpt-4-turbo', name: "GPT 4 Turbo", api: APIS.OpenAI},
    {id: 'open-mixtral-8x7b', name: "Mixtral", api: APIS.Mistral},
    {id: 'mistral-medium-latest', name: "Mistral Medium", api: APIS.Mistral},
    {id: 'mistral-large-latest', name: "Mistral Large", api: APIS.Mistral},
    {id: 'claude-3-haiku-20240307', name: "Claude 3 Haiku", api: APIS.Anthropic},
    {id: 'claude-3-sonnet-20240229', name: "Claude 3 Sonnet", api: APIS.Anthropic},
    {id: 'claude-3-opus-20240229', name: "Claude 3 Opus", api: APIS.Anthropic},
];
