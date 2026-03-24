import { readFile } from "node:fs/promises";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
const sheetName = process.env.GOOGLE_SHEET_NAME ?? "COZORODATABASE";

const tokenFile = await readFile(".google-oauth.json", "utf8");
const tokens = JSON.parse(tokenFile);

const oauthClient = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauthClient.setCredentials(tokens);

const sheets = google.sheets({ version: "v4", auth: oauthClient });

const response = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `${sheetName}!A1:AMJ3`,
});

const values = response.data.values ?? [];
const headers = values[0] ?? [];
console.log("Total header columns:", headers.length);
console.log("All headers:", JSON.stringify(headers, null, 2));
const maHdIdx = headers.findIndex(h => h.toLowerCase().includes("m") && h.toLowerCase().includes("hd"));
console.log("MÃ HD column index:", maHdIdx, "header value:", headers[maHdIdx]);
console.log("Row 2 (first data):", JSON.stringify(values[1]?.slice(0, 10)));
console.log("Row 3:", JSON.stringify(values[2]?.slice(0, 10)));
