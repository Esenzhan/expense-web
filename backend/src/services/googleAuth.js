import { OAuth2Client } from "google-auth-library";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;

// Scopes: identity (who's logging in) + drive.file/spreadsheets (create and
// write the user's own personal expense sheet, scoped to files this app
// creates — not their whole Drive).
const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

function newClient() {
  return new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function getAuthUrl() {
  return newClient().generateAuthUrl({
    access_type: "offline",
    // Only 2 accounts will ever use this — always forcing the consent
    // screen guarantees a refresh_token comes back every time (Google
    // only issues one on the very first consent otherwise).
    prompt: "consent",
    scope: SCOPES,
  });
}

// Exchanges the ?code= from the OAuth redirect for tokens, and verifies the
// id_token to pull out the account's identity.
export async function exchangeCode(code) {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return {
    tokens,
    profile: {
      sub: payload.sub,
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || null,
    },
  };
}

// An OAuth2Client authenticated as a specific user, for the Sheets/Drive
// API calls in services/sheets.js. googleapis refreshes the access token
// transparently as long as a refresh_token is set.
export function clientForUser(refreshToken) {
  const client = newClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
