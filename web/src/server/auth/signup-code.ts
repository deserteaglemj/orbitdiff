/**
 * Request header that carries the sign-up access code when the deployment
 * requires one. Shared by the server gate and the browser client, so this
 * module must stay free of server-only imports.
 */
export const SIGNUP_CODE_HEADER = "x-signup-code";
