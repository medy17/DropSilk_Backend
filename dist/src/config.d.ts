export interface Config {
    PORT: number;
    NODE_ENV: string;
    ALLOWED_ORIGINS: Set<string>;
    VERCEL_PREVIEW_ORIGIN_REGEX: RegExp;
    MAX_PAYLOAD: number;
    HEALTH_CHECK_INTERVAL: number;
    SHUTDOWN_TIMEOUT: number;
    LOG_ACCESS_KEY: string;
    MAX_LOG_BUFFER_SIZE: number;
    UPLOADTHING_TOKEN: string;
    CLOUDFLARE_TURN_TOKEN_ID: string;
    CLOUDFLARE_API_TOKEN: string;
    NO_DB: boolean;
    recaptchaSecretKey: string;
    contactEmail: string;
}
declare const config: Config;
export default config;
//# sourceMappingURL=config.d.ts.map