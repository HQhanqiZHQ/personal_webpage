declare module 'posthog-js' {
    export type PostHogConfig = {
        api_host?: string
        loaded?: (posthog: any) => void
        [key: string]: any
    }
}