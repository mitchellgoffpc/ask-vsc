export interface API {
    key: string;
    url: string;
}

export interface Model {
    id: string;
    api: string;
    name: string;
}

export const APIS: { [key: string]: API } = {
    openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY' },
    mistral: { url: 'https://api.mistral.ai/v1/chat/completions', key: 'MISTRAL_API_KEY' },
};

export const MODELS: Model[] = [
    { id: 'gpt-3.5-turbo', api: 'openai', name: 'GPT 3.5 Turbo' },
    { id: 'gpt-4', api: 'openai', name: "GPT 4" },
    { id: 'gpt-4-turbo-preview', api: 'openai', name: "GPT 4 Turbo" },
    { id: 'open-mixtral-8x7b', api: 'mistral', name: "Mixtral" },
    { id: 'mistral-medium-latest', api: 'mistral', name: "Mistral Medium" },
    { id: 'mistral-large-latest', api: 'mistral', name: "Mistral Large" },
];
