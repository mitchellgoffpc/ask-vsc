export interface API {
    key: string;
    url: string;
}

export interface Model {
    name: string;
    api: string;
}

export const APIS: { [key: string]: API } = {
    openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY' },
    mistral: { url: 'https://api.mistral.ai/v1/chat/completions', key: 'MISTRAL_API_KEY' },
};

export const MODELS: Model[] = [
    { name: 'gpt-3.5-turbo', api: 'openai' },
    { name: 'gpt-4', api: 'openai' },
    { name: 'gpt-4-turbo-preview', api: 'openai' },
    { name: 'mistral-medium', api: 'mistral' },
];
