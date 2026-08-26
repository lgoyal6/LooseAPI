/** Minimal ambient types for the Google Identity Services token model. */
export {};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (resp: {
              access_token?: string;
              expires_in?: number;
              scope?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }): { requestAccessToken: (overrides?: { prompt?: string }) => void };
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}
