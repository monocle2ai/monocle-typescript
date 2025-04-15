export interface SdkConfig {
    name: string;
    type: string;
    patterns: {
        baseUrl?: string[];
        modelPrefix?: string[];
        constructorName?: string[];
        clientBaseUrl?: string[];
    };
}

export type SdkDetectionResult = {
    sdkName: string;
    sdkType: string;
};
export const SDK_CONFIGS: SdkConfig[] = [
    {
        name: 'anthropic',
        type: 'inference',
        patterns: {
            baseUrl: ['api.anthropic.com'],
            modelPrefix: ['claude-'],
            constructorName: ['Anthropic'],
            clientBaseUrl: ['anthropic.com']
        }
    },
    {
        name: 'openai',
        type: 'inference',
        patterns: {
            baseUrl: ['api.openai.com'],
            modelPrefix: ['gpt-'],
            constructorName: ['OpenAI'],
            clientBaseUrl: ['openai.com']
        }
    }
];